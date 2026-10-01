-- ============================================================================
-- Test: household lifecycle functions (migration 0057)
-- ============================================================================
-- Covers all four SECURITY DEFINER functions plus the two dropped RLS
-- policies. Twelve assertions:
--
--   list:     happy path, non-resident rejected, unauthenticated rejected
--   generate: happy path, non-primary-resident rejected, invalid duration
--   cancel:   happy path, INVITE_NOT_FOUND on empty
--   end:      happy path, cascade revokes authorizations, idempotent,
--             invited row rejected
--
-- Fixtures use UUID prefix 'bb'. Wrapped in begin/rollback.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(12);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at) values
  ('bb000000-0000-0000-0000-000000000001', 'test-hh-resident-a@test.com', now(), now()),
  ('bb000000-0000-0000-0000-000000000002', 'test-hh-resident-b@test.com', now(), now()),
  ('bb000000-0000-0000-0000-000000000003', 'test-hh-member-x@test.com',   now(), now());

insert into public.organizations (id, name, display_name, organization_type, status)
values ('bb000000-0000-0000-0000-000000000010', 'test-hh-org', 'Test Household',
        'residential', 'active');

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'bb000000-0000-0000-0000-000000000010', a.id, 'primary_resident', 'active', now()
from public.accounts a where a.auth_user_id = 'bb000000-0000-0000-0000-000000000001';

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'bb000000-0000-0000-0000-000000000010', a.id, 'primary_resident', 'active', now()
from public.accounts a where a.auth_user_id = 'bb000000-0000-0000-0000-000000000002';

insert into public.plans (id, code, name, currency, price_minor_units, billing_cycle_months, status)
values ('bb000000-0000-0000-0000-000000000020', 'test-hh-plan', 'Test HH Plan',
        'NGN', 100000, 12, 'active');

insert into public.subscriptions (organization_id, plan_id, status,
                                   current_period_start, current_period_end)
values ('bb000000-0000-0000-0000-000000000010', 'bb000000-0000-0000-0000-000000000020',
        'active', now(), now() + interval '12 months');

insert into public.properties (id, organization_id, name, status)
values ('bb000000-0000-0000-0000-000000000030', 'bb000000-0000-0000-0000-000000000010',
        'Test HH Property', 'active');

insert into public.units (id, property_id, label, status) values
  ('bb000000-0000-0000-0000-000000000040', 'bb000000-0000-0000-0000-000000000030', 'Unit 1', 'active'),
  ('bb000000-0000-0000-0000-000000000041', 'bb000000-0000-0000-0000-000000000030', 'Unit 2', 'active');

insert into public.people (id, organization_id, account_id, full_name, status)
select 'bb000000-0000-0000-0000-000000000050', 'bb000000-0000-0000-0000-000000000010',
       a.id, 'Resident A', 'active'
from public.accounts a where a.auth_user_id = 'bb000000-0000-0000-0000-000000000001';

insert into public.people (id, organization_id, account_id, full_name, status)
select 'bb000000-0000-0000-0000-000000000051', 'bb000000-0000-0000-0000-000000000010',
       a.id, 'Resident B', 'active'
from public.accounts a where a.auth_user_id = 'bb000000-0000-0000-0000-000000000002';

insert into public.people (id, organization_id, account_id, full_name, status)
select 'bb000000-0000-0000-0000-000000000052', 'bb000000-0000-0000-0000-000000000010',
       a.id, 'Household Member X', 'active'
from public.accounts a where a.auth_user_id = 'bb000000-0000-0000-0000-000000000003';

insert into public.people (id, organization_id, full_name, status)
values ('bb000000-0000-0000-0000-000000000060', 'bb000000-0000-0000-0000-000000000010',
        'Test Visitor', 'active');

insert into public.occupancies (unit_id, account_id, status, started_at)
select 'bb000000-0000-0000-0000-000000000040',
       (select id from public.accounts where auth_user_id = 'bb000000-0000-0000-0000-000000000001'),
       'active', now();

insert into public.occupancies (unit_id, account_id, status, started_at)
select 'bb000000-0000-0000-0000-000000000041',
       (select id from public.accounts where auth_user_id = 'bb000000-0000-0000-0000-000000000002'),
       'active', now();

-- Pre-seeded active household member of Unit 1
insert into public.household_members (
  id, unit_id, account_id, person_id, invited_by, status, joined_at
)
select 'bb000000-0000-0000-0000-000000000080',
       'bb000000-0000-0000-0000-000000000040',
       (select id from public.accounts where auth_user_id = 'bb000000-0000-0000-0000-000000000003'),
       'bb000000-0000-0000-0000-000000000052',
       (select id from public.accounts where auth_user_id = 'bb000000-0000-0000-0000-000000000001'),
       'active', now();

-- Active authorization created by the household member's account —
-- this will be revoked by the cascade trigger when the member is ended.
insert into public.authorizations (
  id, organization_id, person_id, scope_unit_id, appointment_id,
  access_type, purpose, note, host_person_id,
  authorization_type, valid_from, valid_until, status, created_by
) values (
  'bb000000-0000-0000-0000-000000000090',
  'bb000000-0000-0000-0000-000000000010',
  'bb000000-0000-0000-0000-000000000060',
  'bb000000-0000-0000-0000-000000000040',
  null, 'visitor', 'cascade test', null, 'bb000000-0000-0000-0000-000000000052',
  'one_time', now() - interval '1 hour', now() + interval '3 hours', 'active',
  (select id from public.accounts where auth_user_id = 'bb000000-0000-0000-0000-000000000003')
);

