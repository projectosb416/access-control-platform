-- ============================================================================
-- Test: create_guest_pin_for_unit
-- ============================================================================
-- Covers the resident-facing wrapper: authentication, primary-resident
-- authorization, subscription lock, unit state, visitor person reuse,
-- and the UNIT_NOT_ACTIVE branch introduced by migration 0050.
--
-- Wrapped in begin/rollback. Fixtures use UUIDs prefixed 'c8'.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(7);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at) values
  ('c8000000-0000-0000-0000-000000000001', 'test-guestpin-admin@test.com',    now(), now()),
  ('c8000000-0000-0000-0000-000000000002', 'test-guestpin-resident@test.com', now(), now());

insert into public.organizations (id, name, display_name, organization_type, status)
values ('c8000000-0000-0000-0000-000000000010', 'test-guestpin-org', 'Test Guest PIN',
        'residential', 'active');

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'c8000000-0000-0000-0000-000000000010', a.id, 'admin', 'active', now()
from public.accounts a where a.auth_user_id = 'c8000000-0000-0000-0000-000000000001';

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'c8000000-0000-0000-0000-000000000010', a.id, 'primary_resident', 'active', now()
from public.accounts a where a.auth_user_id = 'c8000000-0000-0000-0000-000000000002';

insert into public.plans (id, code, name, currency, price_minor_units, billing_cycle_months, status)
values ('c8000000-0000-0000-0000-000000000020', 'test-guestpin-plan', 'Test Guest PIN Plan',
        'NGN', 100000, 12, 'active');

insert into public.subscriptions (id, organization_id, plan_id, status,
                                   current_period_start, current_period_end)
values ('c8000000-0000-0000-0000-000000000021',
        'c8000000-0000-0000-0000-000000000010',
        'c8000000-0000-0000-0000-000000000020',
        'active', now(), now() + interval '12 months');

insert into public.properties (id, organization_id, name, status)
values ('c8000000-0000-0000-0000-000000000030', 'c8000000-0000-0000-0000-000000000010',
        'Test Guest PIN Property', 'active');

insert into public.units (id, property_id, label, status) values
  ('c8000000-0000-0000-0000-000000000040', 'c8000000-0000-0000-0000-000000000030', 'Unit 1', 'active'),
  ('c8000000-0000-0000-0000-000000000041', 'c8000000-0000-0000-0000-000000000030', 'Unit 2', 'archived');

-- Resident person + active occupancy on Unit 1
insert into public.people (id, organization_id, account_id, full_name, status)
select 'c8000000-0000-0000-0000-000000000050', 'c8000000-0000-0000-0000-000000000010',
       a.id, 'Guest PIN Resident', 'active'
from public.accounts a where a.auth_user_id = 'c8000000-0000-0000-0000-000000000002';

insert into public.occupancies (unit_id, account_id, status, started_at)
select 'c8000000-0000-0000-0000-000000000040', a.id, 'active', now()
from public.accounts a where a.auth_user_id = 'c8000000-0000-0000-0000-000000000002';

-- ============================================================================
-- Assertion 1: Primary resident creates guest PIN (happy path)
-- Captures the visitor person_id so Assertion 2 can prove reuse.
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"c8000000-0000-0000-0000-000000000002"}', true);

select set_config('test.b8_person_a',
  (select person_id::text from public.create_guest_pin_for_unit(
    'c8000000-0000-0000-0000-000000000040'::uuid,
    'Reuse Test'::text,
    '+2348000008888'::text,
    'first visit'::text,
    'one_time'::text,
    now()::timestamptz,
    (now() + interval '2 hours')::timestamptz,
    '$pbkdf2-sha256$i=100000$AAAA$BBBB'::text,
    'test-b8-lookup-a'::text
  )),
  true
);

select ok(
  length(coalesce(current_setting('test.b8_person_a', true), '')) > 0,
  'A: primary resident creates guest PIN, receives person_id'
);

-- ============================================================================
-- Assertion 2: Same visitor name + phone reuses the person row
-- ============================================================================

