-- ============================================================================
-- Test: platform_org_team (migration 0071)
-- ============================================================================
-- Five assertions covering the platform team reader:
--   A. Platform admin sees both members of the org
--   B. Email is populated from auth.users via the join
--   C. Role and account_status are correct for each member
--   D. Non-platform-admin is rejected with NOT_PLATFORM_ADMIN
--   E. Unknown org id returns zero rows (not an error)
--
-- Fixtures use UUID prefix 'ca'. Wrapped in begin/rollback.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(5);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at) values
  ('ca000000-0000-0000-0000-000000000001', 'test-team-platform@test.com', now(), now()),
  ('ca000000-0000-0000-0000-000000000002', 'test-team-orgadmin@test.com', now(), now()),
  ('ca000000-0000-0000-0000-000000000003', 'test-team-resident@test.com', now(), now()),
  ('ca000000-0000-0000-0000-000000000004', 'test-team-regular@test.com',  now(), now());

-- Platform admin grant for the first user
insert into public.platform_admins (account_id, notes)
select a.id, 'test fixture'
from public.accounts a where a.auth_user_id = 'ca000000-0000-0000-0000-000000000001';

-- Org
insert into public.organizations (id, name, display_name, organization_type, status)
values ('ca000000-0000-0000-0000-000000000010', 'test-team-org', 'Test Team Org',
        'residential', 'active');

-- Two memberships: one admin, one primary_resident
insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'ca000000-0000-0000-0000-000000000010', a.id, 'admin', 'active', now()
from public.accounts a where a.auth_user_id = 'ca000000-0000-0000-0000-000000000002';

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'ca000000-0000-0000-0000-000000000010', a.id, 'primary_resident', 'active', now()
from public.accounts a where a.auth_user_id = 'ca000000-0000-0000-0000-000000000003';

-- Set terms_accepted_at on the org admin for assertion C
update public.accounts
   set terms_accepted_at = now()
 where auth_user_id = 'ca000000-0000-0000-0000-000000000002';

-- ============================================================================
-- A. Platform admin sees both members
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-0000-0000-000000000001"}', true);

select is(
  (select count(*)::int from public.platform_org_team(
    'ca000000-0000-0000-0000-000000000010'::uuid)),
  2,
  'A: platform admin sees both members of the org'
);

-- ============================================================================
-- B. Email populated from auth.users
-- ============================================================================

select is(
  (select f.email from public.platform_org_team(
    'ca000000-0000-0000-0000-000000000010'::uuid) as f
   where f.role = 'admin'),
  'test-team-orgadmin@test.com',
  'B: email populated from auth.users for the admin member'
);

-- ============================================================================
-- C. Role, account_status, and terms_accepted_at correct per member
-- ============================================================================

select is(
  (select (f.role, f.account_status, f.terms_accepted_at is not null)::text
     from public.platform_org_team(
       'ca000000-0000-0000-0000-000000000010'::uuid) as f
    where f.role = 'admin'),
  '(admin,pending_activation,t)',
  'C: admin row shows role=admin, account_status=pending_activation, ToS accepted'
);

-- ============================================================================
-- D. Non-platform-admin is rejected
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-0000-0000-000000000004"}', true);

select throws_ok(
  $$select * from public.platform_org_team(
      'ca000000-0000-0000-0000-000000000010'::uuid)$$,
  'P0001',
  'NOT_PLATFORM_ADMIN',
  'D: non-platform-admin caller rejected'
);

-- ============================================================================
-- E. Unknown org returns zero rows (back as platform admin)
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-0000-0000-000000000001"}', true);

select is(
  (select count(*)::int from public.platform_org_team(
    'ca000000-0000-0000-0000-000000000999'::uuid)),
  0,
  'E: unknown org id returns zero rows'
);

select * from finish();

rollback;
