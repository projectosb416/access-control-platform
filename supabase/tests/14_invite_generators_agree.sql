-- ============================================================================
-- Test: invite generators agree on happy path (migration 0061, #20)
-- ============================================================================
-- Migration 0061 widened generate_unit_invite's collision check to
-- include household_members, mirroring generate_household_invite.
--
-- The collision check itself is probabilistic (31^8 ≈ 852 billion) — we
-- cannot assert a collision occurs. What we CAN assert is that the
-- widened check does not break the happy path. A mistyped `union all`,
-- a wrong table name, or a bad alias would cause every generation to
-- raise — that's the real risk of 0061.
--
-- Two assertions, one per generator:
--   A. generate_unit_invite returns an 8-char code on a vacant unit
--   B. generate_household_invite returns an 8-char code on an occupied unit
--
-- Together they prove the two generators behave identically on the
-- happy path — which is the structural symmetry 0061 was designed to
-- achieve.
--
-- Fixtures use UUID prefix 'dd'. Wrapped in begin/rollback.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(2);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at) values
  ('dd000000-0000-0000-0000-000000000001', 'test-invgen-admin@test.com',     now(), now()),
  ('dd000000-0000-0000-0000-000000000002', 'test-invgen-resident@test.com',  now(), now());

insert into public.organizations (id, name, display_name, organization_type, status)
values ('dd000000-0000-0000-0000-000000000010', 'test-invgen-org', 'Test InvGen',
        'residential', 'active');

-- Admin user (for generate_unit_invite)
insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'dd000000-0000-0000-0000-000000000010', a.id, 'admin', 'active', now()
from public.accounts a where a.auth_user_id = 'dd000000-0000-0000-0000-000000000001';

-- Primary resident user (for generate_household_invite)
insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'dd000000-0000-0000-0000-000000000010', a.id, 'primary_resident', 'active', now()
from public.accounts a where a.auth_user_id = 'dd000000-0000-0000-0000-000000000002';

insert into public.plans (id, code, name, currency, price_minor_units, billing_cycle_months, status)
values ('dd000000-0000-0000-0000-000000000020', 'test-invgen-plan', 'Test InvGen Plan',
        'NGN', 100000, 12, 'active');

insert into public.subscriptions (organization_id, plan_id, status,
                                   current_period_start, current_period_end)
values ('dd000000-0000-0000-0000-000000000010', 'dd000000-0000-0000-0000-000000000020',
        'active', now(), now() + interval '12 months');

insert into public.properties (id, organization_id, name, status)
values ('dd000000-0000-0000-0000-000000000030', 'dd000000-0000-0000-0000-000000000010',
        'Test InvGen Property', 'active');

insert into public.units (id, property_id, label, status) values
  ('dd000000-0000-0000-0000-000000000040', 'dd000000-0000-0000-0000-000000000030', 'Unit 1', 'active'),
  ('dd000000-0000-0000-0000-000000000041', 'dd000000-0000-0000-0000-000000000030', 'Unit 2', 'active');

-- Primary resident person + active occupancy on Unit 2 (leave Unit 1 vacant).
insert into public.people (id, organization_id, account_id, full_name, status)
select 'dd000000-0000-0000-0000-000000000050', 'dd000000-0000-0000-0000-000000000010',
       a.id, 'Primary Resident', 'active'
from public.accounts a where a.auth_user_id = 'dd000000-0000-0000-0000-000000000002';

insert into public.occupancies (unit_id, account_id, status, started_at)
select 'dd000000-0000-0000-0000-000000000041',
       (select id from public.accounts where auth_user_id = 'dd000000-0000-0000-0000-000000000002'),
       'active', now();

-- ============================================================================
-- Assertions
-- ============================================================================

-- A. Admin generates a unit invite on the VACANT unit — happy path
select set_config('request.jwt.claims',
  '{"sub":"dd000000-0000-0000-0000-000000000001"}', true);

select is(
  (select length(code) from public.generate_unit_invite(
    'dd000000-0000-0000-0000-000000000010'::uuid,
    'dd000000-0000-0000-0000-000000000040'::uuid,
    1440)),
  8,
  'A: generate_unit_invite returns 8-char code (widened collision check intact)'
);

-- B. Primary resident generates a household invite on their own unit
select set_config('request.jwt.claims',
  '{"sub":"dd000000-0000-0000-0000-000000000002"}', true);

select is(
  (select length(code) from public.generate_household_invite(
    'dd000000-0000-0000-0000-000000000041'::uuid,
    1440)),
  8,
  'B: generate_household_invite returns 8-char code (symmetric path intact)'
);

select * from finish();

rollback;
