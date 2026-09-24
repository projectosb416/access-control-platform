-- ============================================================================
-- Test: evaluate_entry
-- ============================================================================
-- Covers the GRANTED path end-to-end plus the concurrency rule (handoff §23):
-- a second ENTRY with a new idempotency key must return UNRESOLVED_VISIT
-- when an open session already exists.
--
-- Wrapped in begin/rollback — no fixtures persist after the test runs.
-- Run via `supabase test db` in CI (job: test-db).
--
-- Fixtures use UUIDs prefixed 'b1'. If this file is ever removed, no
-- staging rows are left behind — rollback discards everything.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(8);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at)
values ('b1000000-0000-0000-0000-000000000001', 'test-entry-admin@test.com', now(), now());

insert into public.organizations (id, name, display_name, organization_type, status)
values ('b1000000-0000-0000-0000-000000000010', 'test-entry-org', 'Test Entry',
        'residential', 'active');

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'b1000000-0000-0000-0000-000000000010', a.id, 'admin', 'active', now()
from public.accounts a where a.auth_user_id = 'b1000000-0000-0000-0000-000000000001';

insert into public.plans (id, code, name, currency, price_minor_units, billing_cycle_months, status)
values ('b1000000-0000-0000-0000-000000000020', 'test-plan', 'Test Plan',
        'NGN', 100000, 12, 'active');

insert into public.subscriptions (organization_id, plan_id, status,
                                   current_period_start, current_period_end)
values ('b1000000-0000-0000-0000-000000000010', 'b1000000-0000-0000-0000-000000000020',
        'active', now(), now() + interval '12 months');

insert into public.people (id, organization_id, full_name)
values ('b1000000-0000-0000-0000-000000000030', 'b1000000-0000-0000-0000-000000000010',
        'Test Guard');

insert into public.guard_profiles (id, organization_id, person_id, guard_code, status)
values ('b1000000-0000-0000-0000-000000000040', 'b1000000-0000-0000-0000-000000000010',
        'b1000000-0000-0000-0000-000000000030', 'GU-TESTE1', 'active');

insert into public.gates (id, organization_id, name, max_active_guards, status)
values ('b1000000-0000-0000-0000-000000000050', 'b1000000-0000-0000-0000-000000000010',
        'Test Gate', 2, 'active');

insert into public.shifts (id, organization_id, gate_id, shift_code,
                            scheduled_start, scheduled_end, status)
values ('b1000000-0000-0000-0000-000000000060', 'b1000000-0000-0000-0000-000000000010',
        'b1000000-0000-0000-0000-000000000050', 'SH-TESTE1',
        now() - interval '10 min', now() + interval '4 hours', 'active');

insert into public.shift_sessions (id, shift_id, guard_profile_id, status, started_at)
values ('b1000000-0000-0000-0000-000000000070', 'b1000000-0000-0000-0000-000000000060',
        'b1000000-0000-0000-0000-000000000040', 'active', now());

insert into public.people (id, organization_id, full_name)
values ('b1000000-0000-0000-0000-000000000080', 'b1000000-0000-0000-0000-000000000010',
        'Test Visitor');

insert into public.authorizations (id, organization_id, person_id, access_type, purpose,
                                    authorization_type, valid_from, valid_until, status)
values ('b1000000-0000-0000-0000-000000000090', 'b1000000-0000-0000-0000-000000000010',
        'b1000000-0000-0000-0000-000000000080', 'visitor', 'test visit',
        'one_time', now() - interval '1 hour', now() + interval '3 hours', 'active');

insert into public.access_credentials (id, organization_id, authorization_id, credential,
                                        lookup_key, status)
values ('b1000000-0000-0000-0000-000000000100', 'b1000000-0000-0000-0000-000000000010',
        'b1000000-0000-0000-0000-000000000090',
        '$pbkdf2-sha256$i=100000$AAAA$BBBB', 'test-lookup-1', 'active');

-- ============================================================================
-- Assertion 1: GRANTED on valid state
-- ============================================================================
select is(
  (select result_code from public.evaluate_entry(
    'b1000000-0000-0000-0000-000000000010',
    'b1000000-0000-0000-0000-000000000100',
    'b1000000-0000-0000-0000-000000000050',
    'b1000000-0000-0000-0000-000000000040',
    'test-entry-key-1'
  )),
  'GRANTED',
  'evaluate_entry returns GRANTED for valid state'
);

-- ============================================================================
-- Assertion 2: credential moves to in_use
-- ============================================================================
select is(
  (select status from public.access_credentials
    where id = 'b1000000-0000-0000-0000-000000000100'),
  'in_use',
  'credential moves to in_use after GRANTED'
);

-- ============================================================================
-- Assertion 3: one_time authorization moves to in_progress
-- ============================================================================
select is(
  (select status from public.authorizations
    where id = 'b1000000-0000-0000-0000-000000000090'),
  'in_progress',
  'one_time authorization moves to in_progress after GRANTED'
);

-- ============================================================================
-- Assertion 4: exactly one open session
-- ============================================================================
select is(
  (select count(*)::int from public.access_sessions
    where authorization_id = 'b1000000-0000-0000-0000-000000000090'
      and status = 'open'),
  1,
  'exactly one open session exists after GRANTED'
);

-- ============================================================================
-- Assertion 5: exactly one GRANTED event
-- ============================================================================
select is(
  (select count(*)::int from public.access_events
    where authorization_id = 'b1000000-0000-0000-0000-000000000090'
      and result_code = 'GRANTED'),
  1,
  'exactly one GRANTED event was written'
);

-- ============================================================================
-- Assertion 6: idempotent replay returns same event id
-- ============================================================================
select is(
  (select access_event_id from public.evaluate_entry(
    'b1000000-0000-0000-0000-000000000010',
    'b1000000-0000-0000-0000-000000000100',
    'b1000000-0000-0000-0000-000000000050',
    'b1000000-0000-0000-0000-000000000040',
    'test-entry-key-1'
  )),
  (select id from public.access_events
    where authorization_id = 'b1000000-0000-0000-0000-000000000090'
      and result_code = 'GRANTED'
    limit 1),
  'idempotent replay returns the original event id'
);

-- ============================================================================
-- Assertion 7: replay did not create a second session
-- ============================================================================
select is(
  (select count(*)::int from public.access_sessions
    where authorization_id = 'b1000000-0000-0000-0000-000000000090'
      and status = 'open'),
  1,
  'idempotent replay did not create a second session'
);

-- ============================================================================
-- Assertion 8: new idempotency key with open session → UNRESOLVED_VISIT
-- ============================================================================
select is(
  (select result_code from public.evaluate_entry(
    'b1000000-0000-0000-0000-000000000010',
    'b1000000-0000-0000-0000-000000000100',
    'b1000000-0000-0000-0000-000000000050',
    'b1000000-0000-0000-0000-000000000040',
    'test-entry-key-2'
  )),
  'UNRESOLVED_VISIT',
  'a second entry with a fresh idempotency key is blocked'
);

select * from finish();

rollback;
