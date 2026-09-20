-- ============================================================================
-- Migration 0009: appointments and authorizations
-- ============================================================================
-- Purpose:
--   Establish the scheduling layer (appointments) and the permission layer
--   (authorizations). These are the first two links of the canonical chain:
--
--     Person → Authorization → Credential → Session → Event
--
--   Appointments are separate and optional — a person may have an
--   authorization without an appointment (handoff §21).
--
-- Design decisions locked:
--   - PIN hashing happens in application code (Cloudflare Worker). DB stores
--     only hash + salt + pepper_version. Credentials live in migration 0010.
--   - access_type is a CHECK list, expandable via migration.
--   - authorization_type: 'one_time' | 'reusable'.
--   - authorization.appointment_id is a nullable FK — linkage when known.
--   - Primary Resident capability = active occupancy row (handoff §10).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helper: current_person_id(org)
-- ----------------------------------------------------------------------------

create or replace function public.current_person_id(p_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from public.people
  where account_id = public.current_account_id()
    and organization_id = p_organization_id
  limit 1;
$$;

comment on function public.current_person_id(uuid) is
  'Returns people.id for the current account within the given org, or NULL.';

-- ----------------------------------------------------------------------------
-- 2. Helper: current_occupied_unit_id(org)
-- ----------------------------------------------------------------------------
-- Org-scoped: an account could theoretically occupy units in different orgs.
-- Returns the unit the current account is actively occupying in that org.

create or replace function public.current_occupied_unit_id(p_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select o.unit_id
  from public.occupancies o
  join public.units u on u.id = o.unit_id
  join public.properties p on p.id = u.property_id
  where o.account_id = public.current_account_id()
    and o.status = 'active'
    and p.organization_id = p_organization_id
  limit 1;
$$;

comment on function public.current_occupied_unit_id(uuid) is
  'Unit id the current account is an active occupant of within the org. NULL if none.';

-- ----------------------------------------------------------------------------
-- 3. appointments
-- ----------------------------------------------------------------------------
-- Lifecycle per handoff §22: PLANNED → CONFIRMED → ARRIVED → COMPLETED;
-- exceptional CANCELLED / EXPIRED.

create table public.appointments (
  id                uuid primary key default public.uuidv7(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  person_id         uuid not null references public.people(id) on delete restrict,
  host_person_id    uuid references public.people(id) on delete set null,
  purpose           text not null,
  note              text,
  scheduled_start   timestamptz not null,
  scheduled_end     timestamptz not null,
  actual_arrival_at timestamptz,
  status            text not null default 'planned'
                    check (status in ('planned','confirmed','arrived','completed','cancelled','expired')),
  created_by        uuid references public.accounts(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint appointments_time_order check (scheduled_end > scheduled_start),
  constraint appointments_purpose_not_blank check (length(btrim(purpose)) > 0)
);

comment on table public.appointments is
  'Scheduled/expected visits. Not equivalent to authorization or physical entry (handoff §21).';

comment on column public.appointments.actual_arrival_at is
  'Set when the person actually arrives. Distinct from scheduled_start.';

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

create index appointments_organization_id on public.appointments(organization_id);
create index appointments_person_id on public.appointments(person_id);
create index appointments_host_person_id on public.appointments(host_person_id)
  where host_person_id is not null;
create index appointments_org_scheduled_start on public.appointments(organization_id, scheduled_start);
create index appointments_open on public.appointments(organization_id, scheduled_start)
  where status in ('planned','confirmed','arrived');

-- ----------------------------------------------------------------------------
-- 4. authorizations
-- ----------------------------------------------------------------------------
-- Lifecycle per handoff §22:
--   DRAFT → ACTIVE → IN_PROGRESS → COMPLETED
--   exceptional REVOKED / EXPIRED / CANCELLED / SUSPENDED
--
-- Credentials (the PIN) live in migration 0010 — separate table so the
-- credential lifecycle is independently tracked (handoff §20).

create table public.authorizations (
  id                 uuid primary key default public.uuidv7(),
  organization_id    uuid not null references public.organizations(id) on delete restrict,
  person_id          uuid not null references public.people(id) on delete restrict,

  -- Scope: NULL = org-wide (admin). Set = unit-scoped (admin or that unit's
  -- primary resident).
  scope_unit_id      uuid references public.units(id) on delete restrict,

  -- Optional link to a scheduling appointment. Can be NULL.
  appointment_id     uuid references public.appointments(id) on delete restrict,

  access_type        text not null
                     check (access_type in (
                       'visitor','vendor','contractor','client',
                       'employee','family_member','other'
                     )),
  purpose            text not null,
  note               text,
  host_person_id     uuid references public.people(id) on delete set null,

  authorization_type text not null
                     check (authorization_type in ('one_time','reusable')),

  valid_from         timestamptz not null,
  valid_until        timestamptz not null,

  status             text not null default 'draft'
                     check (status in (
                       'draft','active','in_progress','completed',
                       'revoked','expired','cancelled','suspended'
                     )),

  revoked_at         timestamptz,
  revoked_by         uuid references public.accounts(id) on delete set null,
  revoke_reason      text,

  created_by         uuid references public.accounts(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint authorizations_time_order check (valid_until > valid_from),
  constraint authorizations_purpose_not_blank check (length(btrim(purpose)) > 0),
  constraint authorizations_revoke_consistency
    check ((status = 'revoked') = (revoked_at is not null))
);

comment on table public.authorizations is
  'Permission to access. Second link in Person → Authorization → Credential → Session → Event.';

comment on column public.authorizations.scope_unit_id is
  'NULL = org-wide. Set = unit-scoped (admin or that unit''s primary resident created it).';

comment on column public.authorizations.authorization_type is
  'one_time: single entry+exit, auto-expires if unused (default 1h). reusable: multiple sessions across validity.';

comment on column public.authorizations.appointment_id is
  'Optional link to a scheduling appointment. Authorizations can exist without one (handoff §21).';

create trigger authorizations_set_updated_at
  before update on public.authorizations
  for each row execute function public.set_updated_at();

create index authorizations_organization_id on public.authorizations(organization_id);
create index authorizations_person_id on public.authorizations(person_id);
create index authorizations_scope_unit_id on public.authorizations(scope_unit_id)
  where scope_unit_id is not null;
create index authorizations_appointment_id on public.authorizations(appointment_id)
  where appointment_id is not null;
create index authorizations_active on public.authorizations(organization_id, valid_until)
  where status in ('active','in_progress');

-- ----------------------------------------------------------------------------
-- 5. Row Level Security — appointments
-- ----------------------------------------------------------------------------

alter table public.appointments enable row level security;

create policy appointments_select_admin on public.appointments
  for select
  using (public.is_org_admin(organization_id));

create policy appointments_select_self on public.appointments
  for select
  using (
    person_id = public.current_person_id(organization_id)
    or host_person_id = public.current_person_id(organization_id)
  );

create policy appointments_insert_admin on public.appointments
  for insert
  with check (public.is_org_admin(organization_id));

create policy appointments_update_admin on public.appointments
  for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- No DELETE — appointments are cancelled via status.

-- ----------------------------------------------------------------------------
-- 6. Row Level Security — authorizations
-- ----------------------------------------------------------------------------

alter table public.authorizations enable row level security;

create policy authorizations_select_admin on public.authorizations
  for select
  using (public.is_org_admin(organization_id));

create policy authorizations_select_primary_resident on public.authorizations
  for select
  using (
    scope_unit_id is not null
    and scope_unit_id = public.current_occupied_unit_id(organization_id)
  );

create policy authorizations_select_self on public.authorizations
  for select
  using (person_id = public.current_person_id(organization_id));

create policy authorizations_insert_admin on public.authorizations
  for insert
  with check (public.is_org_admin(organization_id));

create policy authorizations_insert_primary_resident on public.authorizations
  for insert
  with check (
    scope_unit_id is not null
    and scope_unit_id = public.current_occupied_unit_id(organization_id)
  );

create policy authorizations_update_admin on public.authorizations
  for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

create policy authorizations_update_primary_resident on public.authorizations
  for update
  using (
    scope_unit_id is not null
    and scope_unit_id = public.current_occupied_unit_id(organization_id)
  )
  with check (
    scope_unit_id is not null
    and scope_unit_id = public.current_occupied_unit_id(organization_id)
  );

-- No DELETE — authorizations are revoked or cancelled via status.

-- ============================================================================
-- Security note on cross-tenant integrity:
--   Foreign keys here validate row existence, not tenant identity. RLS on
--   the referenced table prevents seeing cross-tenant rows, which blocks
--   most attack paths. Composite FKs on (id, organization_id) would give
--   belt-and-suspenders cross-tenant integrity but require refactoring
--   5.ii–5.iv. Deferred — noted for later hardening if needed.
-- ============================================================================
