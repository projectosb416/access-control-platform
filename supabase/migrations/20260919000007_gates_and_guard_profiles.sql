-- ============================================================================
-- Migration 0007: gates and guard_profiles
-- ============================================================================
-- Purpose:
--   Establish physical access points (gates) and guard identities (guard_profiles).
--
--   Key model points:
--   - Gate = where an event happens (handoff §12). Not a permission boundary.
--   - Gate has a capacity = maximum concurrent active guards at that gate.
--     Ceiling comes from the org's plan entitlement; enforced at the application
--     layer when plan tables exist (Phase 5.viii). Schema stores the number.
--   - Guards are not permanently assigned to gates (handoff §13).
--   - Guard ID (guard_code) is identification, not authentication.
--   - Guard profile lifecycle: invited → active → suspended → inactive
--     (handoff §22). Distinct from person lifecycle.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helper: generate_code_for_org()
-- ----------------------------------------------------------------------------
-- Generates a unique code scoped to an organization. Retries on collision.
-- Alphabet excludes visually ambiguous characters (0/O, 1/I/L) so codes can
-- be read aloud at a gate without confusion.

create or replace function public.generate_code_for_org(
  p_prefix          text,
  p_length          int,
  p_table           text,
  p_column          text,
  p_organization_id uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  alphabet  text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  candidate text;
  i         int;
  attempt   int;
  hit       boolean;
begin
  for attempt in 1..50 loop
    candidate := p_prefix;
    for i in 1..p_length loop
      candidate := candidate || substr(
        alphabet,
        1 + floor(random() * length(alphabet))::int,
        1
      );
    end loop;

    execute format(
      'select exists (select 1 from public.%I where organization_id = $1 and %I = $2)',
      p_table, p_column
    ) using p_organization_id, candidate into hit;

    if not hit then
      return candidate;
    end if;
  end loop;

  raise exception 'could not generate unique code after 50 attempts';
end;
$$;

comment on function public.generate_code_for_org(text, int, text, text, uuid) is
  'Generates a unique code scoped to an organization. Retries on collision.';

-- ----------------------------------------------------------------------------
-- 2. gates
-- ----------------------------------------------------------------------------
-- Lifecycle per handoff §22: ACTIVE → INACTIVE → ARCHIVED

create table public.gates (
  id                  uuid primary key default public.uuidv7(),
  organization_id     uuid not null references public.organizations(id) on delete restrict,
  name                text not null,
  description         text,
  max_active_guards   int not null default 1
                      check (max_active_guards > 0 and max_active_guards <= 100),
  status              text not null default 'active'
                      check (status in ('active', 'inactive', 'archived')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint gates_name_not_blank check (length(btrim(name)) > 0)
);

comment on table public.gates is
  'Physical access points. Gate = where an event happened, not a permission boundary.';

comment on column public.gates.description is
  'Orientation text (e.g., "Facing UNILAG"). For humans, not access logic.';

comment on column public.gates.max_active_guards is
  'Maximum concurrent active guards at this gate. Ceiling enforced by plan.';

create trigger gates_set_updated_at
  before update on public.gates
  for each row execute function public.set_updated_at();

create index gates_organization_id on public.gates(organization_id);

-- Case-insensitive unique gate name per org.
create unique index gates_unique_name_per_org
  on public.gates(organization_id, lower(btrim(name)));

-- ----------------------------------------------------------------------------
-- 3. guard_profiles
-- ----------------------------------------------------------------------------
-- One row per guard. References a person (their real-world identity) and
-- holds the guard-specific lifecycle and identification code.

create table public.guard_profiles (
  id                uuid primary key default public.uuidv7(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  person_id         uuid not null unique references public.people(id) on delete restrict,
  guard_code        text not null,
  status            text not null default 'invited'
                    check (status in ('invited', 'active', 'suspended', 'inactive')),
  created_by        uuid references public.accounts(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.guard_profiles is
  'Guard identity. Not a login. Guard enters guard_code + shift_code to start.';

comment on column public.guard_profiles.guard_code is
  'Random unique code (GU-XXXXXX). Identification only — auth is separate.';

create trigger guard_profiles_set_updated_at
  before update on public.guard_profiles
  for each row execute function public.set_updated_at();

create index guard_profiles_organization_id on public.guard_profiles(organization_id);

-- guard_code is unique per organization (not global).
create unique index guard_profiles_unique_code_per_org
  on public.guard_profiles(organization_id, guard_code);

-- ----------------------------------------------------------------------------
-- 4. Trigger: auto-generate guard_code on insert
-- ----------------------------------------------------------------------------

create or replace function public.set_guard_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.guard_code is null or new.guard_code = '' then
    new.guard_code := public.generate_code_for_org(
      'GU-', 6, 'guard_profiles', 'guard_code', new.organization_id
    );
  end if;
  return new;
end;
$$;

comment on function public.set_guard_code() is
  'Trigger function: assigns guard_code on insert if not already set.';

create trigger guard_profiles_set_code
  before insert on public.guard_profiles
  for each row execute function public.set_guard_code();

-- ----------------------------------------------------------------------------
-- 5. Helper: current_guard_profile_id()
-- ----------------------------------------------------------------------------

create or replace function public.current_guard_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select gp.id
  from public.guard_profiles gp
  join public.people p on p.id = gp.person_id
  where p.account_id = public.current_account_id();
$$;

comment on function public.current_guard_profile_id() is
  'Returns guard_profiles.id for the current account, if any.';

-- ----------------------------------------------------------------------------
-- 6. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.gates enable row level security;
alter table public.guard_profiles enable row level security;

-- gates: any org member reads; admins write.
create policy gates_select_member on public.gates
  for select
  using (public.is_org_member(organization_id));

create policy gates_insert_admin on public.gates
  for insert
  with check (public.is_org_admin(organization_id));

create policy gates_update_admin on public.gates
  for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- guard_profiles: admin full access; a guard can read their own profile.
create policy guard_profiles_select_admin_or_self on public.guard_profiles
  for select
  using (
    public.is_org_admin(organization_id)
    or id = public.current_guard_profile_id()
  );

create policy guard_profiles_insert_admin on public.guard_profiles
  for insert
  with check (public.is_org_admin(organization_id));

create policy guard_profiles_update_admin on public.guard_profiles
  for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- No DELETE — gates and guard profiles are archived, never hard-deleted.
