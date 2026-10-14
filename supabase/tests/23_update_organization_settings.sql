-- ============================================================================
-- Test: update_organization_settings (migration 0076)
-- ============================================================================
-- Five assertions:
--   A. Org admin updates name, display_name, organization_type
--   B. Non-admin caller rejected (NOT_ORG_ADMIN)
--   C. Blank name rejected (ORG_NAME_REQUIRED)
--   D. Invalid organization_type rejected (INVALID_ORG_TYPE)
--   E. status untouched by a successful settings update
--
-- Fixtures use UUID prefix 'ce'. Wrapped in begin/rollback.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(5);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at) values
  ('ce000000-0000-0000-0000-000000000001', 'test-settings-admin@test.com',    now(), now()),
  ('ce000000-0000-0000-0000-000000000002', 'test-settings-resident@test.com', now(), now());

insert into public.organizations (id, name, display_name, organization_type, status) values
  ('ce000000-0000-0000-0000-000000000010', 'test-settings-org', 'Test Settings Org',
   'residential', 'provisioning');

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'ce000000-0000-0000-0000-000000000010', a.id, 'admin', 'active', now()
from public.accounts a
where a.auth_user_id = 'ce000000-0000-0000-0000-000000000001';

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'ce000000-0000-0000-0000-000000000010', a.id, 'primary_resident', 'active', now()
from public.accounts a
where a.auth_user_id = 'ce000000-0000-0000-0000-000000000002';

-- ============================================================================
-- A. Org admin can update — values land
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"ce000000-0000-0000-0000-000000000001"}', true);

select public.update_organization_settings(
  'ce000000-0000-0000-0000-000000000010'::uuid,
  'Renamed Org',
  'workplace'
);

select is(
  (select name || '|' || display_name || '|' || organization_type
     from public.organizations
    where id = 'ce000000-0000-0000-0000-000000000010'),
  'Renamed Org|Renamed Org|workplace',
  'A: name, display_name, organization_type updated'
);

-- ============================================================================
-- E. status untouched by the settings update
-- ============================================================================

select is(
  (select status
     from public.organizations
    where id = 'ce000000-0000-0000-0000-000000000010'),
  'provisioning',
  'E: status untouched by settings update'
);

-- ============================================================================
-- B. Non-admin caller rejected
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"ce000000-0000-0000-0000-000000000002"}', true);

select throws_ok(
  $$select public.update_organization_settings(
      'ce000000-0000-0000-0000-000000000010'::uuid,
      'Another Name',
      'workplace')$$,
  'P0001',
  'NOT_ORG_ADMIN',
  'B: non-admin caller rejected'
);

-- ============================================================================
-- C. Blank name rejected
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"ce000000-0000-0000-0000-000000000001"}', true);

select throws_ok(
  $$select public.update_organization_settings(
      'ce000000-0000-0000-0000-000000000010'::uuid,
      '   ',
      'workplace')$$,
  'P0001',
  'ORG_NAME_REQUIRED',
  'C: blank name rejected'
);

-- ============================================================================
-- D. Invalid organization_type rejected
-- ============================================================================

select throws_ok(
  $$select public.update_organization_settings(
      'ce000000-0000-0000-0000-000000000010'::uuid,
      'Valid Name',
      'invalid')$$,
  'P0001',
  'INVALID_ORG_TYPE',
  'D: invalid organization_type rejected'
);

select * from finish();

rollback;
