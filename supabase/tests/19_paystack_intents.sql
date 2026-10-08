-- ============================================================================
-- Test: Paystack payment intent + confirm (migration 0070)
-- ============================================================================
-- Six assertions covering the two-function Shape B flow:
--   A. record_paystack_payment_intent creates a row with
--      source='webhook', provider='paystack', status='initiated'
--   B. confirm_paystack_payment on 'succeeded' flips status and creates
--      a subscription (via create_subscription_from_payment)
--   B2. confirm returned a subscription id
--   C. confirm on an already-succeeded row is idempotent — same sub id
--   D. confirm on unknown reference raises PAYMENT_NOT_FOUND
--   E. generate_paystack_reference format is PSK-XXXXXX
--
-- Fixtures use UUID prefix 'c9'. Wrapped in begin/rollback.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(6);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at) values
  ('c9000000-0000-0000-0000-000000000001', 'test-psk-admin@test.com', now(), now());

insert into public.organizations (id, name, display_name, organization_type, status)
values ('c9000000-0000-0000-0000-000000000010', 'test-psk-org', 'Test Paystack',
        'residential', 'provisioning');

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'c9000000-0000-0000-0000-000000000010', a.id, 'admin', 'active', now()
from public.accounts a where a.auth_user_id = 'c9000000-0000-0000-0000-000000000001';

insert into public.plans (id, code, name, currency, price_minor_units, billing_cycle_months, status)
values ('c9000000-0000-0000-0000-000000000020', 'test-psk-plan', 'Test Paystack Plan',
        'NGN', 100000, 12, 'active');

-- ============================================================================
-- Authenticate as org admin
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"c9000000-0000-0000-0000-000000000001"}', true);

-- ============================================================================
-- A. Record intent creates a row with correct shape
-- ============================================================================

select set_config('test.psk_ref',
  (select reference from public.record_paystack_payment_intent(
    'c9000000-0000-0000-0000-000000000010'::uuid,
    'c9000000-0000-0000-0000-000000000020'::uuid,
    'initial'::text
  )),
  true
);

select is(
  (select (source, provider, status)::text
     from public.payment_transactions
    where provider_reference = current_setting('test.psk_ref')),
  '(webhook,paystack,initiated)',
  'A: intent row created with source=webhook, provider=paystack, status=initiated'
);

-- ============================================================================
-- B. Confirm on succeeded flips status + creates subscription
-- ============================================================================

select set_config('test.psk_sub',
  (select confirm_paystack_payment(
    current_setting('test.psk_ref'),
    'succeeded',
    '{"test":true}'::jsonb
  )::text),
  true
);

select is(
  (select status from public.payment_transactions
    where provider_reference = current_setting('test.psk_ref')),
  'succeeded',
  'B: payment flipped to succeeded after confirm'
);

select ok(
  length(coalesce(current_setting('test.psk_sub', true), '')) > 0,
  'B2: confirm returned a subscription id'
);

-- ============================================================================
-- C. Idempotent re-confirm returns the same subscription id
-- ============================================================================

select is(
  (select confirm_paystack_payment(
    current_setting('test.psk_ref'),
    'succeeded',
    '{}'::jsonb
  )::text),
  current_setting('test.psk_sub'),
  'C: re-confirm returns the same subscription id'
);

-- ============================================================================
-- D. Unknown reference raises PAYMENT_NOT_FOUND
-- ============================================================================

select throws_ok(
  $$select public.confirm_paystack_payment(
      'PSK-NOPE99', 'succeeded', '{}'::jsonb)$$,
  'P0001',
  'PAYMENT_NOT_FOUND',
  'D: unknown reference rejected'
);

-- ============================================================================
-- E. generate_paystack_reference format is PSK-XXXXXX
-- ============================================================================

select matches(
  public.generate_paystack_reference(),
  '^PSK-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$',
  'E: reference format is PSK-XXXXXX'
);

select * from finish();

rollback;
