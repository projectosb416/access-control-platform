-- ============================================================================
-- Test: household-member read permissions (migration 0060, #19)
-- ============================================================================
-- Proves the widened predicate on three read RPCs accepts household
-- members and continues to reject non-members. Six assertions:
--
--   A. Household member sees the roster via list_household_members
--   B. Household member sees unit visits via list_unit_visits
--   C. Household member sees their own PIN via list_guest_pins_for_unit
--   D. Household member does NOT see the primary resident's PIN
--      (created_by filter still applies)
--   E. Household member sees visits by ANY visitor to the unit
--      (list_unit_visits is unit-scoped, not caller-scoped)
--   F. Non-member, non-resident caller still rejected as NOT_AUTHORIZED
--
-- Fixtures use UUID prefix 'cc'. Wrapped in begin/rollback.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(6);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at) values
  ('cc000000-0000-0000-0000-000000000001', 'test-hhread-primary@test.com',  now(), now()),
  ('cc000000-0000-0000-0000-000000000002', 'test-hhread-member@test.com',   now(), now()),
  ('cc000000-0000-0000-0000-000000000003', 'test-hhread-stranger@test.com', now(), now());

insert into public.organizations (id, name, display_name, organization_type, status)
values ('cc000000-0000-0000-0000-000000000010', 'test-hhread-org', 'Test HH Read',
        'residential', 'active');

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'cc000000-0000-0000-0000-000000000010', a.id, 'primary_resident', 'active', now()
from public.accounts a where a.auth_user_id = 'cc000000-0000-0000-0000-000000000001';

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'cc000000-0000-0000-0000-000000000010', a.id, 'primary_resident', 'active', now()
from public.accounts a where a.auth_user_id = 'cc000000-0000-0000-0000-000000000002';

-- Stranger: authenticated but no relationship to this unit or org.
insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'cc000000-0000-0000-0000-000000000010', a.id, 'primary_resident', 'active', now()
from public.accounts a where a.auth_user_id = 'cc000000-0000-0000-0000-000000000003';

insert into public.plans (id, code, name, currency, price_minor_units, billing_cycle_months, status)
values ('cc000000-0000-0000-0000-000000000020', 'test-hhread-plan', 'Test HH Read Plan',
        'NGN', 100000, 12, 'active');

insert into public.subscriptions (organization_id, plan_id, status,
                                   current_period_start, current_period_end)
values ('cc000000-0000-0000-0000-000000000010', 'cc000000-0000-0000-0000-000000000020',
        'active', now(), now() + interval '12 months');

insert into public.properties (id, organization_id, name, status)
values ('cc000000-0000-0000-0000-000000000030', 'cc000000-0000-0000-0000-000000000010',
        'Test HH Read Property', 'active');

insert into public.units (id, property_id, label, status) values
  ('cc000000-0000-0000-0000-000000000040', 'cc000000-0000-0000-0000-000000000030', 'Unit 1', 'active'),
  ('cc000000-0000-0000-0000-000000000041', 'cc000000-0000-0000-0000-000000000030', 'Unit 2', 'active');

-- Primary resident person + occupancy on Unit 1
insert into public.people (id, organization_id, account_id, full_name, status)
select 'cc000000-0000-0000-0000-000000000050', 'cc000000-0000-0000-0000-000000000010',
       a.id, 'Primary Person', 'active'
from public.accounts a where a.auth_user_id = 'cc000000-0000-0000-0000-000000000001';

insert into public.occupancies (unit_id, account_id, status, started_at)
select 'cc000000-0000-0000-0000-000000000040',
       (select id from public.accounts where auth_user_id = 'cc000000-0000-0000-0000-000000000001'),
       'active', now();

-- Household member person + active household_members row on Unit 1
insert into public.people (id, organization_id, account_id, full_name, status)
select 'cc000000-0000-0000-0000-000000000051', 'cc000000-0000-0000-0000-000000000010',
       a.id, 'Household Person', 'active'
from public.accounts a where a.auth_user_id = 'cc000000-0000-0000-0000-000000000002';

insert into public.household_members (
  id, unit_id, account_id, person_id, invited_by, status, joined_at
)
select 'cc000000-0000-0000-0000-000000000080',
       'cc000000-0000-0000-0000-000000000040',
       (select id from public.accounts where auth_user_id = 'cc000000-0000-0000-0000-000000000002'),
       'cc000000-0000-0000-0000-000000000051',
       (select id from public.accounts where auth_user_id = 'cc000000-0000-0000-0000-000000000001'),
       'active', now();

-- Stranger person + occupancy on Unit 2 (a DIFFERENT unit in the same org)
insert into public.people (id, organization_id, account_id, full_name, status)
select 'cc000000-0000-0000-0000-000000000052', 'cc000000-0000-0000-0000-000000000010',
       a.id, 'Stranger Person', 'active'
from public.accounts a where a.auth_user_id = 'cc000000-0000-0000-0000-000000000003';

insert into public.occupancies (unit_id, account_id, status, started_at)
select 'cc000000-0000-0000-0000-000000000041',
       (select id from public.accounts where auth_user_id = 'cc000000-0000-0000-0000-000000000003'),
       'active', now();

-- Visitor person (shared)
insert into public.people (id, organization_id, full_name, status)
values ('cc000000-0000-0000-0000-000000000060', 'cc000000-0000-0000-0000-000000000010',
        'Test Visitor', 'active');

-- Guard person + profile + gate + shift + shift_session (required for sessions)
insert into public.people (id, organization_id, full_name, status)
values ('cc000000-0000-0000-0000-000000000053', 'cc000000-0000-0000-0000-000000000010',
        'Guard Test', 'active');

