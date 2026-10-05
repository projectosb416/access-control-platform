-- ============================================================================
-- Test: refund_payment (migration 0064)
-- ============================================================================
-- Eight assertions covering happy paths, accumulation, all four error
-- branches, and audit emission.
--
-- Fixtures use UUID prefix 'ee'. Wrapped in begin/rollback.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(8);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at) values
  ('ee000000-0000-0000-0000-000000000001', 'test-refund-admin@test.com',   now(), now()),
  ('ee000000-0000-0000-0000-000000000002', 'test-refund-regular@test.com', now(), now());

insert into public.organizations (id, name, display_name, organization_type, status)
values ('ee000000-0000-0000-0000-000000000010', 'test-refund-org', 'Test Refund',
        'residential', 'active');

-- Platform admin grant for the first account.
insert into public.platform_admins (account_id, notes)
select a.id, 'test fixture'
from public.accounts a where a.auth_user_id = 'ee000000-0000-0000-0000-000000000001';

-- Plan (needed as FK from payment_transactions.plan_id).
insert into public.plans (id, code, name, currency, price_minor_units, billing_cycle_months, status)
values ('ee000000-0000-0000-0000-000000000020', 'test-refund-plan', 'Test Refund Plan',
        'NGN', 100000, 12, 'active');

-- Four payments.
-- P1: succeeded, 100000, no prior refunds.
insert into public.payment_transactions (
  id, organization_id, plan_id, purpose, source, provider, provider_reference,
  amount_minor_units, currency, status, confirmed_at, confirmed_by
) values (
  'ee000000-0000-0000-0000-0000000000a1',
  'ee000000-0000-0000-0000-000000000010',
  'ee000000-0000-0000-0000-000000000020',
  'initial', 'manual', 'bank_transfer', 'TEST-REFUND-A1',
  100000, 'NGN', 'succeeded', now(),
  (select id from public.accounts where auth_user_id = 'ee000000-0000-0000-0000-000000000001')
);

-- P2: succeeded, 100000, used for partial then accumulation.
insert into public.payment_transactions (
  id, organization_id, plan_id, purpose, source, provider, provider_reference,
  amount_minor_units, currency, status, confirmed_at, confirmed_by
) values (
  'ee000000-0000-0000-0000-0000000000a2',
  'ee000000-0000-0000-0000-000000000010',
  'ee000000-0000-0000-0000-000000000020',
  'initial', 'manual', 'bank_transfer', 'TEST-REFUND-A2',
  100000, 'NGN', 'succeeded', now(),
  (select id from public.accounts where auth_user_id = 'ee000000-0000-0000-0000-000000000001')
);

-- P3: succeeded, 100000. Will receive a setup partial (unasserted)
-- then an over-limit refund attempt.
insert into public.payment_transactions (
  id, organization_id, plan_id, purpose, source, provider, provider_reference,
  amount_minor_units, currency, status, confirmed_at, confirmed_by
) values (
  'ee000000-0000-0000-0000-0000000000a3',
  'ee000000-0000-0000-0000-000000000010',
  'ee000000-0000-0000-0000-000000000020',
  'initial', 'manual', 'bank_transfer', 'TEST-REFUND-A3',
  100000, 'NGN', 'succeeded', now(),
  (select id from public.accounts where auth_user_id = 'ee000000-0000-0000-0000-000000000001')
);

-- P4: pending_confirmation, not refundable.
insert into public.payment_transactions (
  id, organization_id, plan_id, purpose, source, provider, provider_reference,
  amount_minor_units, currency, status
) values (
  'ee000000-0000-0000-0000-0000000000a4',
  'ee000000-0000-0000-0000-000000000010',
  'ee000000-0000-0000-0000-000000000020',
  'initial', 'manual', 'bank_transfer', 'TEST-REFUND-A4',
  100000, 'NGN', 'pending_confirmation'
);

