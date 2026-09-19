-- ============================================================================
-- Migration 0005: people
-- ============================================================================
-- Purpose:
--   Real-world individuals. Every visitor, resident, guard, employee, etc.,
--   is a person. A person MAY be linked to an account (if they log in), but
--   visitors never need accounts just to receive a PIN (handoff §6).
--
--   people is org-scoped (Option A decision): each person row belongs to one
--   organization. The same real human in two orgs is two person rows, with
--   no cross-tenant visibility.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. people
-- ----------------------------------------------------------------------------
-- Lifecycle per handoff §22: ACTIVE → INACTIVE → ARCHIVED

create table public.people (
  id               uuid primary key default public.uuidv7(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  account_id       uuid references public.accounts(id) on delete set null,
  full_name        text not null,
  phone            text,
  email            text,
  notes            text,
  status           text not null default 'active'
                   check (status in ('active', 'inactive', 'archived')),
  created_by       uuid references public.accounts(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.people is
  'Real-world individuals. Org-scoped. May or may not be linked to an account.';

comment on column public.people.account_id is
  'Optional link to an authentication identity. NULL for visitors who never log in.';

comment on column public.people.full_name is
  'Required per handoff §15 — authorization creation demands a full name.';

create trigger people_set_updated_at
  before update on public.people
  for each row execute function public.set_updated_at();

-- Fast lookup by org (RLS filters on it), by account link, and by org+name.
create index people_organization_id on public.people(organization_id);
create index people_account_id on public.people(account_id) where account_id is not null;
create index people_organization_name on public.people(organization_id, lower(full_name));

-- One account maps to at most one person per org. Partial because most people
-- (visitors) have no account link, and NULLs must not collide.
create unique index people_unique_account_per_org
  on public.people(organization_id, account_id)
  where account_id is not null;

-- ----------------------------------------------------------------------------
-- 2. Row Level Security
-- ----------------------------------------------------------------------------
-- Deliberately tight for now. Guards and Primary Residents will need scoped
-- access later, but that access will go through views/functions built on top
-- of tables we haven't created yet (occupancy, guard_profile, shift). Those
-- get their own policies in their own migrations.
--
-- For 5.ii.4: admin sees all people in their org; a person can always read
-- their own row.

alter table public.people enable row level security;

create policy people_select_admin_or_self on public.people
  for select
  using (
    public.is_org_admin(organization_id)
    or account_id = public.current_account_id()
  );

create policy people_insert_admin on public.people
  for insert
  with check (public.is_org_admin(organization_id));

create policy people_update_admin on public.people
  for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- No DELETE policy — people are archived via status, never hard-deleted
-- (handoff §38 "Do not hard-delete historical gates/units/people").
