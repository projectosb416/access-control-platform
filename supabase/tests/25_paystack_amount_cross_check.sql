-- ============================================================================
-- Test: confirm_paystack_payment amount/currency cross-check (migration 0078)
-- ============================================================================
-- Five assertions covering the payload cross-check added in 0078:
--   A. Payload missing `amount` -> PAYMENT_PAYLOAD_INCOMPLETE
--   B. Payload missing `currency` -> PAYMENT_PAYLOAD_INCOMPLETE
--   C. Payload amount != intent amount -> PAYMENT_AMOUNT_MISMATCH
--   D. Payload currency != intent currency -> PAYMENT_CURRENCY_MISMATCH
--   E. Matching payload succeeds and returns a subscription id
--
-- Fixtures use UUID prefix 'cg'. Wrapped in begin/rollback.
--
-- Note on fixture reuse: A, B, C, D all raise before the UPDATE — the
-- intent row stays 'initiated' after each. E runs against the same row
-- and is the only one that transitions it to 'succeeded'.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(5);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at) values
  ('d0000000-0000-0000-0000-000000000001', 'test-pskx-admin@test.com', now(), now());

insert into public.organizations (id, name, display_name, organization_type, status)
values ('d0000000-0000-0000-0000-000000000010', 'test-pskx-org', 'Test Paystack Cross',
        'residential', 'provisioning');

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'd0000000-0000-0000-0000-000000000010', a.id, 'admin', 'active', now()
from public.accounts a where a.auth_user_id = 'd0000000-0000-0000-0000-000000000001';

insert into public.plans (id, code, name, currency, price_minor_units, billing_cycle_months, status)
values ('d0000000-0000-0000-0000-000000000020', 'test-pskx-plan', 'Test Paystack Cross Plan',
        'NGN', 100000, 12, 'active');

-- ============================================================================
-- Authenticate as org admin
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-000000000001"}', true);

-- ============================================================================
-- Intent — one row, tested four times (all four error paths abort before
-- the UPDATE, so the row's status remains 'initiated' between assertions)
-- ============================================================================

select set_config('test.pskx_ref',
  (select reference from public.record_paystack_payment_intent(
    'd0000000-0000-0000-0000-000000000010'::uuid,
    'd0000000-0000-0000-0000-000000000020'::uuid,
    'initial'::text
  )),
  true
);

-- ============================================================================
-- A. Missing amount -> PAYMENT_PAYLOAD_INCOMPLETE
-- ============================================================================

select throws_ok(
  $$select public.confirm_paystack_payment(
      current_setting('test.pskx_ref'),
      'succeeded',
      '{"currency":"NGN"}'::jsonb)$$,
  'P0001',
  'PAYMENT_PAYLOAD_INCOMPLETE',
  'A: missing amount rejected'
);

-- ============================================================================
-- B. Missing currency -> PAYMENT_PAYLOAD_INCOMPLETE
-- ============================================================================

select throws_ok(
  $$select public.confirm_paystack_payment(
      current_setting('test.pskx_ref'),
      'succeeded',
      '{"amount":100000}'::jsonb)$$,
  'P0001',
  'PAYMENT_PAYLOAD_INCOMPLETE',
  'B: missing currency rejected'
);

-- ============================================================================
-- C. Amount mismatch -> PAYMENT_AMOUNT_MISMATCH
-- ============================================================================

select throws_ok(
  $$select public.confirm_paystack_payment(
      current_setting('test.pskx_ref'),
      'succeeded',
      '{"amount":999999,"currency":"NGN"}'::jsonb)$$,
  'P0001',
  'PAYMENT_AMOUNT_MISMATCH',
  'C: amount mismatch rejected'
);

-- ============================================================================
-- D. Currency mismatch -> PAYMENT_CURRENCY_MISMATCH
-- ============================================================================

select throws_ok(
  $$select public.confirm_paystack_payment(
      current_setting('test.pskx_ref'),
      'succeeded',
      '{"amount":100000,"currency":"USD"}'::jsonb)$$,
  'P0001',
  'PAYMENT_CURRENCY_MISMATCH',
  'D: currency mismatch rejected'
);

-- ============================================================================
-- E. Matching payload succeeds (control)
-- ============================================================================

select is(
  (select confirm_paystack_payment(
    current_setting('test.pskx_ref'),
    'succeeded',
    '{"amount":100000,"currency":"NGN"}'::jsonb
  ) is not null),
  true,
  'E: matching payload returns a subscription id'
);

select * from finish();

rollback;
