-- ============================================================================
-- Test: list_guest_pins_for_unit
-- ============================================================================
-- Covers the read-only list RPC added in migration 0051: authentication,
-- residency check, created_by filter, scope_unit_id filter, the three-branch
-- status filter, and entry_count.
--
-- access_events has NOT NULL on gate_id and guard_profile_id, so a gate
-- fixture and a guard_profile (which needs its own person row) are required
-- to insert the GRANTED entry event that drives assertion H.
--
-- Fixtures use UUIDs prefixed 'd9'. Wrapped in begin/rollback.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(8);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at) values
  ('d9000000-0000-0000-0000-000000000001', 'test-listpin-admin@test.com',      now(), now()),
  ('d9000000-0000-0000-0000-000000000002', 'test-listpin-resident-a@test.com', now(), now()),
  ('d9000000-0000-0000-0000-000000000003', 'test-listpin-resident-b@test.com', now(), now());

insert into public.organizations (id, name, display_name, organization_type, status)
values ('d9000000-0000-0000-0000-000000000010', 'test-listpin-org', 'Test List PIN',
        'residential', 'active');

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'd9000000-0000-0000-0000-000000000010', a.id, 'admin', 'active', now()
from public.accounts a where a.auth_user_id = 'd9000000-0000-0000-0000-000000000001';

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'd9000000-0000-0000-0000-000000000010', a.id, 'primary_resident', 'active', now()
from public.accounts a where a.auth_user_id = 'd9000000-0000-0000-0000-000000000002';

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'd9000000-0000-0000-0000-000000000010', a.id, 'primary_resident', 'active', now()
from public.accounts a where a.auth_user_id = 'd9000000-0000-0000-0000-000000000003';

insert into public.plans (id, code, name, currency, price_minor_units, billing_cycle_months, status)
values ('d9000000-0000-0000-0000-000000000020', 'test-listpin-plan', 'Test List PIN Plan',
        'NGN', 100000, 12, 'active');

insert into public.subscriptions (id, organization_id, plan_id, status,
                                   current_period_start, current_period_end)
values ('d9000000-0000-0000-0000-000000000021',
        'd9000000-0000-0000-0000-000000000010',
        'd9000000-0000-0000-0000-000000000020',
        'active', now(), now() + interval '12 months');

insert into public.properties (id, organization_id, name, status)
values ('d9000000-0000-0000-0000-000000000030', 'd9000000-0000-0000-0000-000000000010',
        'Test List PIN Property', 'active');

insert into public.units (id, property_id, label, status) values
  ('d9000000-0000-0000-0000-000000000040', 'd9000000-0000-0000-0000-000000000030', 'Unit 1', 'active'),
  ('d9000000-0000-0000-0000-000000000041', 'd9000000-0000-0000-0000-000000000030', 'Unit 2', 'active');

-- Gate fixture — required NOT NULL on access_events.gate_id
insert into public.gates (id, organization_id, name, status)
values ('d9000000-0000-0000-0000-000000000070',
        'd9000000-0000-0000-0000-000000000010',
        'Test Gate', 'active');

-- Resident persons
insert into public.people (id, organization_id, account_id, full_name, status) values
  ('d9000000-0000-0000-0000-000000000050',
   'd9000000-0000-0000-0000-000000000010',
   (select id from public.accounts where auth_user_id = 'd9000000-0000-0000-0000-000000000002'),
   'Resident A', 'active'),
  ('d9000000-0000-0000-0000-000000000051',
   'd9000000-0000-0000-0000-000000000010',
   (select id from public.accounts where auth_user_id = 'd9000000-0000-0000-0000-000000000003'),
   'Resident B', 'active');

-- Guard person (guards have no account per §Locked Decisions)
insert into public.people (id, organization_id, full_name, status)
values ('d9000000-0000-0000-0000-000000000052',
        'd9000000-0000-0000-0000-000000000010',
        'Guard Test', 'active');

-- Guard profile — required NOT NULL on access_events.guard_profile_id
insert into public.guard_profiles (id, organization_id, person_id, guard_code, status)
values ('d9000000-0000-0000-0000-000000000080',
        'd9000000-0000-0000-0000-000000000010',
        'd9000000-0000-0000-0000-000000000052',
        'GU-TEST01', 'active');

