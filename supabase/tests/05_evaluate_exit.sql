-- ============================================================================
-- Test: evaluate_exit
-- ============================================================================
-- Covers the EXIT flow: happy path, different-gate exit (handoff §18),
-- credential lifecycle transitions, NO_ACTIVE_SESSION error, idempotency.
--
-- Wrapped in begin/rollback. Fixtures use UUIDs prefixed 'b5'.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(9);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at)
values ('b5000000-0000-0000-0000-000000000001', 'test-exit-admin@test.com', now(), now());

insert into public.organizations (id, name, display_name, organization_type, status)
values ('b5000000-0000-0000-0000-000000000010', 'test-exit-org', 'Test Exit',
        'residential', 'active');

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'b5000000-0000-0000-0000-000000000010', a.id, 'admin', 'active', now()
from public.accounts a where a.auth_user_id = 'b5000000-0000-0000-0000-000000000001';

insert into public.plans (id, code, name, currency, price_minor_units, billing_cycle_months, status)
values ('b5000000-0000-0000-0000-000000000020', 'test-exit-plan', 'Test Exit Plan',
        'NGN', 100000, 12, 'active');

insert into public.subscriptions (organization_id, plan_id, status,
                                   current_period_start, current_period_end)
values ('b5000000-0000-0000-0000-000000000010', 'b5000000-0000-0000-0000-000000000020',
        'active', now(), now() + interval '12 months');

insert into public.people (id, organization_id, full_name) values
  ('b5000000-0000-0000-0000-000000000030', 'b5000000-0000-0000-0000-000000000010', 'Test Guard'),
  ('b5000000-0000-0000-0000-000000000031', 'b5000000-0000-0000-0000-000000000010', 'Test Visitor');

insert into public.guard_profiles (id, organization_id, person_id, guard_code, status)
values ('b5000000-0000-0000-0000-000000000040', 'b5000000-0000-0000-0000-000000000010',
        'b5000000-0000-0000-0000-000000000030', 'GU-EXITT1', 'active');

-- Two gates: entry gate and a separate exit gate
insert into public.gates (id, organization_id, name, max_active_guards, status) values
  ('b5000000-0000-0000-0000-000000000050', 'b5000000-0000-0000-0000-000000000010',
   'Gate Entry', 2, 'active'),
  ('b5000000-0000-0000-0000-000000000051', 'b5000000-0000-0000-0000-000000000010',
   'Gate Exit', 2, 'active');

-- Shift 1 at entry gate (used for opening the session)
insert into public.shifts (id, organization_id, gate_id, shift_code,
                            scheduled_start, scheduled_end, status)
values ('b5000000-0000-0000-0000-000000000060', 'b5000000-0000-0000-0000-000000000010',
        'b5000000-0000-0000-0000-000000000050', 'SH-EXITT1',
        now() - interval '10 min', now() + interval '4 hours', 'active');

insert into public.shift_sessions (id, shift_id, guard_profile_id, status, started_at)
values ('b5000000-0000-0000-0000-000000000070', 'b5000000-0000-0000-0000-000000000060',
        'b5000000-0000-0000-0000-000000000040', 'active', now());

-- Shift 2 at exit gate (guard works a second shift context for exit)
-- Note: in real life this would be a different guard or a different shift window.
-- For test purposes, we close the first shift session and open a second at the exit gate.
update public.shift_sessions set status = 'completed', ended_at = now()
 where id = 'b5000000-0000-0000-0000-000000000070';

insert into public.shifts (id, organization_id, gate_id, shift_code,
                            scheduled_start, scheduled_end, status)
values ('b5000000-0000-0000-0000-000000000061', 'b5000000-0000-0000-0000-000000000010',
        'b5000000-0000-0000-0000-000000000051', 'SH-EXITT2',
        now() - interval '5 min', now() + interval '4 hours', 'active');

insert into public.shift_sessions (id, shift_id, guard_profile_id, status, started_at)
values ('b5000000-0000-0000-0000-000000000071', 'b5000000-0000-0000-0000-000000000061',
        'b5000000-0000-0000-0000-000000000040', 'active', now());

-- One-time authorization with credential in_use and an open session at entry gate
insert into public.authorizations (id, organization_id, person_id, access_type, purpose,
                                    authorization_type, valid_from, valid_until, status)
values ('b5000000-0000-0000-0000-000000000090', 'b5000000-0000-0000-0000-000000000010',
        'b5000000-0000-0000-0000-000000000031', 'visitor', 'exit test visit',
        'one_time', now() - interval '2 hours', now() + interval '3 hours', 'in_progress');

insert into public.access_credentials (id, organization_id, authorization_id, credential,
                                        lookup_key, status)
