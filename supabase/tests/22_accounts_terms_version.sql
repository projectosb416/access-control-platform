-- ============================================================================
-- Test: handle_new_auth_user() terms_version (migration 0075)
-- ============================================================================
-- Three assertions:
--   A. Both metadata fields present -> both columns populated
--   B. terms_accepted true, no version -> accepted_at set, version null
--   C. No metadata -> both null
--
-- Fixtures use UUID prefix 'cc'. Wrapped in begin/rollback.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(3);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data, created_at, updated_at) values
  ('cd000000-0000-0000-0000-000000000001',
   'test-terms-both@test.com',
   '{"terms_accepted": true, "terms_version": "v1-draft-2026-10-13"}'::jsonb,
   now(), now()),
  ('cd000000-0000-0000-0000-000000000002',
   'test-terms-noversion@test.com',
   '{"terms_accepted": true}'::jsonb,
   now(), now()),
  ('cd000000-0000-0000-0000-000000000003',
   'test-terms-none@test.com',
   null,
   now(), now());

-- ============================================================================
-- A. Both fields set when accepted + version provided
-- ============================================================================

select is(
  (select (terms_accepted_at is not null, terms_version)::text
     from public.accounts
    where auth_user_id = 'cd000000-0000-0000-0000-000000000001'),
  '(true,v1-draft-2026-10-13)',
  'A: terms_accepted_at set and version preserved exactly'
);

-- ============================================================================
-- B. terms_accepted true, no version -> accepted_at set, version null
-- ============================================================================

select is(
  (select (terms_accepted_at is not null, terms_version is null)::text
     from public.accounts
    where auth_user_id = 'cd000000-0000-0000-0000-000000000002'),
  '(true,true)',
  'B: version null when client omitted it, accepted_at still set'
);

-- ============================================================================
-- C. No metadata -> both null
-- ============================================================================

select is(
  (select (terms_accepted_at is null, terms_version is null)::text
     from public.accounts
    where auth_user_id = 'cd000000-0000-0000-0000-000000000003'),
  '(true,true)',
  'C: both null when terms_accepted not provided'
);

select * from finish();

rollback;
