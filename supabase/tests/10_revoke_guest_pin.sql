-- ============================================================================
-- Test: revoke_guest_pin
-- ============================================================================
-- Covers migration 0052: authentication, ownership, unit-scope, terminal
-- state rules, idempotency, both tables updated, audit row written.
--
-- Fixtures use UUIDs prefixed 'ea'. Wrapped in begin/rollback.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(9);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at) values
  ('ea000000-0000-0000-0000-000000000001', 'test-revoke-resident-a@test.com', now(), now()),
  ('ea000000-0000-0000-0000-000000000002', 'test-revoke-resident-b@test.com', now(), now());

insert into public.organizations (id, name, display_name, organization_type, status)
values ('ea000000-0000-0000-0000-000000000010', 'test-revoke-org', 'Test Revoke',
        'residential', 'active');

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'ea000000-0000-0000-0000-000000000010', a.id, 'primary_resident', 'active', now()
from public.accounts a where a.auth_user_id = 'ea000000-0000-0000-0000-000000000001';

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'ea000000-0000-0000-0000-000000000010', a.id, 'primary_resident', 'active', now()
from public.accounts a where a.auth_user_id = 'ea000000-0000-0000-0000-000000000002';

insert into public.plans (id, code, name, currency, price_minor_units, billing_cycle_months, status)
values ('ea000000-0000-0000-0000-000000000020', 'test-revoke-plan', 'Test Revoke Plan',
        'NGN', 100000, 12, 'active');

insert into public.subscriptions (id, organization_id, plan_id, status,
                                   current_period_start, current_period_end)
values ('ea000000-0000-0000-0000-000000000021',
        'ea000000-0000-0000-0000-000000000010',
        'ea000000-0000-0000-0000-000000000020',
        'active', now(), now() + interval '12 months');

insert into public.properties (id, organization_id, name, status)
values ('ea000000-0000-0000-0000-000000000030', 'ea000000-0000-0000-0000-000000000010',
        'Test Revoke Property', 'active');

insert into public.units (id, property_id, label, status) values
  ('ea000000-0000-0000-0000-000000000040', 'ea000000-0000-0000-0000-000000000030', 'Unit 1', 'active'),
  ('ea000000-0000-0000-0000-000000000041', 'ea000000-0000-0000-0000-000000000030', 'Unit 2', 'active');

insert into public.people (id, organization_id, account_id, full_name, status) values
  ('ea000000-0000-0000-0000-000000000050',
   'ea000000-0000-0000-0000-000000000010',
   (select id from public.accounts where auth_user_id = 'ea000000-0000-0000-0000-000000000001'),
   'Resident A', 'active'),
  ('ea000000-0000-0000-0000-000000000051',
   'ea000000-0000-0000-0000-000000000010',
   (select id from public.accounts where auth_user_id = 'ea000000-0000-0000-0000-000000000002'),
   'Resident B', 'active');

insert into public.people (id, organization_id, full_name, status)
values ('ea000000-0000-0000-0000-000000000060',
        'ea000000-0000-0000-0000-000000000010',
        'Visitor Person', 'active');

insert into public.occupancies (unit_id, account_id, status, started_at)
select 'ea000000-0000-0000-0000-000000000040',
       (select id from public.accounts where auth_user_id = 'ea000000-0000-0000-0000-000000000001'),
       'active', now();

insert into public.occupancies (unit_id, account_id, status, started_at)
select 'ea000000-0000-0000-0000-000000000041',
       (select id from public.accounts where auth_user_id = 'ea000000-0000-0000-0000-000000000002'),
       'active', now();

-- a1: active, owned by A, scope Unit 1 (revocable target)
insert into public.authorizations (
  id, organization_id, person_id, scope_unit_id, appointment_id,
  access_type, purpose, note, host_person_id,
  authorization_type, valid_from, valid_until, status, created_by
) values (
  'ea000000-0000-0000-0000-0000000000a1',
  'ea000000-0000-0000-0000-000000000010',
  'ea000000-0000-0000-0000-000000000060',
  'ea000000-0000-0000-0000-000000000040',
  null, 'visitor', 'plumbing', null, 'ea000000-0000-0000-0000-000000000050',
  'one_time', now() - interval '1 hour', now() + interval '2 hours', 'active',
  (select id from public.accounts where auth_user_id = 'ea000000-0000-0000-0000-000000000001')
);

-- Live credential for a1
insert into public.access_credentials (
  id, organization_id, authorization_id,
  credential, lookup_key, lookup_key_version, pepper_version,
  status, created_by
) values (
  'ea000000-0000-0000-0000-0000000000c1',
  'ea000000-0000-0000-0000-000000000010',
  'ea000000-0000-0000-0000-0000000000a1',
  '$pbkdf2-sha256$i=100000$AAAA$AAAA',
  'test-revoke-lookup-a1',
  'v1', 'v1', 'active',
  (select id from public.accounts where auth_user_id = 'ea000000-0000-0000-0000-000000000001')
);

