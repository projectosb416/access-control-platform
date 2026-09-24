-- ============================================================================
-- Test: create_subscription_from_payment
-- ============================================================================
-- Covers the money-to-state transition: initial subscription creation,
-- org activation, idempotent replay, and the renewal/supersede path that
-- migration 0026 fixed (self-referential FK ordering).
--
-- Wrapped in begin/rollback. Fixtures use UUIDs prefixed 'b6'.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(10);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at)
values ('b6000000-0000-0000-0000-000000000001', 'test-sub-admin@test.com', now(), now());

-- Org in PROVISIONING state — should flip to active on first payment.
insert into public.organizations (id, name, display_name, organization_type, status)
values ('b6000000-0000-0000-0000-000000000010', 'test-sub-org', 'Test Sub',
        'residential', 'provisioning');

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'b6000000-0000-0000-0000-000000000010', a.id, 'admin', 'active', now()
from public.accounts a where a.auth_user_id = 'b6000000-0000-0000-0000-000000000001';

insert into public.plans (id, code, name, currency, price_minor_units, billing_cycle_months, status)
values ('b6000000-0000-0000-0000-000000000020', 'test-sub-plan', 'Test Sub Plan',
        'NGN', 5000000, 12, 'active');

-- Payment 1: succeeded, with plan_id
insert into public.payment_transactions (
  id, organization_id, plan_id, purpose, source, provider, provider_reference,
  amount_minor_units, currency, status
) values (
  'b6000000-0000-0000-0000-000000000030',
  'b6000000-0000-0000-0000-000000000010',
  'b6000000-0000-0000-0000-000000000020',
  'initial', 'webhook', 'paystack', 'TEST-PSK-001',
  5000000, 'NGN', 'succeeded'
);

-- ============================================================================
-- Assertion 1: function creates a subscription and returns its id
-- ============================================================================
select isnt(
  (select public.create_subscription_from_payment('b6000000-0000-0000-0000-000000000030')),
  null,
  'create_subscription_from_payment returns a non-null subscription id'
);

-- ============================================================================
-- Assertion 2: subscription exists, active, and belongs to the org
-- ============================================================================
select is(
  (select count(*)::int from public.subscriptions
    where organization_id = 'b6000000-0000-0000-0000-000000000010'
      and status = 'active'),
  1,
  'exactly one active subscription created'
);

-- ============================================================================
-- Assertion 3: org flipped from provisioning to active
-- ============================================================================
select is(
  (select status from public.organizations
    where id = 'b6000000-0000-0000-0000-000000000010'),
  'active',
  'org status flipped from provisioning to active'
);

-- ============================================================================
-- Assertion 4: payment linked to the new subscription
-- ============================================================================
select isnt(
  (select subscription_id from public.payment_transactions
    where id = 'b6000000-0000-0000-0000-000000000030'),
  null,
  'payment now references its subscription'
);

-- ============================================================================
-- Assertion 5: idempotent replay returns the SAME subscription
-- ============================================================================
select is(
  (select public.create_subscription_from_payment('b6000000-0000-0000-0000-000000000030')),
  (select subscription_id from public.payment_transactions
    where id = 'b6000000-0000-0000-0000-000000000030'),
  'idempotent replay returns the original subscription'
);

-- ============================================================================
-- Assertion 6: replay did not create a second subscription
-- ============================================================================
select is(
  (select count(*)::int from public.subscriptions
    where organization_id = 'b6000000-0000-0000-0000-000000000010'),
  1,
  'replay did not create a second subscription'
);

-- ============================================================================
-- RENEWAL SCENARIO — the path migration 0026 fixed
-- ============================================================================
-- Insert a second succeeded payment for the same org.
insert into public.payment_transactions (
  id, organization_id, plan_id, purpose, source, provider, provider_reference,
  amount_minor_units, currency, status
) values (
  'b6000000-0000-0000-0000-000000000031',
  'b6000000-0000-0000-0000-000000000010',
  'b6000000-0000-0000-0000-000000000020',
  'renewal', 'webhook', 'paystack', 'TEST-PSK-002',
  5000000, 'NGN', 'succeeded'
);

-- ============================================================================
-- Assertion 7: renewal succeeds and creates a new subscription
-- ============================================================================
select isnt(
  (select public.create_subscription_from_payment('b6000000-0000-0000-0000-000000000031')),
  null,
  'renewal creates a new subscription without error'
);

-- ============================================================================
-- Assertion 8: exactly one active, one superseded
-- ============================================================================
select is(
  (select (count(*) filter (where status = 'active'),
           count(*) filter (where status = 'superseded'))::text
    from public.subscriptions
    where organization_id = 'b6000000-0000-0000-0000-000000000010'),
  '(1,1)',
  'exactly one active and one superseded subscription after renewal'
);

-- ============================================================================
-- Assertion 9: superseded_by points to the new active subscription
-- ============================================================================
select is(
  (select superseded_by from public.subscriptions
    where organization_id = 'b6000000-0000-0000-0000-000000000010'
      and status = 'superseded'),
  (select id from public.subscriptions
    where organization_id = 'b6000000-0000-0000-0000-000000000010'
      and status = 'active'),
  'superseded_by points at the new active subscription'
);

-- ============================================================================
-- Assertion 10: new subscription period starts at the old period end
-- ============================================================================
select is(
  (select new_sub.current_period_start = old_sub.current_period_end
    from public.subscriptions new_sub
    cross join public.subscriptions old_sub
    where new_sub.organization_id = 'b6000000-0000-0000-0000-000000000010'
      and new_sub.status = 'active'
      and old_sub.organization_id = 'b6000000-0000-0000-0000-000000000010'
      and old_sub.status = 'superseded'),
  true,
  'renewal period starts at the previous period end (no gap, no overlap)'
);

select * from finish();

rollback;
