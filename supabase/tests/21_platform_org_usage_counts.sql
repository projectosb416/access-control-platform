-- ============================================================================
-- Test: platform_org_usage_counts (migration 0073)
-- ============================================================================
-- Five assertions:
--   A. Platform admin gets four rows
--   B. Counts match the fixture (2 properties, 1 gate, 1 guard, 3 units)
--   C. Max values come from the plan's entitlements
--   D. Non-platform-admin caller rejected
--   E. Org without a subscription gets max=0 for all rows
--
-- Fixtures use UUID prefix 'cb'. Wrapped in begin/rollback.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(5);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at) values
  ('cb000000-0000-0000-0000-000000000001', 'test-usage-platform@test.com', now(), now()),
  ('cb000000-0000-0000-0000-000000000002', 'test-usage-admin@test.com',    now(), now()),
  ('cb000000-0000-0000-0000-000000000003', 'test-usage-regular@test.com',  now(), now());

-- Platform admin grant for user 1
insert into public.platform_admins (account_id, notes)
select a.id, 'test fixture'
from public.accounts a
where a.auth_user_id = 'cb000000-0000-0000-0000-000000000001';

-- Two orgs: one with subscription, one without
insert into public.organizations (id, name, display_name, organization_type, status) values
  ('cb000000-0000-0000-0000-000000000010', 'test-usage-org', 'Test Usage Org',
   'residential', 'active'),
  ('cb000000-0000-0000-0000-000000000011', 'test-usage-nosub', 'Test Usage NoSub',
   'residential', 'active');

-- Plan + entitlements for org 10
insert into public.plans (id, code, name, currency, price_minor_units, billing_cycle_months, status)
values ('cb000000-0000-0000-0000-000000000020', 'test-usage-plan', 'Test Usage Plan',
        'NGN', 100000, 12, 'active');

insert into public.plan_entitlements (plan_id, entitlement_code, entitlement_value) values
  ('cb000000-0000-0000-0000-000000000020', 'max_properties', '5'::jsonb),
  ('cb000000-0000-0000-0000-000000000020', 'max_gates',      '3'::jsonb),
  ('cb000000-0000-0000-0000-000000000020', 'max_guards',     '4'::jsonb),
  ('cb000000-0000-0000-0000-000000000020', 'max_units',      '100'::jsonb);

-- Operational subscription for org 10
insert into public.subscriptions (organization_id, plan_id, status, current_period_start, current_period_end)
values ('cb000000-0000-0000-0000-000000000010',
        'cb000000-0000-0000-0000-000000000020',
        'active', now(), now() + interval '12 months');

-- Countable resources for org 10:
--   properties: 2 active
--   gates: 1 active (plus 1 archived — should not count)
--   guard_profiles: 1 active
--   units: 3 active across the 2 properties (plus 1 archived)
insert into public.properties (id, organization_id, name, status) values
  ('cb000000-0000-0000-0000-000000000030', 'cb000000-0000-0000-0000-000000000010', 'Property A', 'active'),
  ('cb000000-0000-0000-0000-000000000031', 'cb000000-0000-0000-0000-000000000010', 'Property B', 'active');

insert into public.gates (id, organization_id, name, max_active_guards, status) values
  ('cb000000-0000-0000-0000-000000000040', 'cb000000-0000-0000-0000-000000000010', 'Gate 1', 2, 'active'),
  ('cb000000-0000-0000-0000-000000000041', 'cb000000-0000-0000-0000-000000000010', 'Gate Old', 2, 'archived');

insert into public.people (id, organization_id, full_name) values
  ('cb000000-0000-0000-0000-000000000050', 'cb000000-0000-0000-0000-000000000010', 'Test Guard');

insert into public.guard_profiles (id, organization_id, person_id, guard_code, status) values
  ('cb000000-0000-0000-0000-000000000060', 'cb000000-0000-0000-0000-000000000010',
   'cb000000-0000-0000-0000-000000000050', 'GU-TESTCB', 'active');

insert into public.units (id, property_id, unit_number, status) values
  ('cb000000-0000-0000-0000-000000000070', 'cb000000-0000-0000-0000-000000000030', 'A-01', 'active'),
  ('cb000000-0000-0000-0000-000000000071', 'cb000000-0000-0000-0000-000000000030', 'A-02', 'active'),
  ('cb000000-0000-0000-0000-000000000072', 'cb000000-0000-0000-0000-000000000031', 'B-01', 'active'),
  ('cb000000-0000-0000-0000-000000000073', 'cb000000-0000-0000-0000-000000000031', 'B-OLD', 'archived');

-- ============================================================================
-- Authenticate as platform admin
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"cb000000-0000-0000-0000-000000000001"}', true);

-- ============================================================================
-- A. Four rows returned
-- ============================================================================

select is(
  (select count(*)::int from public.platform_org_usage_counts(
    'cb000000-0000-0000-0000-000000000010'::uuid)),
  4,
  'A: platform admin gets four usage rows'
);

-- ============================================================================
-- B. Counts match fixture (2 / 1 / 1 / 3)
-- ============================================================================

select is(
  (select string_agg(u.used::text, ',' order by u.entitlement_code)
     from public.platform_org_usage_counts(
       'cb000000-0000-0000-0000-000000000010'::uuid) u),
  '1,1,2,3',
  'B: counts match fixture (sorted by code: max_gates=1, max_guards=1, max_properties=2, max_units=3)'
);

-- ============================================================================
-- C. Max values come from the plan entitlements (5 / 3 / 4 / 100)
-- ============================================================================

select is(
  (select string_agg(u.max::text, ',' order by u.entitlement_code)
     from public.platform_org_usage_counts(
       'cb000000-0000-0000-0000-000000000010'::uuid) u),
  '3,4,5,100',
  'C: max values match plan entitlements'
);

-- ============================================================================
-- D. Non-platform-admin rejected
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"cb000000-0000-0000-0000-000000000003"}', true);

select throws_ok(
  $$select * from public.platform_org_usage_counts(
      'cb000000-0000-0000-0000-000000000010'::uuid)$$,
  'P0001',
  'NOT_PLATFORM_ADMIN',
  'D: non-platform-admin caller rejected'
);

-- ============================================================================
-- E. Org without subscription gets max=0
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"cb000000-0000-0000-0000-000000000001"}', true);

select is(
  (select sum(u.max)::int
     from public.platform_org_usage_counts(
       'cb000000-0000-0000-0000-000000000011'::uuid) u),
  0,
  'E: org without subscription gets max=0 for all rows'
);

select * from finish();

rollback;
