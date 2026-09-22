-- ============================================================================
-- Migration 0025: fix RLS recursion between shifts and shift_sessions
-- ============================================================================
-- Problem:
--   RLS policies on shifts and shift_sessions reference each other via
--   inline subqueries. PostgreSQL evaluates those subqueries by re-entering
--   the other table's policies, which re-enters this table's policies,
--   and the loop is detected as infinite recursion.
--
--   Cycle:
--     shift_sessions SELECT/INSERT/UPDATE policy
--       -> EXISTS (SELECT 1 FROM shifts ...)
--     shifts SELECT policy shifts_select_guard_own
--       -> EXISTS (SELECT 1 FROM shift_sessions ...)
--     ...back to shift_sessions policies...
--
--   Latent since migration 0008. It never surfaced because every prior
--   test that touched shift_sessions ran as superuser or through a
--   SECURITY DEFINER function — both bypass RLS. The first test to
--   INSERT into shift_sessions under the authenticated role exposed it.
--
-- Fix:
--   Wrap each cross-table lookup in a SECURITY DEFINER helper function.
--   SECURITY DEFINER functions run as the owner (postgres), which owns
--   the tables and therefore bypasses their RLS. The subquery no longer
--   re-enters the other table's policies, so the cycle is broken.
--
--   Enforcement semantics are unchanged: every check that used to run as
--   the calling user still enforces the same rule, just from inside a
--   function whose effective role sees the underlying rows directly.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Helper functions
-- ----------------------------------------------------------------------------

create or replace function public.shift_org_admin(p_shift_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shifts sh
    where sh.id = p_shift_id
      and public.is_org_admin(sh.organization_id)
  );
$$;

comment on function public.shift_org_admin(uuid) is
  'True if the current account is an admin of the org that owns the given shift.';


create or replace function public.shift_org_operational(p_shift_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shifts sh
    where sh.id = p_shift_id
      and public.is_org_operational(sh.organization_id)
  );
$$;

comment on function public.shift_org_operational(uuid) is
  'True if the org that owns the given shift is currently operational.';


create or replace function public.guard_has_session_on_shift(p_shift_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.shift_sessions s
    where s.shift_id = p_shift_id
      and s.guard_profile_id = public.current_guard_profile_id()
  );
$$;

comment on function public.guard_has_session_on_shift(uuid) is
  'True if the current guard has any shift_session (past or present) on the given shift.';


-- ----------------------------------------------------------------------------
-- 2. Rewrite policies to use the helpers — no inline cross-table subqueries
-- ----------------------------------------------------------------------------

-- shifts: guard sees shifts they had a session on
drop policy shifts_select_guard_own on public.shifts;
create policy shifts_select_guard_own on public.shifts
  for select
  using (public.guard_has_session_on_shift(shifts.id));


-- shift_sessions: admin sees sessions on their shifts; guard sees their own
drop policy shift_sessions_select_admin_or_own on public.shift_sessions;
create policy shift_sessions_select_admin_or_own on public.shift_sessions
  for select
  using (
    guard_profile_id = public.current_guard_profile_id()
    or public.shift_org_admin(shift_id)
  );


-- shift_sessions INSERT: admin + operational, checked via helpers
drop policy shift_sessions_insert_admin on public.shift_sessions;
create policy shift_sessions_insert_admin on public.shift_sessions
  for insert
  with check (
    public.shift_org_admin(shift_id)
    and public.shift_org_operational(shift_id)
  );


-- shift_sessions UPDATE: admin only
drop policy shift_sessions_update_admin on public.shift_sessions;
create policy shift_sessions_update_admin on public.shift_sessions
  for update
  using (public.shift_org_admin(shift_id))
  with check (public.shift_org_admin(shift_id));


-- ============================================================================
-- Summary:
--   Policies on shifts and shift_sessions no longer contain inline
--   subqueries that cross between the two tables. Every cross-table check
--   goes through a SECURITY DEFINER helper, which bypasses RLS and
--   therefore cannot re-enter the other table's policies.
--
--   Enforcement semantics preserved:
--     - Admin sees sessions on shifts they administer
--     - Guard sees their own shift sessions
--     - Guard sees shifts they've had a session on
--     - INSERT requires org admin and operational org
--     - UPDATE requires org admin
-- ============================================================================
