-- ============================================================================
-- Test: list_unit_visits
-- ============================================================================
-- Covers migration 0056: authentication, unit existence, residency check,
-- unit scoping, all three statuses (open/completed/unresolved), ordering,
-- and resolved_at behavior.
--
-- Not tested here: the LIMIT 20 boundary. Would require 21+ session
-- fixtures; the boundary is enforced by a single literal in the RPC.
--
-- Fixtures use UUIDs prefixed 'f1'. Wrapped in begin/rollback.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(8);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at) values
  ('f1000000-0000-0000-0000-000000000001', 'test-listvisit-a@test.com', now(), now()),
  ('f1000000-0000-0000-0000-000000000002', 'test-listvisit-b@test.com', now(), now());

insert into public.organizations (id, name, display_name, organization_type, status)
values ('f1000000-0000-0000-0000-000000000010', 'test-listvisit-org', 'Test List Visit',
        'residential', 'active');

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'f1000000-0000-0000-0000-000000000010', a.id, 'primary_resident', 'active', now()
from public.accounts a where a.auth_user_id = 'f1000000-0000-0000-0000-000000000001';

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'f1000000-0000-0000-0000-000000000010', a.id, 'admin', 'active', now()
from public.accounts a where a.auth_user_id = 'f1000000-0000-0000-0000-000000000002';

insert into public.plans (id, code, name, currency, price_minor_units, billing_cycle_months, status)
values ('f1000000-0000-0000-0000-000000000020', 'test-listvisit-plan', 'Test List Visit Plan',
        'NGN', 100000, 12, 'active');

insert into public.subscriptions (organization_id, plan_id, status,
                                   current_period_start, current_period_end)
values ('f1000000-0000-0000-0000-000000000010', 'f1000000-0000-0000-0000-000000000020',
        'active', now(), now() + interval '12 months');

insert into public.properties (id, organization_id, name, status)
values ('f1000000-0000-0000-0000-000000000030', 'f1000000-0000-0000-0000-000000000010',
        'Test List Visit Property', 'active');

insert into public.units (id, property_id, label, status) values
  ('f1000000-0000-0000-0000-000000000040', 'f1000000-0000-0000-0000-000000000030', 'Unit 1', 'active'),
  ('f1000000-0000-0000-0000-000000000041', 'f1000000-0000-0000-0000-000000000030', 'Unit 2', 'active');

insert into public.people (id, organization_id, account_id, full_name, status)
select 'f1000000-0000-0000-0000-000000000050', 'f1000000-0000-0000-0000-000000000010',
       a.id, 'Resident A', 'active'
from public.accounts a where a.auth_user_id = 'f1000000-0000-0000-0000-000000000001';

insert into public.people (id, organization_id, full_name, status) values
  ('f1000000-0000-0000-0000-000000000052', 'f1000000-0000-0000-0000-000000000010',
   'Guard Test', 'active'),
  ('f1000000-0000-0000-0000-000000000060', 'f1000000-0000-0000-0000-000000000010',
   'Visitor One', 'active'),
  ('f1000000-0000-0000-0000-000000000061', 'f1000000-0000-0000-0000-000000000010',
   'Visitor Two', 'active');

insert into public.guard_profiles (id, organization_id, person_id, guard_code, status)
values ('f1000000-0000-0000-0000-000000000080', 'f1000000-0000-0000-0000-000000000010',
        'f1000000-0000-0000-0000-000000000052', 'GU-LISTV1', 'active');

insert into public.gates (id, organization_id, name, max_active_guards, status)
values ('f1000000-0000-0000-0000-000000000070', 'f1000000-0000-0000-0000-000000000010',
        'Gate 1', 2, 'active');

insert into public.occupancies (unit_id, account_id, status, started_at)
select 'f1000000-0000-0000-0000-000000000040',
       (select id from public.accounts where auth_user_id = 'f1000000-0000-0000-0000-000000000001'),
       'active', now();

insert into public.shifts (id, organization_id, gate_id, shift_code,
                            scheduled_start, scheduled_end, status)
values ('f1000000-0000-0000-0000-000000000085', 'f1000000-0000-0000-0000-000000000010',
        'f1000000-0000-0000-0000-000000000070', 'SH-LISTV1',
        now() - interval '10 min', now() + interval '4 hours', 'active');