-- Visitor persons (account_id NULL)
insert into public.people (id, organization_id, full_name, status) values
  ('d9000000-0000-0000-0000-000000000060', 'd9000000-0000-0000-0000-000000000010', 'Plumber', 'active'),
  ('d9000000-0000-0000-0000-000000000061', 'd9000000-0000-0000-0000-000000000010', 'Courier', 'active');

-- Active occupancies: A on Unit 1, B on Unit 2
insert into public.occupancies (unit_id, account_id, status, started_at)
select 'd9000000-0000-0000-0000-000000000040',
       (select id from public.accounts where auth_user_id = 'd9000000-0000-0000-0000-000000000002'),
       'active', now();

insert into public.occupancies (unit_id, account_id, status, started_at)
select 'd9000000-0000-0000-0000-000000000041',
       (select id from public.accounts where auth_user_id = 'd9000000-0000-0000-0000-000000000003'),
       'active', now();

-- Authorizations
-- A1: active, valid_until future, on Unit 1, created_by resident A
insert into public.authorizations (
  id, organization_id, person_id, scope_unit_id, appointment_id,
  access_type, purpose, note, host_person_id,
  authorization_type, valid_from, valid_until, status, created_by
) values (
  'd9000000-0000-0000-0000-0000000000a1',
  'd9000000-0000-0000-0000-000000000010',
  'd9000000-0000-0000-0000-000000000060',
  'd9000000-0000-0000-0000-000000000040',
  null, 'visitor', 'plumbing', null, 'd9000000-0000-0000-0000-000000000050',
  'one_time', now() - interval '1 hour', now() + interval '2 hours', 'active',
  (select id from public.accounts where auth_user_id = 'd9000000-0000-0000-0000-000000000002')
);

-- A2: status still 'active' but valid_until already in the past (branch C)
insert into public.authorizations (
  id, organization_id, person_id, scope_unit_id, appointment_id,
  access_type, purpose, note, host_person_id,
  authorization_type, valid_from, valid_until, status, created_by
) values (
  'd9000000-0000-0000-0000-0000000000a2',
  'd9000000-0000-0000-0000-000000000010',
  'd9000000-0000-0000-0000-000000000061',
  'd9000000-0000-0000-0000-000000000040',
  null, 'visitor', 'delivery', null, 'd9000000-0000-0000-0000-000000000050',
  'one_time', now() - interval '3 hours', now() - interval '1 hour', 'active',
  (select id from public.accounts where auth_user_id = 'd9000000-0000-0000-0000-000000000002')
);

-- B_other: active, on Unit 1, but created_by resident B — must be hidden from A
insert into public.authorizations (
  id, organization_id, person_id, scope_unit_id, appointment_id,
  access_type, purpose, note, host_person_id,
  authorization_type, valid_from, valid_until, status, created_by
) values (
  'd9000000-0000-0000-0000-0000000000b1',
  'd9000000-0000-0000-0000-000000000010',
  'd9000000-0000-0000-0000-000000000060',
  'd9000000-0000-0000-0000-000000000040',
  null, 'visitor', 'other', null, 'd9000000-0000-0000-0000-000000000051',
  'one_time', now() - interval '1 hour', now() + interval '2 hours', 'active',
  (select id from public.accounts where auth_user_id = 'd9000000-0000-0000-0000-000000000003')
);

-- A_other_unit: active, created_by A, but on Unit 2 — hidden when querying Unit 1
insert into public.authorizations (
  id, organization_id, person_id, scope_unit_id, appointment_id,
  access_type, purpose, note, host_person_id,
  authorization_type, valid_from, valid_until, status, created_by
) values (
  'd9000000-0000-0000-0000-0000000000a3',
  'd9000000-0000-0000-0000-000000000010',
  'd9000000-0000-0000-0000-000000000060',
  'd9000000-0000-0000-0000-000000000041',
  null, 'visitor', 'other unit', null, 'd9000000-0000-0000-0000-000000000050',
  'one_time', now() - interval '1 hour', now() + interval '2 hours', 'active',
  (select id from public.accounts where auth_user_id = 'd9000000-0000-0000-0000-000000000002')
);

