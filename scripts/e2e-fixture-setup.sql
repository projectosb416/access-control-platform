-- ============================================================================
-- E2E fixture setup
-- ============================================================================
-- Creates a fresh e2e test tenant for the guard ENTRY regression test.
-- Run this manually in the Supabase SQL Editor on staging.
--
-- Steps after running this:
--   1. Generate the credential with scripts/gen-test-credential.mjs:
--        read -s -p "Pep: " PEPPER; echo; export PEPPER
--        node scripts/gen-test-credential.mjs 123456 e0000000-0000-0000-0000-000000000010
--        unset PEPPER
--   2. Insert the returned { phc, lookup_key } into access_credentials
--      against authorization e0000000-0000-0000-0000-000000000080.
--   3. Test against the deployed Worker.
--   4. When finished, run scripts/e2e-fixture-teardown.sql.
--
-- The fixture uses fixed UUIDs so tests can hardcode them. If you need to
-- recreate the fixture from scratch after teardown, first run:
--   update public.organizations set status = 'active' where id = '...';
-- ...or simply re-insert with the same UUIDs (the fixture is idempotent
-- only on a clean database — after teardown, statuses must be re-updated).
-- ============================================================================

-- Organization
insert into auth.users (id, email, created_at, updated_at) values
  ('e0000000-0000-0000-0000-000000000001', 'e2e-admin@test.com', now(), now());

insert into public.organizations (id, name, display_name, organization_type, status)
values ('e0000000-0000-0000-0000-000000000010', 'e2e-org', 'E2E Test Org',
        'residential', 'active');

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'e0000000-0000-0000-0000-000000000010', a.id, 'admin', 'active', now()
from public.accounts a where a.auth_user_id = 'e0000000-0000-0000-0000-000000000001';

-- Plan + subscription (active — required for is_org_operational)
insert into public.plans (id, code, name, currency, price_minor_units, billing_cycle_months, status)
values ('e0000000-0000-0000-0000-000000000020', 'e2e-plan', 'E2E Plan', 'NGN', 100000, 12, 'active');

insert into public.subscriptions (organization_id, plan_id, status, current_period_start, current_period_end)
values ('e0000000-0000-0000-0000-000000000010', 'e0000000-0000-0000-0000-000000000020',
        'active', now(), now() + interval '12 months');

-- Guard
insert into public.people (id, organization_id, full_name)
values ('e0000000-0000-0000-0000-000000000030', 'e0000000-0000-0000-0000-000000000010',
        'E2E Guard');

insert into public.guard_profiles (id, organization_id, person_id, guard_code, status)
values ('e0000000-0000-0000-0000-000000000040', 'e0000000-0000-0000-0000-000000000010',
        'e0000000-0000-0000-0000-000000000030', 'GU-E2E001', 'active');

-- Gate
insert into public.gates (id, organization_id, name, max_active_guards, status)
values ('e0000000-0000-0000-0000-000000000050', 'e0000000-0000-0000-0000-000000000010',
        'Gate E2E', 2, 'active');

-- Shift
insert into public.shifts (id, organization_id, gate_id, shift_code,
                            scheduled_start, scheduled_end, status)
values ('e0000000-0000-0000-0000-000000000060', 'e0000000-0000-0000-0000-000000000010',
        'e0000000-0000-0000-0000-000000000050', 'SH-E2E001',
        now() - interval '10 min', now() + interval '4 hours', 'scheduled');

-- Visitor
insert into public.people (id, organization_id, full_name)
values ('e0000000-0000-0000-0000-000000000070', 'e0000000-0000-0000-0000-000000000010',
        'E2E Visitor');

-- Authorization (no credential yet)
insert into public.authorizations (id, organization_id, person_id, access_type, purpose,
                                    authorization_type, valid_from, valid_until, status)
values ('e0000000-0000-0000-0000-000000000080', 'e0000000-0000-0000-0000-000000000010',
        'e0000000-0000-0000-0000-000000000070', 'visitor', 'e2e test visit',
        'one_time', now() - interval '1 hour', now() + interval '3 hours', 'active');

-- Verification
select
  (select count(*) from public.organizations where id = 'e0000000-0000-0000-0000-000000000010') as org,
  (select count(*) from public.subscriptions where organization_id = 'e0000000-0000-0000-0000-000000000010') as sub,
  (select count(*) from public.guard_profiles where id = 'e0000000-0000-0000-0000-000000000040') as guard,
  (select count(*) from public.gates where id = 'e0000000-0000-0000-0000-000000000050') as gate,
  (select count(*) from public.shifts where id = 'e0000000-0000-0000-0000-000000000060') as shift,
  (select count(*) from public.authorizations where id = 'e0000000-0000-0000-0000-000000000080') as authz;