insert into public.shift_sessions (id, shift_id, guard_profile_id, status, started_at)
values ('f1000000-0000-0000-0000-000000000090', 'f1000000-0000-0000-0000-000000000085',
        'f1000000-0000-0000-0000-000000000080', 'active', now());

-- Four authorizations on Unit 1 (one per session state) + one on Unit 2
insert into public.authorizations (id, organization_id, person_id, scope_unit_id,
                                    access_type, purpose, authorization_type,
                                    valid_from, valid_until, status)
values
  ('f1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-000000000010',
   'f1000000-0000-0000-0000-000000000060', 'f1000000-0000-0000-0000-000000000040',
   'visitor', 'open visit', 'one_time',
   now() - interval '10 hours', now() + interval '10 hours', 'in_progress'),
  ('f1000000-0000-0000-0000-0000000000a2', 'f1000000-0000-0000-0000-000000000010',
   'f1000000-0000-0000-0000-000000000060', 'f1000000-0000-0000-0000-000000000040',
   'visitor', 'completed visit', 'one_time',
   now() - interval '10 hours', now() + interval '10 hours', 'completed'),
  ('f1000000-0000-0000-0000-0000000000a3', 'f1000000-0000-0000-0000-000000000010',
   'f1000000-0000-0000-0000-000000000060', 'f1000000-0000-0000-0000-000000000040',
   'visitor', 'unresolved outstanding', 'one_time',
   now() - interval '10 hours', now() + interval '10 hours', 'active'),
  ('f1000000-0000-0000-0000-0000000000a4', 'f1000000-0000-0000-0000-000000000010',
   'f1000000-0000-0000-0000-000000000060', 'f1000000-0000-0000-0000-000000000040',
   'visitor', 'unresolved resolved', 'one_time',
   now() - interval '10 hours', now() + interval '10 hours', 'active'),
  ('f1000000-0000-0000-0000-0000000000a5', 'f1000000-0000-0000-0000-000000000010',
   'f1000000-0000-0000-0000-000000000061', 'f1000000-0000-0000-0000-000000000041',
   'visitor', 'unit 2 visit', 'one_time',
   now() - interval '10 hours', now() + interval '10 hours', 'in_progress');

-- Four sessions on Unit 1 (person 60) + one on Unit 2 (person 61).
-- Only C1 and C5 are open; each uses a different person, so both partial
-- unique indexes (one_open_per_authorization, one_open_per_person) are
-- satisfied.
insert into public.access_sessions (id, organization_id, authorization_id, person_id,
                                     gate_entered_id, entered_shift_session_id,
                                     opened_by_event_id, status, entered_at)
values
  ('f1000000-0000-0000-0000-0000000000c1', 'f1000000-0000-0000-0000-000000000010',
   'f1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-000000000060',
   'f1000000-0000-0000-0000-000000000070', 'f1000000-0000-0000-0000-000000000090',
   'f1000000-0000-0000-0000-0000000000e1', 'open',
   now() - interval '5 minutes');

insert into public.access_sessions (id, organization_id, authorization_id, person_id,
                                     gate_entered_id, gate_exited_id,
                                     entered_shift_session_id, exited_shift_session_id,
                                     opened_by_event_id, closed_by_event_id,
                                     status, entered_at, exited_at)
values
  ('f1000000-0000-0000-0000-0000000000c2', 'f1000000-0000-0000-0000-000000000010',
   'f1000000-0000-0000-0000-0000000000a2', 'f1000000-0000-0000-0000-000000000060',
   'f1000000-0000-0000-0000-000000000070', 'f1000000-0000-0000-0000-000000000070',
   'f1000000-0000-0000-0000-000000000090', 'f1000000-0000-0000-0000-000000000090',
   'f1000000-0000-0000-0000-0000000000e2', 'f1000000-0000-0000-0000-0000000000e3',
   'completed', now() - interval '60 minutes', now() - interval '30 minutes');

insert into public.access_sessions (id, organization_id, authorization_id, person_id,
                                     gate_entered_id, entered_shift_session_id,
                                     opened_by_event_id, status, entered_at)