-- ============================================================================
-- Authenticate as platform admin
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"ee000000-0000-0000-0000-000000000001"}', true);

-- Setup: give P3 a partial refund of 60000, so we can test the
-- exceeds-remaining branch below. Not asserted — the assertion for it
-- appears at the exceeds-remaining check.
select public.refund_payment(
  'ee000000-0000-0000-0000-0000000000a3'::uuid,
  60000::bigint,
  'setup partial'::text
);

-- ============================================================================
-- Assertions
-- ============================================================================

-- A. Full refund on P1 → status flips, refunded_amount set.
select public.refund_payment(
  'ee000000-0000-0000-0000-0000000000a1'::uuid,
  100000::bigint,
  'customer requested refund'::text
);

select is(
  (select (status, refunded_amount_minor_units)::text
     from public.payment_transactions
    where id = 'ee000000-0000-0000-0000-0000000000a1'::uuid),
  '(refunded,100000)',
  'A: full refund flips status to refunded and records amount'
);

-- B. Partial refund on P2 (60000 of 100000) → partially_refunded.
select public.refund_payment(
  'ee000000-0000-0000-0000-0000000000a2'::uuid,
  60000::bigint,
  'first partial'::text
);

select is(
  (select (status, refunded_amount_minor_units)::text
     from public.payment_transactions
    where id = 'ee000000-0000-0000-0000-0000000000a2'::uuid),
  '(partially_refunded,60000)',
  'B: partial refund sets partially_refunded with correct amount'
);

-- C. Accumulation — second partial on P2 (40000) brings total to 100000.
select public.refund_payment(
  'ee000000-0000-0000-0000-0000000000a2'::uuid,
  40000::bigint,
  'second partial completes'::text
);

select is(
  (select (status, refunded_amount_minor_units)::text
     from public.payment_transactions
    where id = 'ee000000-0000-0000-0000-0000000000a2'::uuid),
  '(refunded,100000)',
  'C: accumulated partials flip status to refunded at exactly the original amount'
);

-- D. Exceeds remaining — P3 already has 60000 refunded, attempt 60000 more.
select throws_ok(
  $$select public.refund_payment(
      'ee000000-0000-0000-0000-0000000000a3'::uuid,
      60000::bigint,
      'exceeds'::text)$$,
  'P0001',
  'REFUND_EXCEEDS_REMAINING',
  'D: over-limit refund rejected'
);

-- E. Not refundable — P4 is pending_confirmation.
select throws_ok(
  $$select public.refund_payment(
      'ee000000-0000-0000-0000-0000000000a4'::uuid,
      10000::bigint,
      'wrong status'::text)$$,
  'P0001',
  'PAYMENT_NOT_REFUNDABLE',
  'E: pending_confirmation payment not refundable'
);

-- F. Blank reason → REASON_REQUIRED.
select throws_ok(
  $$select public.refund_payment(
      'ee000000-0000-0000-0000-0000000000a2'::uuid,
      10000::bigint,
      ''::text)$$,
  'P0001',
  'REASON_REQUIRED',
  'F: blank reason rejected'
);

-- G. Non-platform-admin → NOT_PLATFORM_ADMIN.
select set_config('request.jwt.claims',
  '{"sub":"ee000000-0000-0000-0000-000000000002"}', true);

select throws_ok(
  $$select public.refund_payment(
      'ee000000-0000-0000-0000-0000000000a2'::uuid,
      10000::bigint,
      'non-admin attempt'::text)$$,
  'P0001',
  'NOT_PLATFORM_ADMIN',
  'G: non-platform-admin caller rejected'
);

-- H. Audit emission — one payment.refunded event for P1.
select is(
  (select count(*)::int from public.audit_events
    where action    = 'payment.refunded'
      and target_id = 'ee000000-0000-0000-0000-0000000000a1'::uuid),
  1,
  'H: audit event written for the first refund'
);

select * from finish();

rollback;