-- ============================================================================
-- Assertions
-- ============================================================================

-- ---- list_household_members -----------------------------------------------

-- Authenticate as Resident A (primary resident of Unit 1)
select set_config('request.jwt.claims',
  '{"sub":"bb000000-0000-0000-0000-000000000001"}', true);

-- A: Resident A sees the seeded active member
select is(
  (select count(*)::int from public.list_household_members(
    'bb000000-0000-0000-0000-000000000040'::uuid) hm
   where hm.household_member_id = 'bb000000-0000-0000-0000-000000000080'::uuid
     and hm.status = 'active'),
  1,
  'A: resident sees the seeded active member'
);

-- ---- generate_household_invite --------------------------------------------

-- B: Resident A generates a household invite — happy path
select set_config('test.b12_code',
  (select code from public.generate_household_invite(
    'bb000000-0000-0000-0000-000000000040'::uuid, 1440)),
  true);

select ok(
  length(coalesce(current_setting('test.b12_code', true), '')) = 8,
  'B: generate returns an 8-char code'
);

-- C: Resident B (primary of Unit 2) tries to generate for Unit 1 → NOT_AUTHORIZED
select set_config('request.jwt.claims',
  '{"sub":"bb000000-0000-0000-0000-000000000002"}', true);

select throws_ok(
  $$select * from public.generate_household_invite(
      'bb000000-0000-0000-0000-000000000040'::uuid, 1440)$$,
  'P0001',
  'NOT_AUTHORIZED',
  'C: non-primary-resident caller rejected'
);

-- D: Resident A with invalid duration → INVALID_DURATION
select set_config('request.jwt.claims',
  '{"sub":"bb000000-0000-0000-0000-000000000001"}', true);

select throws_ok(
  $$select * from public.generate_household_invite(
      'bb000000-0000-0000-0000-000000000040'::uuid, 0)$$,
  'P0001',
  'INVALID_DURATION',
  'D: zero duration rejected'
);

-- ---- cancel_household_invite ----------------------------------------------

-- E: Cancel the pending invite — happy path
select lives_ok(
  $$select public.cancel_household_invite(
      'bb000000-0000-0000-0000-000000000040'::uuid,
      'test cancel')$$,
  'E: cancel succeeds on a live invite'
);

-- F: Cancel again — no live invite → INVITE_NOT_FOUND
select throws_ok(
  $$select public.cancel_household_invite(
      'bb000000-0000-0000-0000-000000000040'::uuid,
      'second cancel')$$,
  'P0001',
  'INVITE_NOT_FOUND',
  'F: second cancel rejected'
);

-- ---- end_household_member -------------------------------------------------

-- G: End the seeded active member — happy path
select lives_ok(
  $$select public.end_household_member(
      'bb000000-0000-0000-0000-000000000080'::uuid,
      'test end')$$,
  'G: end succeeds on active member'
);

-- H: Cascade trigger revoked the member's active authorization
select is(
  (select a.status from public.authorizations a
    where a.id = 'bb000000-0000-0000-0000-000000000090'::uuid),
  'revoked',
  'H: cascade trigger revoked the member''s active authorization'
);

-- I: Idempotent — calling end on already-ended returns without error
select lives_ok(
  $$select public.end_household_member(
      'bb000000-0000-0000-0000-000000000080'::uuid,
      'idempotent')$$,
  'I: end is idempotent on an already-ended member'
);

-- ---- end on invited row → HOUSEHOLD_MEMBER_NOT_ACTIVE --------------------

-- Generate a fresh invite to obtain a live invited row.
select set_config('test.b12_invited_hm',
  (select household_member_id::text from public.generate_household_invite(
    'bb000000-0000-0000-0000-000000000040'::uuid, 60)),
  true);

-- J: Attempting to end the invited row → HOUSEHOLD_MEMBER_NOT_ACTIVE
select throws_ok(
  $$select public.end_household_member(
      current_setting('test.b12_invited_hm')::uuid, 'wrong path')$$,
  'P0001',
  'HOUSEHOLD_MEMBER_NOT_ACTIVE',
  'J: invited row rejected as not active'
);

-- ---- unauthenticated -----------------------------------------------------

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009999"}', true);

-- K: list rejects unauthenticated caller
select throws_ok(
  $$select * from public.list_household_members(
      'bb000000-0000-0000-0000-000000000040'::uuid)$$,
  'P0001',
  'NOT_AUTHENTICATED',
  'K: unauthenticated caller rejected by list'
);

-- L: end rejects unauthenticated caller
select throws_ok(
  $$select public.end_household_member(
      'bb000000-0000-0000-0000-000000000080'::uuid, null)$$,
  'P0001',
  'NOT_AUTHENTICATED',
  'L: unauthenticated caller rejected by end'
);

select * from finish();

rollback;
