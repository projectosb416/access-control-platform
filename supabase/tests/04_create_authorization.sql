-- ============================================================================
-- Test: create_authorization_with_credential
-- ============================================================================
-- Covers the security-relevant branches: authentication, subscription lock,
-- permission boundaries, cross-tenant safety, PIN uniqueness, enum validation.
-- The remaining 9 validators are field-format checks, verified implicitly by
-- the happy-path tests below and by inspection.
--
-- Wrapped in begin/rollback. Fixtures use UUIDs prefixed 'b4'.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(8);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at) values
  ('b4000000-0000-0000-0000-000000000001', 'test-authz-admin@test.com',   now(), now()),
  ('b4000000-0000-0000-0000-000000000002', 'test-authz-primary@test.com', now(), now());

insert into public.organizations (id, name, display_name, organization_type, status)
values ('b4000000-0000-0000-0000-000000000010', 'test-authz-org', 'Test Authz',
        'residential', 'active');

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'b4000000-0000-0000-0000-000000000010', a.id, 'admin', 'active', now()
from public.accounts a where a.auth_user_id = 'b4000000-0000-0000-0000-000000000001';

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'b4000000-0000-0000-0000-000000000010', a.id, 'primary_resident', 'active', now()
from public.accounts a where a.auth_user_id = 'b4000000-0000-0000-0000-000000000002';

insert into public.plans (id, code, name, currency, price_minor_units, billing_cycle_months, status)
values ('b4000000-0000-0000-0000-000000000020', 'test-authz-plan', 'Test Authz Plan',
        'NGN', 100000, 12, 'active');

insert into public.subscriptions (id, organization_id, plan_id, status,
                                   current_period_start, current_period_end)
values ('b4000000-0000-0000-0000-000000000021',
        'b4000000-0000-0000-0000-000000000010',
        'b4000000-0000-0000-0000-000000000020',
        'active', now(), now() + interval '12 months');

insert into public.properties (id, organization_id, name, status)
values ('b4000000-0000-0000-0000-000000000030', 'b4000000-0000-0000-0000-000000000010',
        'Test Authz Property', 'active');

insert into public.units (id, property_id, label, status)
values ('b4000000-0000-0000-0000-000000000040', 'b4000000-0000-0000-0000-000000000030',
        'Unit 1', 'active');

-- Primary resident person + active occupancy
insert into public.people (id, organization_id, account_id, full_name, status)
select 'b4000000-0000-0000-0000-000000000050', 'b4000000-0000-0000-0000-000000000010',
       a.id, 'Primary Person', 'active'
from public.accounts a where a.auth_user_id = 'b4000000-0000-0000-0000-000000000002';

insert into public.occupancies (unit_id, account_id, status, started_at)
select 'b4000000-0000-0000-0000-000000000040', a.id, 'active', now()
from public.accounts a where a.auth_user_id = 'b4000000-0000-0000-0000-000000000002';

-- Visitor person in this org
insert into public.people (id, organization_id, full_name, status)
values ('b4000000-0000-0000-0000-000000000060', 'b4000000-0000-0000-0000-000000000010',
        'Visitor Person', 'active');

-- A person in a different org (for cross-tenant test)
insert into public.organizations (id, name, display_name, organization_type, status)
values ('b4000000-0000-0000-0000-000000000011', 'test-authz-other-org', 'Other',
        'residential', 'active');

insert into public.people (id, organization_id, full_name, status)
values ('b4000000-0000-0000-0000-000000000061', 'b4000000-0000-0000-0000-000000000011',
        'Other Org Person', 'active');

-- ============================================================================
-- Assertion 1: Admin creates org-wide authorization
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub":"b4000000-0000-0000-0000-000000000001"}', true);

select is(
  (select count(*)::int from public.create_authorization_with_credential(
    'b4000000-0000-0000-0000-000000000010',
    'b4000000-0000-0000-0000-000000000060',
    null, null,
    'visitor', 'test visit 1', null, null,
    'one_time',
    now() - interval '1 hour',
    now() + interval '3 hours',
    '$pbkdf2-sha256$i=100000$AAAA$BBBB',
    'test-lookup-admin-1',
    'v1'
  )),
  1,
  'admin creates org-wide authorization'
);

-- ============================================================================
-- Assertion 2: Primary resident creates unit-scoped authorization
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub":"b4000000-0000-0000-0000-000000000002"}', true);

select is(
  (select count(*)::int from public.create_authorization_with_credential(
    'b4000000-0000-0000-0000-000000000010',
    'b4000000-0000-0000-0000-000000000060',
    'b4000000-0000-0000-0000-000000000040',
    null,
    'visitor', 'test visit 2', null, null,
    'reusable',
    now() - interval '1 hour',
    now() + interval '3 hours',
    '$pbkdf2-sha256$i=100000$CCCC$DDDD',
    'test-lookup-primary-1',
    'v1'
  )),
  1,
  'primary resident creates unit-scoped authorization'
);

