-- ============================================================================
-- Migration 0004: platform_admins
-- ============================================================================
-- Purpose:
--   Establish the Platform Admin role. Deliberately separate from
--   organization_memberships because Platform Admin sits ABOVE the tenant
--   boundary, not inside it (handoff §27).
--
--   Platform Admin has NO unrestricted customer operational access. What it
--   does have is defined by RLS policies on other tables, not by this one.
--
--   Grants happen out-of-band (Supabase dashboard / service role) — there
--   are deliberately NO INSERT/UPDATE/DELETE policies here. Until an audit
--   trail and admin console exist (later phases), the safest default is
--   "grants require direct database access by an operator."
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. platform_admins
-- ----------------------------------------------------------------------------
-- Binary role: active = revoked_at is null; revoked = revoked_at is set.
-- We keep revoked rows rather than deleting them so the history of who was
-- ever a platform admin is preserved.

create table public.platform_admins (
  id          uuid primary key default public.uuidv7(),
  account_id  uuid not null unique references public.accounts(id) on delete restrict,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references public.accounts(id) on delete set null,
  notes       text,
  revoked_at  timestamptz,
  revoked_by  uuid references public.accounts(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- If revoked_at is set, revoked_by should be too (and vice versa).
  constraint platform_admins_revocation_consistency
    check ((revoked_at is null) = (revoked_by is null))
);

comment on table public.platform_admins is
  'Platform-level administrators. Sits above tenant boundary. Grants are out-of-band.';

comment on column public.platform_admins.granted_by is
  'NULL for the bootstrap grant — the very first platform admin has no granter.';

create trigger platform_admins_set_updated_at
  before update on public.platform_admins
  for each row execute function public.set_updated_at();

-- Partial index for the helper. Only active admins matter for permission checks.
create index platform_admins_active_by_account
  on public.platform_admins(account_id)
  where revoked_at is null;

-- ----------------------------------------------------------------------------
-- 2. Helper: is_platform_admin()
-- ----------------------------------------------------------------------------
-- No arguments — checks the current authenticated account. Used by RLS
-- policies on other tables as the "unless you are platform admin" branch.
-- SECURITY DEFINER so it bypasses RLS on platform_admins (avoids recursion
-- when the SELECT policy below calls it).

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_admins
    where account_id = public.current_account_id()
      and revoked_at is null
  );
$$;

comment on function public.is_platform_admin() is
  'True if the current account is an active platform admin. No args.';

-- ----------------------------------------------------------------------------
-- 3. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.platform_admins enable row level security;

-- A platform admin can read their own row, and any other platform admin's row.
-- Non-admins see nothing. This lets the platform team audit each other without
-- granting them access to customer data.
create policy platform_admins_select_self_or_peer on public.platform_admins
  for select
  using (
    account_id = public.current_account_id()
    or public.is_platform_admin()
  );

-- No INSERT policy — grants happen via service role / dashboard.
-- No UPDATE policy — revocation happens via service role / dashboard.
-- No DELETE policy — rows are revoked (revoked_at set), never deleted.
