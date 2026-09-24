-- ============================================================================
-- Test: run_subscription_expiry_check
-- ============================================================================
-- Covers migration 0033: reminder threshold windows, expiry transition,
-- notifications, audit events, and idempotency.
--
-- Determinism: now() is frozen inside the pgTAP transaction, so each
-- subscription's days-remaining value is stable. Three subscriptions are
-- set up at 25 days, 14 days, and 1 day past expiry. One call to the
-- function exercises both phases.
--
-- Wrapped in begin/rollback. Fixtures use UUIDs prefixed 'b7'.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(11);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at) values
  ('b7000000-0000-0000-0000-000000000001', 'test-exp-a@test.com', now(), now()),
  ('b7000000-0000-0000-0000-000000000002', 'test-exp-b@test.com', now(), now()),
  ('b7000000-0000-0000-0000-000000000003', 'test-exp-c@test.com', now(), now());

insert into public.organizations (id, name, display_name, organization_type, status) values
  ('b7000000-0000-0000-0000-000000000010', 'test-exp-a', 'Exp A', 'residential', 'active'),
  ('b7000000-0000-0000-0000-000000000011', 'test-exp-b', 'Exp B', 'residential', 'active'),
  ('b7000000-0000-0000-0000-000000000012', 'test-exp-c', 'Exp C', 'residential', 'active');

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'b7000000-0000-0000-0000-000000000010', a.id, 'admin', 'active', now()
from public.accounts a where a.auth_user_id = 'b7000000-0000-0000-0000-000000000001';

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'b7000000-0000-0000-0000-000000000011', a.id, 'admin', 'active', now()
from public.accounts a where a.auth_user_id = 'b7000000-0000-0000-0000-000000000002';

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'b7000000-0000-0000-0000-000000000012', a.id, 'admin', 'active', now()
from public.accounts a where a.auth_user_id = 'b7000000-0000-0000-0000-000000000003';

insert into public.plans (id, code, name, currency, price_minor_units, billing_cycle_months, status)
values ('b7000000-0000-0000-0000-000000000020', 'test-exp-plan', 'Test Exp Plan',
        'NGN', 100000, 12, 'active');

-- Subscription A: 25 days remaining → should fire threshold 30
insert into public.subscriptions (id, organization_id, plan_id, status,
                                   current_period_start, current_period_end)
values ('b7000000-0000-0000-0000-000000000030',
        'b7000000-0000-0000-0000-000000000010',
        'b7000000-0000-0000-0000-000000000020',
        'active',
        now() - interval '340 days',
        now() + interval '25 days');

-- Subscription B: 14 days remaining → should fire threshold 16
insert into public.subscriptions (id, organization_id, plan_id, status,
                                   current_period_start, current_period_end)
values ('b7000000-0000-0000-0000-000000000031',
        'b7000000-0000-0000-0000-000000000011',
        'b7000000-0000-0000-0000-000000000020',
        'active',
        now() - interval '351 days',
        now() + interval '14 days');

-- Subscription C: expired 1 day ago → should transition to 'expired'
insert into public.subscriptions (id, organization_id, plan_id, status,
                                   current_period_start, current_period_end)
values ('b7000000-0000-0000-0000-000000000032',
        'b7000000-0000-0000-0000-000000000012',
        'b7000000-0000-0000-0000-000000000020',
        'active',
        now() - interval '366 days',
        now() - interval '1 day');

-- ============================================================================
-- Run 1
-- ============================================================================
select is(
  (select (reminders_sent, subscriptions_expired)::text
    from public.run_subscription_expiry_check()),
  '(2,1)',
  'run 1 sends 2 reminders and expires 1 subscription'
);

-- ============================================================================
-- Assertion 2: subscription A fires threshold 30 (window (23, 30])
-- ============================================================================
select is(
  (select reminder_days_before from public.subscription_reminders
    where subscription_id = 'b7000000-0000-0000-0000-000000000030'),
  30,
  'subscription 25 days out fires threshold 30'
);

-- ============================================================================
-- Assertion 3: subscription B fires threshold 16 (window (9, 16])
-- ============================================================================
select is(
  (select reminder_days_before from public.subscription_reminders
    where subscription_id = 'b7000000-0000-0000-0000-000000000031'),
  16,
  'subscription 14 days out fires threshold 16'
);

-- ============================================================================
-- Assertion 4: subscription C status flipped to expired
-- ============================================================================
select is(
  (select status from public.subscriptions
    where id = 'b7000000-0000-0000-0000-000000000032'),
  'expired',
  'past-expiry subscription moved to expired'
);

-- ============================================================================
-- Assertion 5: audit event written for the expiry
-- ============================================================================
select is(
  (select count(*)::int from public.audit_events
    where target_id = 'b7000000-0000-0000-0000-000000000032'
      and action = 'subscription.expired'),
  1,
  'audit event written on subscription expiry'
);

-- ============================================================================
-- Assertion 6: audit event has no actor (system-triggered)
-- ============================================================================
select is(
  (select actor_account_id from public.audit_events
    where target_id = 'b7000000-0000-0000-0000-000000000032'
      and action = 'subscription.expired'),
  null::uuid,
  'audit event has null actor (system-triggered)'
);

-- ============================================================================
-- Assertion 7: notification written for subscription C's admin
-- ============================================================================
select is(
  (select count(*)::int from public.notifications n
    join public.organization_memberships m
      on m.account_id = n.recipient_account_id
   where n.organization_id = 'b7000000-0000-0000-0000-000000000012'
     and n.category = 'billing'
     and n.priority = 'high'
     and m.role = 'admin'),
  1,
  'expired subscription produces one high-priority notification per admin'
);

-- ============================================================================
-- Assertion 8: subscription A's admin got a reminder notification
-- ============================================================================
select is(
  (select count(*)::int from public.notifications
    where organization_id = 'b7000000-0000-0000-0000-000000000010'
      and category = 'billing'),
  1,
  'reminder notification written for subscription A'
);

-- ============================================================================
-- Run 2 — idempotency
-- ============================================================================
select is(
  (select (reminders_sent, subscriptions_expired)::text
    from public.run_subscription_expiry_check()),
  '(0,0)',
  'run 2 is fully idempotent — no reminders, no expiries'
);

-- ============================================================================
-- Assertion 10: still exactly two reminder rows (no duplicates from run 2)
-- ============================================================================
select is(
  (select count(*)::int from public.subscription_reminders),
  2,
  'no duplicate reminder rows after second run'
);

-- ============================================================================
-- Assertion 11: subscription A did not advance to a later threshold
-- ============================================================================
select is(
  (select count(*)::int from public.subscription_reminders
    where subscription_id = 'b7000000-0000-0000-0000-000000000030'),
  1,
  'subscription A still has exactly one reminder (threshold 30, no advance)'
);

select * from finish();

rollback;
