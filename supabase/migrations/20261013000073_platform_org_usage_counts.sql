-- ============================================================================
-- Migration 0073: platform_org_usage_counts
-- ============================================================================
-- Purpose:
--   Returns the four countable resource counts for one organization
--   alongside the plan's entitlement caps. Used by the platform
--   drill-down (/platform/orgs/[id]) to render a Usage panel without
--   needing cross-tenant SELECT on tenant-scoped tables.
--
-- Why SECURITY DEFINER:
--   Two reasons, both required:
--     1. Platform-admin gate. is_platform_admin() calls are the only
--        authorized callers.
--     2. The four countable tables (properties, gates, guard_profiles,
--        units) each have is_org_member(organization_id) RLS policies
--        and no platform-admin policy. A platform admin cannot read
--        them cross-tenant via PostgREST. SECURITY DEFINER runs the
--        body as the owner (postgres), which bypasses RLS.
--     plan_entitlements is read inside the function for the same
--     reason — no dependency on any direct policy.
--
-- Countable codes (from public.plan_entitlements):
--   max_properties, max_gates, max_guards, max_units
--
-- Units scoping:
--   units has no organization_id. Scope goes through property_id →
--   properties.organization_id. Same subquery pattern as the estate
--   billing page (Task B2).
--
-- Return shape:
--   entitlement_code  text      -- one of the four codes
--   used              integer   -- current count of active resources
--   max               integer   -- entitlement value, coalesced to 0
--
-- Ordering:
--   Fixed order: properties, gates, guards, units. Matches the estate
--   billing page's COUNTABLE_KEYS. Deterministic.
--
-- No-subscription case:
--   If the org has no operational subscription, max is 0 for all four
--   rows. used is still the real active count. That is honest — an org
--   without a plan has no cap to compare against.
--
-- Errors:
--   NOT_PLATFORM_ADMIN — caller is not a platform admin.
--   No org-found error — unknown org id returns four rows of 0/real.
--   The panel that consumes this is only reached via a valid org row
--   on the dashboard.
--
-- Ambiguity discipline (§11):
--   Every column reference qualified with a table alias.
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

  -- Latest operational subscription, if any.
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
        (select pe.entitlement_value::int
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
        (select pe.entitlement_value::int
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
        (select pe.entitlement_value::int
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
        (select pe.entitlement_value::int
           from public.plan_entitlements pe
          where pe.plan_id = v_plan_id
            and pe.entitlement_code = 'max_units'),
        0
      )::int;
end;
$$;

comment on function public.platform_org_usage_counts(uuid) is
  'Platform-admin only. Returns the four countable resource counts for one organization alongside the plan''s entitlement caps. SECURITY DEFINER — tenant tables have no platform-admin policy; this function is the read path.';