values
  ('f1000000-0000-0000-0000-0000000000c3', 'f1000000-0000-0000-0000-000000000010',
   'f1000000-0000-0000-0000-0000000000a3', 'f1000000-0000-0000-0000-000000000060',
   'f1000000-0000-0000-0000-000000000070', 'f1000000-0000-0000-0000-000000000090',
   'f1000000-0000-0000-0000-0000000000e4', 'unresolved',
   now() - interval '120 minutes');

insert into public.access_sessions (id, organization_id, authorization_id, person_id,
                                     gate_entered_id, entered_shift_session_id,
                                     opened_by_event_id, status, entered_at,
                                     resolved_at, resolved_by, resolution_reason)
values
  ('f1000000-0000-0000-0000-0000000000c4', 'f1000000-0000-0000-0000-000000000010',
   'f1000000-0000-0000-0000-0000000000a4', 'f1000000-0000-0000-0000-000000000060',
   'f1000000-0000-0000-0000-000000000070', 'f1000000-0000-0000-0000-000000000090',
   'f1000000-0000-0000-0000-0000000000e5', 'unresolved',
   now() - interval '180 minutes',
   now() - interval '10 minutes',
   (select id from public.accounts where auth_user_id = 'f1000000-0000-0000-0000-000000000002'),
   'manual resolution');

insert into public.access_sessions (id, organization_id, authorization_id, person_id,
                                     gate_entered_id, entered_shift_session_id,
                                     opened_by_event_id, status, entered_at)
values
  ('f1000000-0000-0000-0000-0000000000c5', 'f1000000-0000-0000-0000-000000000010',
   'f1000000-0000-0000-0000-0000000000a5', 'f1000000-0000-0000-0000-000000000061',
   'f1000000-0000-0000-0000-000000000070', 'f1000000-0000-0000-0000-000000000090',
   'f1000000-0000-0000-0000-0000000000e6', 'open',
   now() - interval '3 minutes');

-- ============================================================================
-- Assertions
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-0000-0000-000000000001"}', true);

select is(
  (select count(*)::int from public.list_unit_visits(
    'f1000000-0000-0000-0000-000000000040'::uuid)),
  4,
  'A: resident sees exactly the four sessions on their unit'
);

select is(
  (select count(*)::int from public.list_unit_visits(
    'f1000000-0000-0000-0000-000000000040'::uuid) as f
   where f.session_id = 'f1000000-0000-0000-0000-0000000000c5'::uuid),
  0,
  'B: Unit 2 session not visible when querying Unit 1'
);

select is(
  (select array_agg(f.status order by f.entered_at desc)::text
     from public.list_unit_visits('f1000000-0000-0000-0000-000000000040'::uuid) as f),
  '{open,completed,unresolved,unresolved}',
  'C: statuses returned unfiltered, newest first'
);

select is(
  (select f.resolved_at
     from public.list_unit_visits('f1000000-0000-0000-0000-000000000040'::uuid) as f
    where f.session_id = 'f1000000-0000-0000-0000-0000000000c3'::uuid),
  null::timestamptz,
  'D: outstanding unresolved session has resolved_at NULL'
);

select ok(
  (select f.resolved_at is not null
     from public.list_unit_visits('f1000000-0000-0000-0000-000000000040'::uuid) as f
    where f.session_id = 'f1000000-0000-0000-0000-0000000000c4'::uuid),
  'E: admin-resolved unresolved session has resolved_at set'
);

select set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-0000-0000-000000000002"}', true);

select throws_ok(
  $$select * from public.list_unit_visits(
      'f1000000-0000-0000-0000-000000000040'::uuid)$$,
  'P0001',
  'NOT_AUTHORIZED',
  'F: non-resident caller rejected'
);

select throws_ok(
  $$select * from public.list_unit_visits(
      'f1000000-0000-0000-0000-000000000999'::uuid)$$,
  'P0001',
  'UNIT_NOT_FOUND',
  'G: unknown unit rejected'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009999"}', true);

select throws_ok(
  $$select * from public.list_unit_visits(
      'f1000000-0000-0000-0000-000000000040'::uuid)$$,
  'P0001',
  'NOT_AUTHENTICATED',
  'H: unauthenticated caller rejected'
);

select * from finish();

rollback;