insert into public.guard_profiles (id, organization_id, person_id, guard_code, status)
values ('cc000000-0000-0000-0000-000000000070', 'cc000000-0000-0000-0000-000000000010',
        'cc000000-0000-0000-0000-000000000053', 'GU-HHREAD1', 'active');

insert into public.gates (id, organization_id, name, max_active_guards, status)
values ('cc000000-0000-0000-0000-000000000075', 'cc000000-0000-0000-0000-000000000010',
        'Gate 1', 2, 'active');

insert into public.shifts (id, organization_id, gate_id, shift_code,
                            scheduled_start, scheduled_end, status)
values ('cc000000-0000-0000-0000-000000000085', 'cc000000-0000-0000-0000-000000000010',
        'cc000000-0000-0000-0000-000000000075', 'SH-HHREAD1',
        now() - interval '10 min', now() + interval '4 hours', 'active');

insert into public.shift_sessions (id, shift_id, guard_profile_id, status, started_at)
values ('cc000000-0000-0000-0000-000000000090', 'cc000000-0000-0000-0000-000000000085',
        'cc000000-0000-0000-0000-000000000070', 'active', now());

-- Authorization + credential created by the PRIMARY RESIDENT on Unit 1.
-- Used to prove the household member CANNOT see this PIN (created_by filter).
insert into public.authorizations (id, organization_id, person_id, scope_unit_id,
                                    access_type, purpose, note,
                                    authorization_type, valid_from, valid_until, status, created_by)
values ('cc000000-0000-0000-0000-0000000000a1',
        'cc000000-0000-0000-0000-000000000010',
        'cc000000-0000-0000-0000-000000000060',
        'cc000000-0000-0000-0000-000000000040',
        'visitor', 'primary resident visit', null,
        'one_time', now() - interval '1 hour', now() + interval '2 hours', 'active',
        (select id from public.accounts where auth_user_id = 'cc000000-0000-0000-0000-000000000001'));

-- Authorization + credential created by the HOUSEHOLD MEMBER on Unit 1.
-- Used to prove the household member CAN see their own PIN.
insert into public.authorizations (id, organization_id, person_id, scope_unit_id,
                                    access_type, purpose, note,
                                    authorization_type, valid_from, valid_until, status, created_by)
values ('cc000000-0000-0000-0000-0000000000a2',
        'cc000000-0000-0000-0000-000000000010',
        'cc000000-0000-0000-0000-000000000060',
        'cc000000-0000-0000-0000-000000000040',
        'visitor', 'household member visit', null,
        'one_time', now() - interval '1 hour', now() + interval '2 hours', 'active',
        (select id from public.accounts where auth_user_id = 'cc000000-0000-0000-0000-000000000002'));

-- Session on Unit 1 created by the primary resident's authorization
-- (proves household member sees visits to the unit regardless of creator)
insert into public.access_sessions (id, organization_id, authorization_id, person_id,
                                     gate_entered_id, entered_shift_session_id,
                                     opened_by_event_id, status, entered_at)
values ('cc000000-0000-0000-0000-0000000000c1',
        'cc000000-0000-0000-0000-000000000010',
        'cc000000-0000-0000-0000-0000000000a1',
        'cc000000-0000-0000-0000-000000000060',
        'cc000000-0000-0000-0000-000000000075',
        'cc000000-0000-0000-0000-000000000090',
        'cc000000-0000-0000-0000-0000000000e1',
        'open', now() - interval '10 minutes');

-- ============================================================================
-- Assertions
-- ============================================================================

-- Authenticate as the household member
select set_config('request.jwt.claims',
  '{"sub":"cc000000-0000-0000-0000-000000000002"}', true);

-- A. Household member sees the roster
select is(
  (select count(*)::int from public.list_household_members(
    'cc000000-0000-0000-0000-000000000040'::uuid)),
  1,
  'A: household member sees the roster'
);

-- B. Household member sees visits to the unit
select is(
  (select count(*)::int from public.list_unit_visits(
    'cc000000-0000-0000-0000-000000000040'::uuid)),
  1,
  'B: household member sees unit visits'
);

-- C. Household member sees their own PIN
select is(
  (select count(*)::int from public.list_guest_pins_for_unit(
    'cc000000-0000-0000-0000-000000000040'::uuid) as f
   where f.authorization_id = 'cc000000-0000-0000-0000-0000000000a2'::uuid),
  1,
  'C: household member sees their own PIN'
);

-- D. Household member does NOT see the primary resident's PIN
select is(
  (select count(*)::int from public.list_guest_pins_for_unit(
    'cc000000-0000-0000-0000-000000000040'::uuid) as f
   where f.authorization_id = 'cc000000-0000-0000-0000-0000000000a1'::uuid),
  0,
  'D: household member cannot see primary resident PIN'
);

-- E. The visit shown is not filtered by caller (unit-scoped visibility).
--    The session was opened by the primary resident's authorization,
--    and the household member sees it.
select is(
  (select count(*)::int from public.list_unit_visits(
    'cc000000-0000-0000-0000-000000000040'::uuid) as f
   where f.session_id = 'cc000000-0000-0000-0000-0000000000c1'::uuid),
  1,
  'E: list_unit_visits is unit-scoped, not caller-scoped'
);

-- F. Stranger (authenticated but on a different unit in the org)
--    is rejected by the roster RPC
select set_config('request.jwt.claims',
  '{"sub":"cc000000-0000-0000-0000-000000000003"}', true);

select throws_ok(
  $$select * from public.list_household_members(
      'cc000000-0000-0000-0000-000000000040'::uuid)$$,
  'P0001',
  'NOT_AUTHORIZED',
  'F: non-member caller still rejected'
);

select * from finish();

rollback;
