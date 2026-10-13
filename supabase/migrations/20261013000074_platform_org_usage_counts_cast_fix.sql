-- ============================================================================
-- Migration 0074: platform_org_usage_counts — fix jsonb cast
-- ============================================================================
-- Context:
--   Migration 0073 read plan_entitlements.entitlement_value as
--   `pe.entitlement_value::int`. The column is jsonb (migration 0018,
--   line 97). Direct jsonb→int cast is not the proven pattern in this
--   codebase — migration 0037 (rate_limit_entitlements) uses:
--
--     (pe.entitlement_value #>> '{}')::int
--
--   The `#>> '{}'` operator extracts the jsonb scalar as text, then
--   casts to integer. That is the pattern this migration aligns with.
--
--   Migration 0073 was already applied to staging by the CI run on
--   commit ba6bc6a. It cannot be edited. This migration replaces the
--   function body in place via create or replace — same signature,
--   same RETURNS TABLE shape, only the four cast expressions change.
--
-- Companion fix:
--   The pgTAP test 21 fixture (supabase/tests/21_platform_org_usage_counts.sql)
--   inserted bare integers into the jsonb column. Postgres rejects the
--   implicit int→jsonb cast at insert time, which aborted the whole
--   test file before the RPC was ever invoked. Fixed in the same commit
--   by quoting-and-casting the four values: '5'::jsonb, '3'::jsonb,
--   '4'::jsonb, '100'::jsonb. Matches the seed convention in migration
--   0058 (line 91): '1'::jsonb.
--
-- Not changed:
--   - Function signature (p_organization_id uuid)
--   - RETURNS TABLE column names or order
--   - The is_platform_admin() gate
--   - The union-all branch structure
--   - Any other migration
-- ============================================================================


create or replace function public.platform_org_usage_counts(
  p_organization_id uuid
)
returns table (
  entitlement_code text,
  used             integer,
  max              integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN';
  end if;

  select s.plan_id
    into v_plan_id
    from public.subscriptions s
   where s.organization_id = p_organization_id
     and s.status in ('trial', 'active', 'past_due', 'grace_period')
   order by s.current_period_end desc
   limit 1;

  return query
    select
      'max_properties'::text as entitlement_code,
      (select count(*)::int
         from public.properties p
        where p.organization_id = p_organization_id
          and p.status = 'active') as used,
      coalesce(
        (select (pe.entitlement_value #>> '{}')::int
           from public.plan_entitlements pe
          where pe.plan_id = v_plan_id
            and pe.entitlement_code = 'max_properties'),
        0
      )::int as max
    union all
    select
      'max_gates'::text,
      (select count(*)::int
         from public.gates g
        where g.organization_id = p_organization_id
          and g.status = 'active'),
      coalesce(
        (select (pe.entitlement_value #>> '{}')::int
           from public.plan_entitlements pe
          where pe.plan_id = v_plan_id
            and pe.entitlement_code = 'max_gates'),
        0
      )::int
    union all
    select
      'max_guards'::text,
      (select count(*)::int
         from public.guard_profiles gp
        where gp.organization_id = p_organization_id
          and gp.status = 'active'),
      coalesce(
        (select (pe.entitlement_value #>> '{}')::int
           from public.plan_entitlements pe
          where pe.plan_id = v_plan_id
            and pe.entitlement_code = 'max_guards'),
        0
      )::int
    union all
    select
      'max_units'::text,
      (select count(*)::int
         from public.units u
         join public.properties p on p.id = u.property_id
        where p.organization_id = p_organization_id
          and u.status = 'active'),
      coalesce(
        (select (pe.entitlement_value #>> '{}')::int
           from public.plan_entitlements pe
          where pe.plan_id = v_plan_id
            and pe.entitlement_code = 'max_units'),
        0
      )::int;
end;
$$;

comment on function public.platform_org_usage_counts(uuid) is
  'Platform-admin only. Returns the four countable resource counts for one organization alongside the plan''s entitlement caps. SECURITY DEFINER. Reads entitlement_value via #>> ''{}'' to align with migration 0037''s proven pattern.';
