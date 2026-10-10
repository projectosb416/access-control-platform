-- ============================================================================
-- Migration 0072: fix platform_org_team email type mismatch
-- ============================================================================
-- Context:
--   Migration 0071 created public.platform_org_team with `email text` in
--   the RETURNS TABLE clause. The expression `u.email` resolves to
--   auth.users.email, which Supabase defines as `character varying(255)`.
--   Postgres requires the returned expression's type to match the
--   declared RETURNS TABLE type exactly — varchar != text — and raised:
--
--     ERROR: structure of query does not match function result type
--     DETAIL: Returned type character varying(255) does not match
--             expected type text in column 3.
--
--   The function therefore failed on every invocation, which caused
--   pgTAP test 20 to abort on first call with plan(5) / ran 0.
--
-- Fix:
--   Cast u.email to text in the SELECT. Same signature, same RETURNS
--   TABLE shape, same body otherwise. `create or replace` swaps the body
--   in place — no drop, no downstream breakage.
--
-- Not changed:
--   - Function signature (p_organization_id uuid)
--   - RETURNS TABLE column names or order
--   - Ordering clauses
--   - The is_platform_admin() gate
--   - Any other migration
--
-- Test 20 requires no change: its assertions are correct; they simply
-- could not run because the function aborted on first call. Once this
-- migration is applied, all five assertions execute against the
-- corrected function.
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
      u.email::text                               as email,
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
  'Platform-admin only. Returns team members of an org (name, email, role, membership + account status, tenure, ToS acceptance). First auth.users cross-schema read in the codebase. email is cast to text because auth.users.email is varchar(255) and RETURNS TABLE requires exact type match.';