select is(
  (select person_id::text from public.create_guest_pin_for_unit(
    'c8000000-0000-0000-0000-000000000040'::uuid,
    'Reuse Test'::text,
    '+2348000008888'::text,
    'follow-up'::text,
    'one_time'::text,
    now()::timestamptz,
    (now() + interval '1 hour')::timestamptz,
    '$pbkdf2-sha256$i=100000$CCCC$DDDD'::text,
    'test-b8-lookup-b'::text
  )),
  current_setting('test.b8_person_a', true),
  'B: visitor person reused on name + phone match'
);

-- ============================================================================
-- Assertion 3: Admin (no occupancy on this unit) → NOT_AUTHORIZED
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"c8000000-0000-0000-0000-000000000001"}', true);

select throws_ok(
  $$select public.create_guest_pin_for_unit(
    'c8000000-0000-0000-0000-000000000040'::uuid,
    'Admin Attempt'::text,
    null::text,
    'should fail'::text,
    'one_time'::text,
    now()::timestamptz,
    (now() + interval '1 hour')::timestamptz,
    '$pbkdf2-sha256$i=100000$EEEE$FFFF'::text,
    'test-b8-lookup-c'::text
  )$$,
  'P0001',
  'NOT_AUTHORIZED',
  'C: non-resident caller rejected as NOT_AUTHORIZED'
);

-- ============================================================================
-- Assertion 4: Missing full name → FULL_NAME_REQUIRED
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"c8000000-0000-0000-0000-000000000002"}', true);

select throws_ok(
  $$select public.create_guest_pin_for_unit(
    'c8000000-0000-0000-0000-000000000040'::uuid,
    ''::text,
    null::text,
    'x'::text,
    'one_time'::text,
    now()::timestamptz,
    (now() + interval '1 hour')::timestamptz,
    '$pbkdf2-sha256$i=100000$GGGG$HHHH'::text,
    'test-b8-lookup-d'::text
  )$$,
  'P0001',
  'FULL_NAME_REQUIRED',
  'D: empty visitor full name rejected'
);

-- ============================================================================
-- Assertion 5: valid_until <= valid_from → INVALID_VALIDITY_WINDOW
-- ============================================================================

select throws_ok(
  $$select public.create_guest_pin_for_unit(
    'c8000000-0000-0000-0000-000000000040'::uuid,
    'Window Test'::text,
    null::text,
    'x'::text,
    'one_time'::text,
    (now() + interval '2 hours')::timestamptz,
    (now() + interval '1 hour')::timestamptz,
    '$pbkdf2-sha256$i=100000$IIII$JJJJ'::text,
    'test-b8-lookup-e'::text
  )$$,
  'P0001',
  'INVALID_VALIDITY_WINDOW',
  'E: reversed validity window rejected'
);

-- ============================================================================
-- Assertion 6: Unauthenticated caller → NOT_AUTHENTICATED
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009998"}', true);

select throws_ok(
  $$select public.create_guest_pin_for_unit(
    'c8000000-0000-0000-0000-000000000040'::uuid,
    'No Auth'::text,
    null::text,
    'x'::text,
    'one_time'::text,
    now()::timestamptz,
    (now() + interval '1 hour')::timestamptz,
    '$pbkdf2-sha256$i=100000$KKKK$LLLL'::text,
    'test-b8-lookup-f'::text
  )$$,
  'P0001',
  'NOT_AUTHENTICATED',
  'F: unauthenticated caller rejected'
);

-- ============================================================================
-- Assertion 7: Non-active unit → UNIT_NOT_ACTIVE (migration 0050 rename)
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"c8000000-0000-0000-0000-000000000002"}', true);

select throws_ok(
  $$select public.create_guest_pin_for_unit(
    'c8000000-0000-0000-0000-000000000041'::uuid,
    'Archived Test'::text,
    null::text,
    'x'::text,
    'one_time'::text,
    now()::timestamptz,
    (now() + interval '1 hour')::timestamptz,
    '$pbkdf2-sha256$i=100000$MMMM$NNNN'::text,
    'test-b8-lookup-g'::text
  )$$,
  'P0001',
  'UNIT_NOT_ACTIVE',
  'G: non-active unit rejected as UNIT_NOT_ACTIVE'
);

select * from finish();

rollback;