values ('b5000000-0000-0000-0000-000000000100', 'b5000000-0000-0000-0000-000000000010',
        'b5000000-0000-0000-0000-000000000090',
        '$pbkdf2-sha256$i=100000$AAAA$BBBB', 'test-exit-lookup-1', 'in_use');

insert into public.access_sessions (id, organization_id, authorization_id, person_id,
                                     gate_entered_id, entered_shift_session_id,
                                     opened_by_event_id, status, entered_at)
values ('b5000000-0000-0000-0000-000000000110', 'b5000000-0000-0000-0000-000000000010',
        'b5000000-0000-0000-0000-000000000090', 'b5000000-0000-0000-0000-000000000031',
        'b5000000-0000-0000-0000-000000000050', 'b5000000-0000-0000-0000-000000000070',
        'b5000000-0000-0000-0000-000000000111', 'open', now() - interval '30 min');

-- ============================================================================
-- Assertion 1: EXIT succeeds at DIFFERENT gate
-- ============================================================================
select is(
  (select result_code from public.evaluate_exit(
    'b5000000-0000-0000-0000-000000000010',
    'b5000000-0000-0000-0000-000000000100',
    'b5000000-0000-0000-0000-000000000051',   -- exit at Gate Exit, entered at Gate Entry
    'b5000000-0000-0000-0000-000000000040',
    'test-exit-key-1'
  )),
  'GRANTED',
  'exit at a different gate succeeds (handoff §18)'
);

-- ============================================================================
-- Assertion 2: session status becomes completed
-- ============================================================================
select is(
  (select status from public.access_sessions
    where id = 'b5000000-0000-0000-0000-000000000110'),
  'completed',
  'session status becomes completed after exit'
);

-- ============================================================================
-- Assertion 3: entry gate preserved, exit gate recorded separately
-- ============================================================================
select is(
  (select (gate_entered_id, gate_exited_id)::text from public.access_sessions
    where id = 'b5000000-0000-0000-0000-000000000110'),
  '(b5000000-0000-0000-0000-000000000050,b5000000-0000-0000-0000-000000000051)',
  'entry and exit gate ids both recorded distinctly'
);

-- ============================================================================
-- Assertion 4: one-time credential becomes consumed
-- ============================================================================
select is(
  (select status from public.access_credentials
    where id = 'b5000000-0000-0000-0000-000000000100'),
  'consumed',
  'one-time credential consumed after exit'
);

-- ============================================================================
-- Assertion 5: one-time authorization becomes completed
-- ============================================================================
select is(
  (select status from public.authorizations
    where id = 'b5000000-0000-0000-0000-000000000090'),
  'completed',
  'one-time authorization completed after exit'
);

-- ============================================================================
-- Assertion 6: EXIT event was written with GRANTED
-- ============================================================================
select is(
  (select count(*)::int from public.access_events
    where authorization_id = 'b5000000-0000-0000-0000-000000000090'
      and direction = 'exit'
      and result_code = 'GRANTED'),
  1,
  'exactly one GRANTED exit event written'
);

-- ============================================================================
-- Assertion 7: second exit attempt → NO_ACTIVE_SESSION
-- ============================================================================
select is(
  (select result_code from public.evaluate_exit(
    'b5000000-0000-0000-0000-000000000010',
    'b5000000-0000-0000-0000-000000000100',
    'b5000000-0000-0000-0000-000000000051',
    'b5000000-0000-0000-0000-000000000040',
    'test-exit-key-2'
  )),
  'NO_ACTIVE_SESSION',
  'second exit attempt returns NO_ACTIVE_SESSION'
);

-- ============================================================================
-- Assertion 8: idempotent replay returns original event id
-- ============================================================================
select is(
  (select access_event_id from public.evaluate_exit(
    'b5000000-0000-0000-0000-000000000010',
    'b5000000-0000-0000-0000-000000000100',
    'b5000000-0000-0000-0000-000000000051',
    'b5000000-0000-0000-0000-000000000040',
    'test-exit-key-1'
  )),
  (select id from public.access_events
    where authorization_id = 'b5000000-0000-0000-0000-000000000090'
      and direction = 'exit'
      and result_code = 'GRANTED'
    limit 1),
  'idempotent replay returns the original exit event id'
);

-- ============================================================================
-- Assertion 9: exactly one exit GRANTED event (no duplicate from replay)
-- ============================================================================
select is(
  (select count(*)::int from public.access_events
    where authorization_id = 'b5000000-0000-0000-0000-000000000090'
      and direction = 'exit'
      and result_code = 'GRANTED'),
  1,
  'replay did not create a second exit event'
);

select * from finish();

rollback;
