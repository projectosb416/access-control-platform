-- ============================================================================
-- Migration 0006: properties, units, occupancies
-- ============================================================================
-- Purpose:
--   Establish the physical geography (property, unit) and the link between
--   accounts and units (occupancy). The "Primary Resident" concept — the
--   person Admin designates as the manager of a unit — is realized here as:
--
--     - an organization_memberships row with role = 'primary_resident'
--       (grants capability — created in this migration's logic, not schema)
--     - an occupancies row linking that account to their specific unit
--       (grants scope)
--
--   Both are required for someone to be a Primary Resident. See handoff §10.
--
--   Design notes:
--   - Unit labels are free text (handoff §9). Trimmed, case-insensitively
--     unique within their property. No fixed-format assumptions.
--   - Units are optional — some orgs have none.
--   - Property is required for units (Decision 1).
--   - At most one active occupancy per unit (partial unique index).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. properties
-- ----------------------------------------------------------------------------
-- Lifecycle per handoff §22: ACTIVE → ARCHIVED
-- A single-building org creates one property. An estate creates one property
-- (or several, if blocks are logically separate). Private homes create one.

create table public.properties (
  id               uuid primary key default public.uuidv7(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  name             text not null,
  address          text,
  notes            text,
  status           text not null default 'active'
                   check (status in ('active', 'archived')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.properties is
  'Named physical location: estate, building, complex, or home.';

create trigger properties_set_updated_at
  before update on public.properties
  for each row execute function public.set_updated_at();

create index properties_organization_id on public.properties(organization_id);

-- Case-insensitive unique property name per org. "Green Valley" = "green valley".
create unique index properties_unique_name_per_org
  on public.properties(organization_id, lower(name));

-- ----------------------------------------------------------------------------
-- 2. units
-- ----------------------------------------------------------------------------
-- Lifecycle per handoff §22: ACTIVE → ARCHIVED
-- Label is a human string — "Flat 24", "House 1", "B2", "Office 2B".
-- Optional (handoff §3): some orgs have no units.

create table public.units (
  id           uuid primary key default public.uuidv7(),
  property_id  uuid not null references public.properties(id) on delete restrict,
  label        text not null,
  notes        text,
  status       text not null default 'active'
               check (status in ('active', 'archived')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Label cannot be blank or whitespace-only.
  constraint units_label_not_blank
    check (length(btrim(label)) > 0)
);

comment on table public.units is
  'Named space within a property. Label is free text (handoff §9).';

comment on column public.units.label is
  'Free-text human label. Trimmed, case-insensitively unique within property.';

create trigger units_set_updated_at
  before update on public.units
  for each row execute function public.set_updated_at();

create index units_property_id on public.units(property_id);

-- Trim + case-insensitive uniqueness within the property.
create unique index units_unique_label_per_property
  on public.units(property_id, lower(btrim(label)));

-- ----------------------------------------------------------------------------
-- 3. occupancies
-- ----------------------------------------------------------------------------
-- Lifecycle per handoff §22: PENDING → ACTIVE → ENDED; exceptional CANCELLED
-- The Primary Resident is the account on the ACTIVE occupancy for a unit.
--
-- Historical, not boolean (handoff §10): John 2024-2026, Sarah 2026-present.
-- Ending an occupancy does NOT delete the row; it sets status='ended' and
-- records ended_at, ended_by, and end_reason.

create table public.occupancies (
  id                uuid primary key default public.uuidv7(),
  unit_id           uuid not null references public.units(id) on delete restrict,
  account_id        uuid not null references public.accounts(id) on delete restrict,
  status            text not null default 'pending'
                    check (status in ('pending', 'active', 'ended', 'cancelled')),
  started_at        timestamptz,
  ended_at          timestamptz,
  ended_by          uuid references public.accounts(id) on delete set null,
  end_reason        text,
  created_by        uuid references public.accounts(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Ended occupancies must record when and why.
  constraint occupancies_end_consistency
    check (
      (status = 'ended' and ended_at is not null and end_reason is not null)
      or (status <> 'ended')
    )
);

comment on table public.occupancies is
  'History of who occupied which unit. Primary Resident = the active occupancy.';

create trigger occupancies_set_updated_at
  before update on public.occupancies
  for each row execute function public.set_updated_at();

-- At most one active occupancy per unit (handoff §23, non-negotiable).
create unique index occupancies_one_active_per_unit
  on public.occupancies(unit_id)
  where status = 'active';

-- At most one active occupancy per account (an account can't be Primary
-- Resident of two units at once).
create unique index occupancies_one_active_per_account
  on public.occupancies(account_id)
  where status = 'active';

create index occupancies_unit_id on public.occupancies(unit_id);
create index occupancies_account_id on public.occupancies(account_id);

-- ----------------------------------------------------------------------------
-- 4. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.properties enable row level security;
alter table public.units      enable row level security;
alter table public.occupancies enable row level security;

-- properties: any active member of the org can read; admins write.
create policy properties_select_member on public.properties
  for select
  using (public.is_org_member(organization_id));

create policy properties_insert_admin on public.properties
  for insert
  with check (public.is_org_admin(organization_id));

create policy properties_update_admin on public.properties
  for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- units: same pattern, but org scope is inherited via property.
create policy units_select_member on public.units
  for select
  using (
    exists (
      select 1 from public.properties p
      where p.id = units.property_id
        and public.is_org_member(p.organization_id)
    )
  );

create policy units_insert_admin on public.units
  for insert
  with check (
    exists (
      select 1 from public.properties p
      where p.id = property_id
        and public.is_org_admin(p.organization_id)
    )
  );

create policy units_update_admin on public.units
  for update
  using (
    exists (
      select 1 from public.properties p
      where p.id = units.property_id
        and public.is_org_admin(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.properties p
      where p.id = property_id
        and public.is_org_admin(p.organization_id)
    )
  );

-- occupancies: admin of the org sees/manages all; the occupant reads their own.
create policy occupancies_select_admin_or_self on public.occupancies
  for select
  using (
    account_id = public.current_account_id()
    or exists (
      select 1 from public.units u
      join public.properties p on p.id = u.property_id
      where u.id = occupancies.unit_id
        and public.is_org_admin(p.organization_id)
    )
  );

create policy occupancies_insert_admin on public.occupancies
  for insert
  with check (
    exists (
      select 1 from public.units u
      join public.properties p on p.id = u.property_id
      where u.id = unit_id
        and public.is_org_admin(p.organization_id)
    )
  );

create policy occupancies_update_admin on public.occupancies
  for update
  using (
    exists (
      select 1 from public.units u
      join public.properties p on p.id = u.property_id
      where u.id = occupancies.unit_id
        and public.is_org_admin(p.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.units u
      join public.properties p on p.id = u.property_id
      where u.id = unit_id
        and public.is_org_admin(p.organization_id)
    )
  );

-- No DELETE policies — properties/units/occupancies are archived or ended,
-- never hard-deleted (handoff §38).
