-- ============================================================================
-- Test: list_unit_visits
-- ============================================================================
-- Covers the read-only list RPC added in migration 0055: authentication,
-- residency check, scope_unit_id filter, and the three status states
-- (open, completed, unresolved).
--
-- Note on authorization_id: Verified as NOT NULL in schema. The join to
-- authorizations is safe and will not drop rows unexpectedly.
--
-- Fixtures use UUIDs prefixed 'd9'. Wrapped in begin/rollback.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(6);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at) values
  ('d9000000-0000-0000-0000-000000000001', 'test-listvisit-admin@test.com',      now(), now()),
  ('d9000000-0000-0000-0000-000000000002', 'test-listvisit-resident-a@test.com', now(), now());

insert into public.organizations (id, name, display_name, organization_type, status)
values ('d9000000-0000-0000-0000-000000000010', 'test-listvisit-org', 'Test List Visit',
        'residential', 'active');

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'd9000000-0000-0000-0000-000000000010', a.id, 'admin', 'active', now()
from public.accounts a where a.auth_user_id = 'd9000000-0000-0000-0000-000000000001';

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'd9000000-0000-0000-0000-000000000010', a.id, 'primary_resident', 'active', now()
from public.accounts a where a.auth_user_id = 'd9000000-0000-0000-0000-000000000002';

insert into public.properties (id, organization_id, name, status)
values ('d9000000-0000-0000-0000-000000000030', 'd9000000-0000-0000-0000-000000000010',
        'Test List Visit Property', 'active');

insert into public.units (id, property_id, label, status) values
  ('d9000000-0000-0000-0000-000000000040', 'd9000000-0000-0000-0000-000000000030', 'Unit 1', 'active'),
  ('d9000000-0000-0000-0000-000000000041', 'd9000000-0000-0000-0000-000000000030', 'Unit 2', 'active');

-- Gate fixture (required for access_sessions)
insert into public.gates (id, organization_id, name, status)
values ('d9000000-0000-0000-0000-000000000070', 'd9000000-0000-0000-0000-000000000010', 'Test Gate', 'active');

-- Guard person and profile (required for shift_sessions)
insert into public.people (id, organization_id, full_name, status)
values ('d9000000-0000-0000-0000-000000000052', 'd9000000-0000-0000-0000-000000000010', 'Guard Test', 'active');

insert into public.guard_profiles (id, organization_id, person_id, guard_code, status)
values ('d9000000-0000-0000-0000-000000000080', 'd9000000-0000-0000-0000-000000000010', 'd9000000-0000-0000-0000-000000000052', 'GU-TEST01', 'active');

-- Shift session fixture (required for access_sessions)
insert into public.shift_sessions (id, organization_id, guard_profile_id, gate_id, status, started_at)
values ('d9000000-0000-0000-0000-0000000000sh', 'd9000000-0000-0000-0000-000000000010', 'd9000000-0000-0000-0000-000000000080', 'd9000000-0000-0000-0000-000000000070', 'active', now());

-- Resident A person
insert into public.people (id, organization_id, account_id, full_name, status) values
  ('d9000000-0000-0000-0000-000000000050',
   'd9000000-0000-0000-0000-000000000010',
   (select id from public.accounts where auth_user_id = 'd9000000-0000-0000-0000-000000000002'),
   'Resident A', 'active');

-- Visitor person
insert into public.people (id, organization_id, full_name, status) values
  ('d9000000-0000-0000-0000-000000000060', 'd9000000-0000-0000-0000-000000000010', 'Plumber', 'active');

-- Active occupancy: A on Unit 1
insert into public.occupancies (unit_id, account_id, status, started_at)
select 'd9000000-0000-0000-0000-000000000040',
       (select id from public.accounts where auth_user_id = 'd9000000-0000-0000-0000-000000000002'),
       'active', now();

-- Authorization for Visitor to Unit 1
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

-- Authorization for Visitor to Unit 2 (should be hidden from Resident A)
insert into public.authorizations (
  id, organization_id, person_id, scope_unit_id, appointment_id,
  access_type, purpose, note, host_person_id,
  authorization_type, valid_from, valid_until, status, created_by
) values (
  'd9000000-0000-0000-0000-0000000000a2',
  'd9000000-0000-0000-0000-000000000010',
  'd9000000-0000-0000-0000-000000000060',
  'd9000000-0000-0000-0000-000000000041',
  null, 'visitor', 'other', null, 'd9000000-0000-0000-0000-000000000050',
  'one_time', now() - interval '1 hour', now() + interval '2 hours', 'active',
  (select id from public.accounts where auth_user_id = 'd9000000-0000-0000-0000-000000000002')
);