-- One GRANTED entry event on A1 — drives entry_count.
-- gate_id and guard_profile_id are NOT NULL on access_events.
insert into public.access_events (
  id, organization_id, direction, result_code, reason,
  authorization_id, person_id,
  gate_id, guard_profile_id,
  metadata, recorded_at
) values (
  'd9000000-0000-0000-0000-0000000000e1',
  'd9000000-0000-0000-0000-000000000010',
  'entry', 'GRANTED', 'test entry',
  'd9000000-0000-0000-0000-0000000000a1',
  'd9000000-0000-0000-0000-000000000060',
  'd9000000-0000-0000-0000-000000000070',
  'd9000000-0000-0000-0000-000000000080',
  '{}'::jsonb, now()
);

-- ============================================================================
-- Assertion 1: Resident A sees their own active PIN (A1)
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"d9000000-0000-0000-0000-000000000002"}', true);

select is(
  (select count(*)::int from public.list_guest_pins_for_unit(
    'd9000000-0000-0000-0000-000000000040'::uuid) as f
   where f.authorization_id = 'd9000000-0000-0000-0000-0000000000a1'::uuid),
  1,
  'A: resident sees own active PIN on their unit'
);

-- ============================================================================
-- Assertion 2: Branch C — status still active but window closed, still visible
-- ============================================================================

select is(
  (select count(*)::int from public.list_guest_pins_for_unit(
    'd9000000-0000-0000-0000-000000000040'::uuid) as f
   where f.authorization_id = 'd9000000-0000-0000-0000-0000000000a2'::uuid),
  1,
  'B: recently expired (status still active) still visible'
);

-- ============================================================================
-- Assertion 3: created_by filter — Resident B's PIN on same unit hidden
-- ============================================================================

select is(
  (select count(*)::int from public.list_guest_pins_for_unit(
    'd9000000-0000-0000-0000-000000000040'::uuid) as f
   where f.authorization_id = 'd9000000-0000-0000-0000-0000000000b1'::uuid),
  0,
  'C: other resident PIN on same unit hidden by created_by filter'
);

-- ============================================================================
-- Assertion 4: scope_unit_id filter — A's PIN on Unit 2 hidden when querying Unit 1
-- ============================================================================

select is(
  (select count(*)::int from public.list_guest_pins_for_unit(
    'd9000000-0000-0000-0000-000000000040'::uuid) as f
   where f.authorization_id = 'd9000000-0000-0000-0000-0000000000a3'::uuid),
  0,
  'D: PIN on a different unit hidden by scope_unit_id filter'
);

-- ============================================================================
-- Assertion 5: Non-resident admin (no occupancy) → NOT_AUTHORIZED
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"d9000000-0000-0000-0000-000000000001"}', true);

select throws_ok(
  $$select * from public.list_guest_pins_for_unit(
      'd9000000-0000-0000-0000-000000000040'::uuid)$$,
  'P0001',
  'NOT_AUTHORIZED',
  'E: non-resident caller rejected'
);

-- ============================================================================
-- Assertion 6: Unauthenticated caller → NOT_AUTHENTICATED
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009997"}', true);

select throws_ok(
  $$select * from public.list_guest_pins_for_unit(
      'd9000000-0000-0000-0000-000000000040'::uuid)$$,
  'P0001',
  'NOT_AUTHENTICATED',
  'F: unauthenticated caller rejected'
);

-- ============================================================================
-- Assertion 7: Non-existent unit UUID → UNIT_NOT_FOUND
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"d9000000-0000-0000-0000-000000000002"}', true);

select throws_ok(
  $$select * from public.list_guest_pins_for_unit(
      'd9000000-0000-0000-0000-000000000999'::uuid)$$,
  'P0001',
  'UNIT_NOT_FOUND',
  'G: unknown unit rejected'
);

-- ============================================================================
-- Assertion 8: entry_count reflects one GRANTED entry on A1
-- ============================================================================

select is(
  (select f.entry_count from public.list_guest_pins_for_unit(
    'd9000000-0000-0000-0000-000000000040'::uuid) as f
   where f.authorization_id = 'd9000000-0000-0000-0000-0000000000a1'::uuid),
  1,
  'H: entry_count reflects one GRANTED entry event'
);

select * from finish();

rollback;
