-- ============================================================================
-- Test: start_shift_session
-- ============================================================================
-- Covers the concurrency-critical path: gate capacity enforcement, guard
-- already-on-shift protection, idempotent re-auth, and error handling.
--
-- Wrapped in begin/rollback — no fixtures persist.
-- Fixtures use UUIDs prefixed 'b2'.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(9);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at)
values ('b2000000-0000-0000-0000-000000000001', 'test-shift-admin@test.com', now(), now());

insert into public.organizations (id, name, display_name, organization_type, status)
values ('b2000000-0000-0000-0000-000000000010', 'test-shift-org', 'Test Shift',
        'residential', 'active');

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'b2000000-0000-0000-0000-000000000010', a.id, 'admin', 'active', now()
from public.accounts a where a.auth_user_id = 'b2000000-0000-0000-0000-000000000001';

insert into public.plans (id, code, name, currency, price_minor_units, billing_cycle_months, status)
values ('b2000000-0000-0000-0000-000000000020', 'test-shift-plan', 'Test Shift Plan',
        'NGN', 100000, 12, 'active');

insert into public.subscriptions (organization_id, plan_id, status,
                                   current_period_start, current_period_end)
values ('b2000000-0000-0000-0000-000000000010', 'b2000000-0000-0000-0000-000000000020',
        'active', now(), now() + interval '12 months');

-- Three guards
insert into public.people (id, organization_id, full_name) values
  ('b2000000-0000-0000-0000-000000000030', 'b2000000-0000-0000-0000-000000000010', 'Guard 1'),
  ('b2000000-0000-0000-0000-000000000031', 'b2000000-0000-0000-0000-000000000010', 'Guard 2'),
  ('b2000000-0000-0000-0000-000000000032', 'b2000000-0000-0000-0000-000000000010', 'Guard 3');

insert into public.guard_profiles (id, organization_id, person_id, guard_code, status) values
  ('b2000000-0000-0000-0000-000000000040', 'b2000000-0000-0000-0000-000000000010',
   'b2000000-0000-0000-0000-000000000030', 'GU-SHIFT1', 'active'),
  ('b2000000-0000-0000-0000-000000000041', 'b2000000-0000-0000-0000-000000000010',
   'b2000000-0000-0000-0000-000000000031', 'GU-SHIFT2', 'active'),
  ('b2000000-0000-0000-0000-000000000042', 'b2000000-0000-0000-0000-000000000010',
   'b2000000-0000-0000-0000-000000000032', 'GU-SHIFT3', 'active');

-- Gate 1: max 2 guards. Gate 2: max 1 guard.
insert into public.gates (id, organization_id, name, max_active_guards, status) values
  ('b2000000-0000-0000-0000-000000000050', 'b2000000-0000-0000-0000-000000000010',
   'Gate A', 2, 'active'),
  ('b2000000-0000-0000-0000-000000000051', 'b2000000-0000-0000-0000-000000000010',
   'Gate B', 1, 'active');

-- Two shifts: A on Gate A, B on Gate B. Both currently open.
insert into public.shifts (id, organization_id, gate_id, shift_code,
                            scheduled_start, scheduled_end, status) values
  ('b2000000-0000-0000-0000-000000000060', 'b2000000-0000-0000-0000-000000000010',
   'b2000000-0000-0000-0000-000000000050', 'SH-SHIFT1',
   now() - interval '10 min', now() + interval '4 hours', 'scheduled'),
  ('b2000000-0000-0000-0000-000000000061', 'b2000000-0000-0000-0000-000000000010',
   'b2000000-0000-0000-0000-000000000051', 'SH-SHIFT2',
   now() - interval '10 min', now() + interval '4 hours', 'scheduled');

-- ============================================================================
-- Assertion 1: Guard 1 starts Shift A → returns one row
-- ============================================================================
select is(
  (select count(*)::int from public.start_shift_session(
    'b2000000-0000-0000-0000-000000000010',
    'SH-SHIFT1', 'GU-SHIFT1',
    '1111111111111111111111111111111111111111111111111111111111111111',
    30
  )),
  1,
  'start_shift_session returns one row on valid start'
);