-- Access Sessions for Unit 1
-- Session 1: OPEN
insert into public.access_sessions (
  id, organization_id, authorization_id, person_id, gate_entered_id, entered_shift_session_id, opened_by_event_id, status, entered_at
) values (
  'd9000000-0000-0000-0000-0000000000s1',
  'd9000000-0000-0000-0000-000000000010',
  'd9000000-0000-0000-0000-0000000000a1',
  'd9000000-0000-0000-0000-000000000060',
  'd9000000-0000-0000-0000-000000000070',
  'd9000000-0000-0000-0000-0000000000sh',
  'd9000000-0000-0000-0000-0000000000e1',
  'open',
  now() - interval '10 minutes'
);

-- Session 2: COMPLETED
insert into public.access_sessions (
  id, organization_id, authorization_id, person_id, gate_entered_id, gate_exited_id, entered_shift_session_id, exited_shift_session_id, opened_by_event_id, closed_by_event_id, status, entered_at, exited_at
) values (
  'd9000000-0000-0000-0000-0000000000s2',
  'd9000000-0000-0000-0000-000000000010',
  'd9000000-0000-0000-0000-0000000000a1',
  'd9000000-0000-0000-0000-000000000060',
  'd9000000-0000-0000-0000-000000000070',
  'd9000000-0000-0000-0000-000000000070',
  'd9000000-0000-0000-0000-0000000000sh',
  'd9000000-0000-0000-0000-0000000000sh',
  'd9000000-0000-0000-0000-0000000000e2',
  'd9000000-0000-0000-0000-0000000000e3',
  'completed',
  now() - interval '2 hours',
  now() - interval '1 hour'
);

-- Session 3: UNRESOLVED
insert into public.access_sessions (
  id, organization_id, authorization_id, person_id, gate_entered_id, entered_shift_session_id, opened_by_event_id, status, entered_at
) values (
  'd9000000-0000-0000-0000-0000000000s3',
  'd9000000-0000-0000-0000-000000000010',
  'd9000000-0000-0000-0000-0000000000a1',
  'd9000000-0000-0000-0000-000000000060',
  'd9000000-0000-0000-0000-000000000070',
  'd9000000-0000-0000-0000-0000000000sh',
  'd9000000-0000-0000-0000-0000000000e4',
  'unresolved',
  now() - interval '3 days'
);

-- Access Session for Unit 2 (should be hidden from Resident A)
insert into public.access_sessions (
  id, organization_id, authorization_id, person_id, gate_entered_id, entered_shift_session_id, opened_by_event_id, status, entered_at
) values (
  'd9000000-0000-0000-0000-0000000000s4',
  'd9000000-0000-0000-0000-000000000010',
  'd9000000-0000-0000-0000-0000000000a2',
  'd9000000-0000-0000-0000-000000000060',
  'd9000000-0000-0000-0000-000000000070',
  'd9000000-0000-0000-0000-0000000000sh',
  'd9000000-0000-0000-0000-0000000000e5',
  'open',
  now() - interval '5 minutes'
);

-- ============================================================================
-- Assertion 1: Resident A sees exactly 3 visits for Unit 1 (open, completed, unresolved)
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"d9000000-0000-0000-0000-000000000002"}', true);

select is(
  (select count(*)::int from public.list_unit_visits('d9000000-0000-0000-0000-000000000040'::uuid)),
  3,
  'A: resident sees exactly 3 visits (open, completed, unresolved) for their unit'
);

-- ============================================================================
-- Assertion 2: Verify the three status states are correctly returned
-- ============================================================================

select is(
  (select array_agg(status order by status) from public.list_unit_visits('d9000000-0000-0000-0000-000000000040'::uuid)),
  ARRAY['completed', 'open', 'unresolved']::text[],
  'B: the three status states are correctly returned'
);

-- ============================================================================
-- Assertion 3: scope_unit_id filter — Resident A sees 0 visits for Unit 2
-- ============================================================================

select is(
  (select count(*)::int from public.list_unit_visits('d9000000-0000-0000-0000-000000000041'::uuid)),
  0,
  'C: resident sees 0 visits for a unit they do not occupy'
);

-- ============================================================================
-- Assertion 4: Non-resident admin (no occupancy) → NOT_AUTHORIZED
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"d9000000-0000-0000-0000-000000000001"}', true);

select throws_ok(
  $$select * from public.list_unit_visits('d9000000-0000-0000-0000-000000000040'::uuid)$$,
  'P0001',
  'NOT_AUTHORIZED',
  'D: non-resident caller rejected'
);

-- ============================================================================
-- Assertion 5: Unauthenticated caller → NOT_AUTHENTICATED
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009997"}', true);

select throws_ok(
  $$select * from public.list_unit_visits('d9000000-0000-0000-0000-000000000040'::uuid)$$,
  'P0001',
  'NOT_AUTHENTICATED',
  'E: unauthenticated caller rejected'
);

-- ============================================================================
-- Assertion 6: Non-existent unit UUID → UNIT_NOT_FOUND
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"d9000000-0000-0000-0000-000000000002"}', true);

select throws_ok(
  $$select * from public.list_unit_visits('d9000000-0000-0000-0000-000000000999'::uuid)$$,
  'P0001',
  'UNIT_NOT_FOUND',
  'F: unknown unit rejected'
);

select * from finish();

rollback;
