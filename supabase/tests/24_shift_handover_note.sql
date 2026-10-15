-- ============================================================================
-- Test: end_shift_session handover note + latest_gate_handover (0077)
-- ============================================================================
-- Five assertions:
--   A. end_shift_session stores handover_note when provided
--   B. end_shift_session leaves handover_note NULL when omitted
--   C. latest_gate_handover returns the latest completed note
--   D. latest_gate_handover returns zero rows on a gate with no history
--   E. Non-org-member rejected by latest_gate_handover
--
-- Fixtures use UUID prefix 'cf'. Wrapped in begin/rollback.
--
-- Fixture note: shift_sessions carries the partial unique index
-- `shift_sessions_one_active_per_guard` on (guard_profile_id)
-- where status = 'active' (migration 0008). Each active session in
-- this fixture therefore uses a distinct guard_profile. Four guard
-- profiles, four people, four active sessions.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(5);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at) values
  ('cf000000-0000-0000-0000-000000000001', 'test-handover-member@test.com', now(), now()),
  ('cf000000-0000-0000-0000-000000000002', 'test-handover-other@test.com',  now(), now());

insert into public.organizations (id, name, display_name, organization_type, status) values
  ('cf000000-0000-0000-0000-000000000010', 'test-handover-org', 'Test Handover Org',
   'residential', 'active');

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'cf000000-0000-0000-0000-000000000010', a.id, 'admin', 'active', now()
from public.accounts a
where a.auth_user_id = 'cf000000-0000-0000-0000-000000000001';

insert into public.gates (id, organization_id, name, max_active_guards, status) values
  ('cf000000-0000-0000-0000-000000000020', 'cf000000-0000-0000-0000-000000000010', 'Gate A', 4, 'active'),
  ('cf000000-0000-0000-0000-000000000021', 'cf000000-0000-0000-0000-000000000010', 'Gate B', 2, 'active');

insert into public.people (id, organization_id, full_name) values
  ('cf000000-0000-0000-0000-000000000030', 'cf000000-0000-0000-0000-000000000010', 'Guard One'),
  ('cf000000-0000-0000-0000-000000000031', 'cf000000-0000-0000-0000-000000000010', 'Guard Two'),
  ('cf000000-0000-0000-0000-000000000032', 'cf000000-0000-0000-0000-000000000010', 'Guard Three'),
  ('cf000000-0000-0000-0000-000000000033', 'cf000000-0000-0000-0000-000000000010', 'Guard Four');

insert into public.guard_profiles (id, organization_id, person_id, guard_code, status) values
  ('cf000000-0000-0000-0000-000000000040', 'cf000000-0000-0000-0000-000000000010',
   'cf000000-0000-0000-0000-000000000030', 'GU-CF0001', 'active'),
  ('cf000000-0000-0000-0000-000000000041', 'cf000000-0000-0000-0000-000000000010',
   'cf000000-0000-0000-0000-000000000031', 'GU-CF0002', 'active'),
  ('cf000000-0000-0000-0000-000000000042', 'cf000000-0000-0000-0000-000000000010',
   'cf000000-0000-0000-0000-000000000032', 'GU-CF0003', 'active'),
  ('cf000000-0000-0000-0000-000000000043', 'cf000000-0000-0000-0000-000000000010',
   'cf000000-0000-0000-0000-000000000033', 'GU-CF0004', 'active');

-- Shifts: A and B on Gate A; C on Gate B; D on Gate A (fresh, read anchor)
insert into public.shifts (id, organization_id, gate_id, shift_code, scheduled_start, scheduled_end, status) values
  ('cf000000-0000-0000-0000-000000000050', 'cf000000-0000-0000-0000-000000000010',
   'cf000000-0000-0000-0000-000000000020', 'SH-CF0001', now() - interval '8 hours', now() - interval '1 hour', 'active'),
  ('cf000000-0000-0000-0000-000000000051', 'cf000000-0000-0000-0000-000000000010',
   'cf000000-0000-0000-0000-000000000020', 'SH-CF0002', now() - interval '8 hours', now() - interval '1 hour', 'active'),
  ('cf000000-0000-0000-0000-000000000052', 'cf000000-0000-0000-0000-000000000010',
   'cf000000-0000-0000-0000-000000000021', 'SH-CF0003', now() - interval '8 hours', now() - interval '1 hour', 'active'),
  ('cf000000-0000-0000-0000-000000000053', 'cf000000-0000-0000-0000-000000000010',
   'cf000000-0000-0000-0000-000000000020', 'SH-CF0004', now(), now() + interval '8 hours', 'active');

