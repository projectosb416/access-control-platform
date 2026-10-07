-- ============================================================================
-- Test: terms_accepted_at trigger extension (migration 0069)
-- ============================================================================
-- Five assertions covering the extended handle_new_auth_user() trigger:
--   A. Metadata with boolean true -> timestamp recorded
--   B. Metadata with string 'true' -> timestamp recorded (string form,
--      which is what some clients send after JSON serialization)
--   C. No metadata -> timestamp NULL
--   D. Metadata with string 'false' -> timestamp NULL (case falls
--      through to else)
--   E. status preserved as 'pending_activation' across all cases
--      (guards against the regression caught during migration
--      reconstruction — 'active' vs 'pending_activation')
--
-- Fixtures use UUID prefix 'b8'. Wrapped in begin/rollback.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(5);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('b8000000-0000-0000-0000-000000000001',
   'test-tos-bool@test.com',
   '{"terms_accepted": true}'::jsonb,
   now(), now()),
  ('b8000000-0000-0000-0000-000000000002',
   'test-tos-string@test.com',
   '{"terms_accepted": "true"}'::jsonb,
   now(), now()),
  ('b8000000-0000-0000-0000-000000000003',
   'test-tos-absent@test.com',
   null,
   now(), now()),
  ('b8000000-0000-0000-0000-000000000004',
   'test-tos-false@test.com',
   '{"terms_accepted": "false"}'::jsonb,
   now(), now());

-- ============================================================================
-- A. boolean true -> timestamp recorded
-- ============================================================================

select ok(
  (select terms_accepted_at from public.accounts
    where auth_user_id = 'b8000000-0000-0000-0000-000000000001') is not null,
  'A: terms_accepted boolean true records timestamp'
);

-- ============================================================================
-- B. string 'true' -> timestamp recorded
-- ============================================================================

select ok(
  (select terms_accepted_at from public.accounts
    where auth_user_id = 'b8000000-0000-0000-0000-000000000002') is not null,
  'B: terms_accepted string true records timestamp'
);

-- ============================================================================
-- C. absent flag -> NULL
-- ============================================================================

select is(
  (select terms_accepted_at from public.accounts
    where auth_user_id = 'b8000000-0000-0000-0000-000000000003'),
  null::timestamptz,
  'C: absent flag leaves timestamp null'
);

-- ============================================================================
-- D. string 'false' -> NULL
-- ============================================================================

select is(
  (select terms_accepted_at from public.accounts
    where auth_user_id = 'b8000000-0000-0000-0000-000000000004'),
  null::timestamptz,
  'D: string false leaves timestamp null'
);

-- ============================================================================
-- E. status preserved as 'pending_activation' for all four signups
-- ============================================================================

select is(
  (select string_agg(distinct status, ',' order by status)
     from public.accounts
    where auth_user_id in (
      'b8000000-0000-0000-0000-000000000001',
      'b8000000-0000-0000-0000-000000000002',
      'b8000000-0000-0000-0000-000000000003',
      'b8000000-0000-0000-0000-000000000004'
    )),
  'pending_activation',
  'E: status remains pending_activation for all signups'
);

select * from finish();

rollback;