-- a2: completed, owned by A, scope Unit 1
insert into public.authorizations (
  id, organization_id, person_id, scope_unit_id, appointment_id,
  access_type, purpose, note, host_person_id,
  authorization_type, valid_from, valid_until, status, created_by
) values (
  'ea000000-0000-0000-0000-0000000000a2',
  'ea000000-0000-0000-0000-000000000010',
  'ea000000-0000-0000-0000-000000000060',
  'ea000000-0000-0000-0000-000000000040',
  null, 'visitor', 'done already', null, 'ea000000-0000-0000-0000-000000000050',
  'one_time', now() - interval '5 hours', now() - interval '4 hours', 'completed',
  (select id from public.accounts where auth_user_id = 'ea000000-0000-0000-0000-000000000001')
);

-- a3: expired, owned by A, scope Unit 1
insert into public.authorizations (
  id, organization_id, person_id, scope_unit_id, appointment_id,
  access_type, purpose, note, host_person_id,
  authorization_type, valid_from, valid_until, status, created_by
) values (
  'ea000000-0000-0000-0000-0000000000a3',
  'ea000000-0000-0000-0000-000000000010',
  'ea000000-0000-0000-0000-000000000060',
  'ea000000-0000-0000-0000-000000000040',
  null, 'visitor', 'older', null, 'ea000000-0000-0000-0000-000000000050',
  'one_time', now() - interval '10 hours', now() - interval '9 hours', 'expired',
  (select id from public.accounts where auth_user_id = 'ea000000-0000-0000-0000-000000000001')
);

-- ============================================================================
-- Assertions
-- ============================================================================

-- Authenticate as Resident A
select set_config('request.jwt.claims',
  '{"sub":"ea000000-0000-0000-0000-000000000001"}', true);

-- A: happy path — revoke a1, authorization flips to 'revoked'
select public.revoke_guest_pin('ea000000-0000-0000-0000-0000000000a1'::uuid);

select is(
  (select status from public.authorizations
    where id = 'ea000000-0000-0000-0000-0000000000a1'::uuid),
  'revoked',
  'A: authorization flipped to revoked'
);

-- B: live credential also flipped to 'revoked'
select is(
  (select status from public.access_credentials
    where id = 'ea000000-0000-0000-0000-0000000000c1'::uuid),
  'revoked',
  'B: live credential flipped to revoked'
);

-- C: audit row written — exactly one
select is(
  (select count(*)::int from public.audit_events
    where action    = 'authorization.revoked'
      and target_type = 'authorization'
      and target_id   = 'ea000000-0000-0000-0000-0000000000a1'::uuid),
  1,
  'C: one audit row for the revocation'
);

-- D: idempotent — second call returns silently, no new audit row
select public.revoke_guest_pin('ea000000-0000-0000-0000-0000000000a1'::uuid);

select is(
  (select count(*)::int from public.audit_events
    where action    = 'authorization.revoked'
      and target_id   = 'ea000000-0000-0000-0000-0000000000a1'::uuid),
  1,
  'D: second revoke is idempotent, no new audit row'
);

-- E: non-owner caller (Resident B tries to revoke A's completed auth)
select set_config('request.jwt.claims',
  '{"sub":"ea000000-0000-0000-0000-000000000002"}', true);

select throws_ok(
  $$select public.revoke_guest_pin('ea000000-0000-0000-0000-0000000000a2'::uuid)$$,
  'P0001',
  'NOT_AUTHORIZED',
  'E: non-owner caller rejected'
);

-- F: unknown UUID → AUTHORIZATION_NOT_FOUND
select throws_ok(
  $$select public.revoke_guest_pin('ea000000-0000-0000-0000-000000000999'::uuid)$$,
  'P0001',
  'AUTHORIZATION_NOT_FOUND',
  'F: unknown authorization rejected'
);

-- G: authenticated but no matching account → NOT_AUTHENTICATED
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000009996"}', true);

select throws_ok(
  $$select public.revoke_guest_pin('ea000000-0000-0000-0000-0000000000a2'::uuid)$$,
  'P0001',
  'NOT_AUTHENTICATED',
  'G: unauthenticated caller rejected'
);

-- Back to Resident A
select set_config('request.jwt.claims',
  '{"sub":"ea000000-0000-0000-0000-000000000001"}', true);

-- H: completed → NOT_REVOKABLE
select throws_ok(
  $$select public.revoke_guest_pin('ea000000-0000-0000-0000-0000000000a2'::uuid)$$,
  'P0001',
  'NOT_REVOKABLE',
  'H: completed authorization cannot be revoked'
);

-- I: expired → NOT_REVOKABLE
select throws_ok(
  $$select public.revoke_guest_pin('ea000000-0000-0000-0000-0000000000a3'::uuid)$$,
  'P0001',
  'NOT_REVOKABLE',
  'I: expired authorization cannot be revoked'
);

select * from finish();

rollback;