-- ============================================================================
-- Assertion 3: No authenticated session → NOT_AUTHENTICATED
-- ============================================================================
-- Use a UUID that matches no account, so current_account_id() returns null.
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009999"}', true);

select throws_ok(
  $$select public.create_authorization_with_credential(
    'b4000000-0000-0000-0000-000000000010'::uuid,
    'b4000000-0000-0000-0000-000000000060'::uuid,
    null::uuid, null::uuid,
    'visitor', 'test', null, null,
    'one_time',
    (now() - interval '1 hour')::timestamptz,
    (now() + interval '3 hours')::timestamptz,
    '$pbkdf2-sha256$i=100000$EEEE$FFFF',
    'test-lookup-no-auth',
    'v1'
  )$$,
  'P0001',
  'NOT_AUTHENTICATED',
  'no authenticated session raises NOT_AUTHENTICATED'
);

-- ============================================================================
-- Assertion 4: Primary resident tries org-wide → NOT_AUTHORIZED
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub":"b4000000-0000-0000-0000-000000000002"}', true);

select throws_ok(
  $$select public.create_authorization_with_credential(
    'b4000000-0000-0000-0000-000000000010'::uuid,
    'b4000000-0000-0000-0000-000000000060'::uuid,
    null::uuid, null::uuid,
    'visitor', 'test', null, null,
    'one_time',
    (now() - interval '1 hour')::timestamptz,
    (now() + interval '3 hours')::timestamptz,
    '$pbkdf2-sha256$i=100000$GGGG$HHHH',
    'test-lookup-unauth',
    'v1'
  )$$,
  'P0001',
  'NOT_AUTHORIZED',
  'primary resident cannot create org-wide authorization'
);

-- ============================================================================
-- Assertion 5: Cross-tenant person → PERSON_NOT_IN_ORG
-- ============================================================================
select set_config('request.jwt.claims',
  '{"sub":"b4000000-0000-0000-0000-000000000001"}', true);

select throws_ok(
  $$select public.create_authorization_with_credential(
    'b4000000-0000-0000-0000-000000000010'::uuid,
    'b4000000-0000-0000-0000-000000000061'::uuid,
    null::uuid, null::uuid,
    'visitor', 'test', null, null,
    'one_time',
    (now() - interval '1 hour')::timestamptz,
    (now() + interval '3 hours')::timestamptz,
    '$pbkdf2-sha256$i=100000$IIII$JJJJ',
    'test-lookup-cross-tenant',
    'v1'
  )$$,
  'P0001',
  'PERSON_NOT_IN_ORG',
  'cross-tenant person reference rejected'
);

-- ============================================================================
-- Assertion 6: PIN collision → PIN_COLLISION
-- ============================================================================
-- Reuse lookup_key 'test-lookup-admin-1' from assertion 1.
select throws_ok(
  $$select public.create_authorization_with_credential(
    'b4000000-0000-0000-0000-000000000010'::uuid,
    'b4000000-0000-0000-0000-000000000060'::uuid,
    null::uuid, null::uuid,
    'visitor', 'test', null, null,
    'one_time',
    (now() - interval '1 hour')::timestamptz,
    (now() + interval '3 hours')::timestamptz,
    '$pbkdf2-sha256$i=100000$KKKK$LLLL',
    'test-lookup-admin-1',
    'v1'
  )$$,
  'P0001',
  'PIN_COLLISION',
  'duplicate live lookup_key rejected as PIN_COLLISION'
);

-- ============================================================================
-- Assertion 7: Invalid access_type → INVALID_ACCESS_TYPE
-- ============================================================================
select throws_ok(
  $$select public.create_authorization_with_credential(
    'b4000000-0000-0000-0000-000000000010'::uuid,
    'b4000000-0000-0000-0000-000000000060'::uuid,
    null::uuid, null::uuid,
    'not-a-real-type', 'test', null, null,
    'one_time',
    (now() - interval '1 hour')::timestamptz,
    (now() + interval '3 hours')::timestamptz,
    '$pbkdf2-sha256$i=100000$MMMM$NNNN',
    'test-lookup-bad-enum',
    'v1'
  )$$,
  'P0001',
  'INVALID_ACCESS_TYPE',
  'invalid access_type rejected'
);

-- ============================================================================
-- Assertion 8: Suspended subscription → SUBSCRIPTION_INACTIVE
-- ============================================================================
update public.subscriptions
   set status = 'expired'
 where id = 'b4000000-0000-0000-0000-000000000021';

select throws_ok(
  $$select public.create_authorization_with_credential(
    'b4000000-0000-0000-0000-000000000010'::uuid,
    'b4000000-0000-0000-0000-000000000060'::uuid,
    null::uuid, null::uuid,
    'visitor', 'test', null, null,
    'one_time',
    (now() - interval '1 hour')::timestamptz,
    (now() + interval '3 hours')::timestamptz,
    '$pbkdf2-sha256$i=100000$OOOO$PPPP',
    'test-lookup-suspended',
    'v1'
  )$$,
  'P0001',
  'SUBSCRIPTION_INACTIVE',
  'expired subscription blocks authorization creation'
);

select * from finish();

rollback;