-- Sessions: A cf-060 Guard One; B cf-061 Guard Two; D cf-062 Guard Three; E cf-071 Guard Four.
-- Each has a distinct guard_profile — shift_sessions_one_active_per_guard.
insert into public.shift_sessions (id, shift_id, guard_profile_id, status) values
  ('cf000000-0000-0000-0000-000000000060', 'cf000000-0000-0000-0000-000000000050',
   'cf000000-0000-0000-0000-000000000040', 'active'),
  ('cf000000-0000-0000-0000-000000000061', 'cf000000-0000-0000-0000-000000000051',
   'cf000000-0000-0000-0000-000000000041', 'active'),
  ('cf000000-0000-0000-0000-000000000062', 'cf000000-0000-0000-0000-000000000052',
   'cf000000-0000-0000-0000-000000000042', 'active'),
  ('cf000000-0000-0000-0000-000000000071', 'cf000000-0000-0000-0000-000000000053',
   'cf000000-0000-0000-0000-000000000043', 'active');

-- ============================================================================
-- Authenticate as the org member
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"cf000000-0000-0000-0000-000000000001"}', true);

-- ============================================================================
-- A. End shift WITH handover note
-- ============================================================================

select public.end_shift_session(
  'cf000000-0000-0000-0000-000000000010'::uuid,
  'cf000000-0000-0000-0000-000000000060'::uuid,
  'guard ended shift',
  'Gate A key card reader is flaky — use the manual override if needed.'
);

select is(
  (select handover_note
     from public.shift_sessions
    where id = 'cf000000-0000-0000-0000-000000000060'),
  'Gate A key card reader is flaky — use the manual override if needed.',
  'A: handover_note stored'
);

-- ============================================================================
-- B. End shift WITHOUT handover note — column stays null
-- ============================================================================

select public.end_shift_session(
  'cf000000-0000-0000-0000-000000000010'::uuid,
  'cf000000-0000-0000-0000-000000000061'::uuid,
  'guard ended shift'
);

select is(
  (select handover_note is null
     from public.shift_sessions
    where id = 'cf000000-0000-0000-0000-000000000061'),
  true,
  'B: handover_note null when not provided'
);

-- ============================================================================
-- C. latest_gate_handover returns the latest note on this gate
--    Session E (cf-071) is on Gate A. Session A (cf-060) was just completed
--    with a note on Gate A. Session B (cf-061) is completed but has a null
--    note — it must be excluded. Expect session A's note.
-- ============================================================================

select is(
  (select handover_note
     from public.latest_gate_handover(
       'cf000000-0000-0000-0000-000000000010'::uuid,
       'cf000000-0000-0000-0000-000000000071'::uuid)),
  'Gate A key card reader is flaky — use the manual override if needed.',
  'C: latest_gate_handover returns the note from the completed session on the same gate'
);

-- ============================================================================
-- D. latest_gate_handover returns zero rows on a gate with no history
--    Session cf-062 is on Gate B. No completed session with a note on
--    Gate B. Expect zero rows.
-- ============================================================================

select is(
  (select count(*)::int
     from public.latest_gate_handover(
       'cf000000-0000-0000-0000-000000000010'::uuid,
       'cf000000-0000-0000-0000-000000000062'::uuid)),
  0,
  'D: no handover notes on a gate with no completed handovers'
);

-- ============================================================================
-- E. Non-org-member rejected
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"cf000000-0000-0000-0000-000000000002"}', true);

select throws_ok(
  $$select * from public.latest_gate_handover(
      'cf000000-0000-0000-0000-000000000010'::uuid,
      'cf000000-0000-0000-0000-000000000071'::uuid)$$,
  'P0001',
  'NOT_ORG_MEMBER',
  'E: non-org-member caller rejected'
);

select * from finish();

rollback;
