-- ============================================================================
-- Migration 0071: platform_org_team
-- ============================================================================
-- Purpose:
--   Returns the team members of an organization for the platform
--   drill-down (/platform/orgs/[id]). First function in the codebase to
--   read auth.users — see "Cross-schema read" below.
--
-- Why SECURITY DEFINER:
--   Two reasons, both required:
--     1. Platform-admin gate. Only is_platform_admin() callers may run
--        this. A plain authenticated role cannot call a function gated
--        on is_platform_admin() unless the function body itself checks.
--     2. auth.users is not in the public schema. The `authenticated`
--        role has no read grant on auth.users. The function owner
--        (postgres via the migration runner) does. SECURITY DEFINER
--        runs the body as the owner, so the join works.
--
-- Cross-schema read:
--   This is the first migration in the codebase that selects from
--   auth.users. The reference is fully qualified (`auth.users`) because
--   the function's search_path is `public` only. Do NOT add an RLS
--   policy on auth.users — that schema is managed by Supabase and does
--   not accept policies from public migrations. SECURITY DEFINER is the
--   correct mechanism.
--
-- Return shape:
--   account_id          uuid
--   full_name           text    (accounts.display_name)
--   email               text    (auth.users.email; may be NULL if the
--                                auth record was deleted — rare, but
--                                left join handles it)
--   role                text    (admin | guard | primary_resident)
--   membership_status   text    (invited | active | suspended | ended)
--   account_status      text    (pending_activation | active | ...)
--   joined_at           timestamptz  (NULL if invited but never joined)
--   terms_accepted_at   timestamptz  (NULL for pre-0069 accounts)
--
-- Ordering:
--   Active members first, then invited, then ended. Within each bucket
--   by role, then joined_at (nulls last), then created_at. Deterministic
--   so the UI does not shuffle rows between renders.
--
-- Errors:
--   NOT_PLATFORM_ADMIN — caller is not a platform admin
--   (existing code, 403 in error-http-mapping.md)
--
-- Empty case:
--   Unknown organization_id returns zero rows — not an error. The
--   platform admin only reaches this page by clicking a valid org row,
--   so a non-existent id here implies a stale link, not a server fault.
--
-- Ambiguity discipline (§11):
--   Every column reference qualified with a table alias. OUT parameter
--   names (account_id, full_name, email, role, membership_status,
--   account_status, joined_at, terms_accepted_at) do not collide with
--   any column names in the FROM clause because all are qualified, but
--   the discipline holds regardless.
-- ============================================================================


create or replace function public.platform_org_team(p_organization_id uuid)
returns table (
  account_id          uuid,
  full_name           text,
  email               text,
  role                text,
  membership_status   text,
  account_status      text,
  joined_at           timestamptz,
  terms_accepted_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN';
  end if;

  return query
    select
      m.account_id                                as account_id,
      a.display_name                              as full_name,
      u.email                                     as email,
      m.role                                      as role,
      m.status                                    as membership_status,
      a.status                                    as account_status,
      m.joined_at                                 as joined_at,
      a.terms_accepted_at                         as terms_accepted_at
    from public.organization_memberships m
    join public.accounts a
      on a.id = m.account_id
    left join auth.users u
      on u.id = a.auth_user_id
    where m.organization_id = p_organization_id
    order by
      case m.status
        when 'active'  then 0
        when 'invited' then 1
        else 2
      end,
      case m.role
        when 'admin'            then 0
        when 'primary_resident' then 1
        when 'guard'            then 2
        else 3
      end,
      m.joined_at nulls last,
      m.created_at;
end;
$$;

comment on function public.platform_org_team(uuid) is
  'Platform-admin only. Returns team members of an org (name, email, role, membership + account status, tenure, ToS acceptance). First auth.users cross-schema read in the codebase — see header comment.';
