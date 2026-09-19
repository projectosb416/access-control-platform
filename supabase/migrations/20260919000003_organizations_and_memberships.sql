-- ============================================================================
-- Migration 0003: organizations and organization_memberships
-- ============================================================================
-- Purpose:
--   Establish the tenant boundary (organizations) and the link between
--   accounts and organizations (organization_memberships).
--
--   Every subsequent tenant-scoped table references organizations.id and is
--   protected by RLS that ultimately calls is_org_member() or is_org_admin().
--
--   Bootstrapping: the chicken-and-egg problem of creating an org's first
--   admin is solved by create_organization_with_admin() — a SECURITY DEFINER
--   function that atomically creates the org and its first admin membership.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. organizations
-- ----------------------------------------------------------------------------
-- Lifecycle per handoff §22: PROVISIONING → ACTIVE → SUSPENDED → CLOSED

create table public.organizations (
  id                uuid primary key default public.uuidv7(),
  name              text not null,
  display_name      text not null,
  organization_type text not null
                    check (organization_type in ('residential', 'workplace', 'other')),
  status            text not null default 'provisioning'
                    check (status in ('provisioning', 'active', 'suspended', 'closed')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.organizations is
  'Tenant/security boundary. Every tenant-scoped table references this.';

comment on column public.organizations.organization_type is
  'Residential, workplace, or other. Unit naming is separate (see handoff §9).';

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. organization_memberships
-- ----------------------------------------------------------------------------
-- Lifecycle per handoff §22: INVITED → ACTIVE → SUSPENDED → ENDED
-- Roles are fixed (handoff §7): admin, guard, primary_resident
-- Platform Admin is NOT here — it lives in its own table (migration 0004).

create table public.organization_memberships (
  id               uuid primary key default public.uuidv7(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  account_id       uuid not null references public.accounts(id) on delete restrict,
  role             text not null
                   check (role in ('admin', 'guard', 'primary_resident')),
  status           text not null default 'invited'
                   check (status in ('invited', 'active', 'suspended', 'ended')),
  invited_by       uuid references public.accounts(id) on delete set null,
  invited_at       timestamptz,
  joined_at        timestamptz,
  ended_at         timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- One membership per account per org. Role changes are updates, not new rows.
  constraint organization_memberships_unique_account
    unique (organization_id, account_id)
);

comment on table public.organization_memberships is
  'Links accounts to organizations with a fixed role. One row per account per org.';

create trigger organization_memberships_set_updated_at
  before update on public.organization_memberships
  for each row execute function public.set_updated_at();

-- Partial index for the helper functions. Only active memberships matter
-- for permission checks, so we index only those rows — smaller and faster.
create index organization_memberships_active_by_account
  on public.organization_memberships(account_id, organization_id)
  where status = 'active';

-- ----------------------------------------------------------------------------
-- 3. Helper functions
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER + STABLE: bypasses RLS on organization_memberships so
-- that policies can call these without recursive RLS evaluation.

create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships
    where organization_id = p_organization_id
      and account_id = public.current_account_id()
      and status = 'active'
  );
$$;

comment on function public.is_org_member(uuid) is
  'True if the current account has an active membership in the given org.';

create or replace function public.is_org_admin(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships
    where organization_id = p_organization_id
      and account_id = public.current_account_id()
      and status = 'active'
      and role = 'admin'
  );
$$;

comment on function public.is_org_admin(uuid) is
  'True if the current account is an active admin of the given org.';

-- ----------------------------------------------------------------------------
-- 4. Bootstrap: create organization with first admin
-- ----------------------------------------------------------------------------
-- Solves the chicken-and-egg problem: the org creator becomes its first admin
-- in a single atomic operation. Only this function bypasses RLS to create
-- the first membership — every subsequent membership insert goes through
-- normal RLS (admins inviting others).

create or replace function public.create_organization_with_admin(
  p_name              text,
  p_display_name      text,
  p_organization_type text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_org_id     uuid;
begin
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'no authenticated account';
  end if;

  insert into public.organizations (name, display_name, organization_type, status)
  values (p_name, p_display_name, p_organization_type, 'provisioning')
  returning id into v_org_id;

  insert into public.organization_memberships (
    organization_id, account_id, role, status, joined_at
  )
  values (v_org_id, v_account_id, 'admin', 'active', now());

  return v_org_id;
end;
$$;

comment on function public.create_organization_with_admin(text, text, text) is
  'Atomically creates an organization and makes the calling account its first admin.';

-- ----------------------------------------------------------------------------
-- 5. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;

-- organizations: members can read; admins can update their own org.
-- No INSERT policy — creation goes through create_organization_with_admin().
-- No DELETE policy — orgs are archived via status, never hard-deleted.

create policy organizations_select_member on public.organizations
  for select
  using (public.is_org_member(id));

create policy organizations_update_admin on public.organizations
  for update
  using (public.is_org_admin(id))
  with check (public.is_org_admin(id));

-- organization_memberships: a member sees their own memberships;
-- admins see all memberships within their org.

create policy memberships_select_self_or_admin on public.organization_memberships
  for select
  using (
    account_id = public.current_account_id()
    or public.is_org_admin(organization_id)
  );

create policy memberships_insert_admin on public.organization_memberships
  for insert
  with check (public.is_org_admin(organization_id));

create policy memberships_update_admin on public.organization_memberships
  for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- No DELETE policy — memberships are ended via status, never hard-deleted.
