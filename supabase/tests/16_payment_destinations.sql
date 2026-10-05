-- ============================================================================
-- Test: payment_destination functions (migration 0066)
-- ============================================================================
-- Twelve assertions covering upsert_payment_destination,
-- set_active_payment_destination, deactivate_payment_destination.
--
-- Load-bearing:
--   E2 — activating a second destination deactivates the first
--   F  — activation of an incomplete destination rejected
--   H  — deactivate is idempotent
--
-- Fixtures use UUID prefix 'ff'. Wrapped in begin/rollback.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(12);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at) values
  ('ff000000-0000-0000-0000-000000000001', 'test-dest-admin@test.com',   now(), now()),
  ('ff000000-0000-0000-0000-000000000002', 'test-dest-regular@test.com', now(), now());

insert into public.platform_admins (account_id, notes)
select a.id, 'test fixture'
from public.accounts a where a.auth_user_id = 'ff000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claims',
  '{"sub":"ff000000-0000-0000-0000-000000000001"}', true);

-- ============================================================================
-- A. Create a complete destination (p_id null)
-- ============================================================================

select set_config('test.dest_a',
  (select upsert_payment_destination(
    null::uuid,
    'Personal — Pishon'::text,
    'Omtic Digital Services'::text,
    'Pishon Samuel IGHO'::text,
    'Fidelity Bank'::text,
    '6551882152'::text,
    null::text
  )::text),
  true
);

select ok(
  length(coalesce(current_setting('test.dest_a', true), '')) > 0,
  'A: create destination via upsert returns an id'
);

-- ============================================================================
-- B. Edit the destination (p_id set)
-- ============================================================================

select lives_ok(
  $$select public.upsert_payment_destination(
      current_setting('test.dest_a')::uuid,
      'Personal — Pishon (edited)'::text,
      'Omtic Digital Services'::text,
      'Pishon Samuel IGHO'::text,
      'Fidelity Bank'::text,
      '6551882152'::text,
      'use BT reference as narration'::text
    )$$,
  'B: edit destination via upsert succeeds'
);

-- ============================================================================
-- C. Blank label → LABEL_REQUIRED
-- ============================================================================

select throws_ok(
  $$select public.upsert_payment_destination(
      null::uuid,
      ''::text,
      'X'::text, 'X'::text, 'X'::text, 'X'::text, null::text)$$,
  'P0001',
  'LABEL_REQUIRED',
  'C: blank label rejected'
);

-- ============================================================================
-- D. Activate the complete destination
-- ============================================================================

select lives_ok(
  $$select public.set_active_payment_destination(
      current_setting('test.dest_a')::uuid)$$,
  'D: activating a complete destination succeeds'
);

select is(
  (select is_active from public.payment_destinations
    where id = current_setting('test.dest_a')::uuid),
  true,
  'D2: destination is now active'
);

-- ============================================================================
-- E. Create a second destination and activate it (collision path)
-- ============================================================================

select set_config('test.dest_b',
  (select upsert_payment_destination(
    null::uuid,
    'Business — ODS'::text,
    'Omtic Digital Services'::text,
    'Omtic Digital Services Ltd'::text,
    'GTBank'::text,
    '0123456789'::text,
    null::text
  )::text),
  true
);

select lives_ok(
  $$select public.set_active_payment_destination(
      current_setting('test.dest_b')::uuid)$$,
  'E: activating second destination succeeds'
);

select is(
  (select (count(*) filter (where is_active), count(*) filter (where not is_active))::text
     from public.payment_destinations),
  '(1,1)',
  'E2: exactly one active and one inactive after swap'
);

-- ============================================================================
-- F. Incomplete destination cannot be activated
-- ============================================================================

select set_config('test.dest_c',
  (select upsert_payment_destination(
    null::uuid,
    'Incomplete'::text,
    'Name'::text,
    'Account'::text,
    'Bank'::text,
    null::text,
    null::text
  )::text),
  true
);

select throws_ok(
  $$select public.set_active_payment_destination(
      current_setting('test.dest_c')::uuid)$$,
  'P0001',
  'INCOMPLETE_DESTINATION',
  'F: incomplete destination cannot be activated'
);

-- ============================================================================
-- G. Deactivate the active destination
-- ============================================================================

select lives_ok(
  $$select public.deactivate_payment_destination(
      current_setting('test.dest_b')::uuid)$$,
  'G: deactivate succeeds on active destination'
);

-- ============================================================================
-- H. Deactivate is idempotent
-- ============================================================================

select lives_ok(
  $$select public.deactivate_payment_destination(
      current_setting('test.dest_b')::uuid)$$,
  'H: deactivate is idempotent'
);

-- ============================================================================
-- I. Non-platform-admin rejected
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"ff000000-0000-0000-0000-000000000002"}', true);

select throws_ok(
  $$select public.upsert_payment_destination(
      null::uuid,
      'X'::text, 'X'::text, 'X'::text, 'X'::text, 'X'::text, null::text)$$,
  'P0001',
  'NOT_PLATFORM_ADMIN',
  'I: non-platform-admin caller rejected'
);

-- ============================================================================
-- J. Unknown UUID → DESTINATION_NOT_FOUND
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"ff000000-0000-0000-0000-000000000001"}', true);

select throws_ok(
  $$select public.set_active_payment_destination(
      'ff000000-0000-0000-0000-000000000999'::uuid)$$,
  'P0001',
  'DESTINATION_NOT_FOUND',
  'J: unknown destination rejected'
);

select * from finish();

rollback;