-- ============================================================================
-- Assertion 2: Guard 1's session is active with correct hash
-- ============================================================================
select is(
  (select session_token_hash from public.shift_sessions
    where guard_profile_id = 'b2000000-0000-0000-0000-000000000040'
      and status = 'active'),
  '1111111111111111111111111111111111111111111111111111111111111111',
  'session row exists with correct token hash'
);

-- ============================================================================
-- Assertion 3: Guard 2 starts same shift → second session (capacity 2 not exceeded)
-- ============================================================================
select is(
  (select count(*)::int from public.start_shift_session(
    'b2000000-0000-0000-0000-000000000010',
    'SH-SHIFT1', 'GU-SHIFT2',
    '2222222222222222222222222222222222222222222222222222222222222222',
    30
  )),
  1,
  'second guard can start when capacity allows'
);

-- ============================================================================
-- Assertion 4: Guard 3 start on same gate → GATE_CAPACITY_REACHED
-- ============================================================================
select throws_ok(
  $$select public.start_shift_session(
    'b2000000-0000-0000-0000-000000000010',
    'SH-SHIFT1', 'GU-SHIFT3',
    '3333333333333333333333333333333333333333333333333333333333333333',
    30
  )$$,
  'P0001',
  'GATE_CAPACITY_REACHED',
  'third guard rejected when gate is at capacity'
);

-- ============================================================================
-- Assertion 5: Guard 1 starts a different shift → GUARD_ALREADY_ON_SHIFT
-- ============================================================================
select throws_ok(
  $$select public.start_shift_session(
    'b2000000-0000-0000-0000-000000000010',
    'SH-SHIFT2', 'GU-SHIFT1',
    '4444444444444444444444444444444444444444444444444444444444444444',
    30
  )$$,
  'P0001',
  'GUARD_ALREADY_ON_SHIFT',
  'guard cannot start a second shift while active on another'
);

-- ============================================================================
-- Assertion 6: Guard 1 re-auths same shift → same session_id returned
-- ============================================================================
select is(
  (select session_id from public.start_shift_session(
    'b2000000-0000-0000-0000-000000000010',
    'SH-SHIFT1', 'GU-SHIFT1',
    '5555555555555555555555555555555555555555555555555555555555555555',
    30
  )),
  (select id from public.shift_sessions
    where guard_profile_id = 'b2000000-0000-0000-0000-000000000040'
      and status = 'active'),
  're-auth on same shift returns the original session_id'
);

-- ============================================================================
-- Assertion 7: Re-auth overwrote the hash
-- ============================================================================
select is(
  (select session_token_hash from public.shift_sessions
    where guard_profile_id = 'b2000000-0000-0000-0000-000000000040'
      and status = 'active'),
  '5555555555555555555555555555555555555555555555555555555555555555',
  're-auth overwrites the token hash'
);

-- ============================================================================
-- Assertion 8: Invalid hash format → INVALID_SESSION_TOKEN_HASH
-- ============================================================================
select throws_ok(
  $$select public.start_shift_session(
    'b2000000-0000-0000-0000-000000000010',
    'SH-SHIFT1', 'GU-SHIFT2',
    'not-a-valid-hash',
    30
  )$$,
  'P0001',
  'INVALID_SESSION_TOKEN_HASH',
  'malformed token hash is rejected'
);

-- ============================================================================
-- Assertion 9: Unknown shift code → SHIFT_NOT_FOUND
-- ============================================================================
select throws_ok(
  $$select public.start_shift_session(
    'b2000000-0000-0000-0000-000000000010',
    'SH-DOES-NOT-EXIST', 'GU-SHIFT1',
    '6666666666666666666666666666666666666666666666666666666666666666',
    30
  )$$,
  'P0001',
  'SHIFT_NOT_FOUND',
  'unknown shift code raises SHIFT_NOT_FOUND'
);

select * from finish();

rollback;
