-- ============================================================================
-- Test: record_manual_payment_intent with p_destination_id (migration 0067)
-- ============================================================================
-- Three assertions covering the extended function's new parameter:
--   A. Valid destination id → stored on the payment row
--   B. Omitted destination → null on the payment row (default behavior)
--   C. Unknown destination id → DESTINATION_NOT_FOUND
--
-- Fixtures use UUID prefix 'a7'. Wrapped in begin/rollback.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(3);

-- ============================================================================
-- Fixtures
-- ============================================================================

insert into auth.users (id, email, created_at, updated_at) values
  ('a7000000-0000-0000-0000-000000000001', 'test-intent-admin@test.com', now(), now());

insert into public.organizations (id, name, display_name, organization_type, status)
values ('a7000000-0000-0000-0000-000000000010', 'test-intent-org', 'Test Intent',
        'residential', 'active');

insert into public.organization_memberships (organization_id, account_id, role, status, joined_at)
select 'a7000000-0000-0000-0000-000000000010', a.id, 'admin', 'active', now()
from public.accounts a where a.auth_user_id = 'a7000000-0000-0000-0000-000000000001';

insert into public.plans (id, code, name, currency, price_minor_units, billing_cycle_months, status)
values ('a7000000-0000-0000-0000-000000000020', 'test-intent-plan', 'Test Intent Plan',
        'NGN', 100000, 12, 'active');

insert into public.payment_destinations (
  id, label, business_name, bank_account_name, bank_name,
  bank_account_number, is_active
) values (
  'a7000000-0000-0000-0000-000000000030',
  'Test Destination', 'Test Trading', 'Test Holder', 'Test Bank',
  '0123456789', true
);

-- ============================================================================
-- Authenticate as org admin
-- ============================================================================

select set_config('request.jwt.claims',
  '{"sub":"a7000000-0000-0000-0000-000000000001"}', true);

-- ============================================================================
-- A. Valid destination id → stored on the payment row
-- ============================================================================

select set_config('test.intent_payment_a',
  (select payment_id::text from public.record_manual_payment_intent(
    'a7000000-0000-0000-0000-000000000010'::uuid,
    'a7000000-0000-0000-0000-000000000020'::uuid,
    'initial'::text,
    'a7000000-0000-0000-0000-000000000030'::uuid
  )),
  true
);

select is(
  (select payment_destination_id
     from public.payment_transactions
    where id = current_setting('test.intent_payment_a')::uuid),
  'a7000000-0000-0000-0000-000000000030'::uuid,
  'A: destination id stored on the payment row'
);

-- ============================================================================
-- B. Omitted destination → null on the payment row
-- ============================================================================

select set_config('test.intent_payment_b',
  (select payment_id::text from public.record_manual_payment_intent(
    'a7000000-0000-0000-0000-000000000010'::uuid,
    'a7000000-0000-0000-0000-000000000020'::uuid,
    'initial'::text
  )),
  true
);

select is(
  (select payment_destination_id
     from public.payment_transactions
    where id = current_setting('test.intent_payment_b')::uuid),
  null::uuid,
  'B: omitted destination leaves FK null'
);

-- ============================================================================
-- C. Unknown destination id → DESTINATION_NOT_FOUND
-- ============================================================================

select throws_ok(
  $$select * from public.record_manual_payment_intent(
      'a7000000-0000-0000-0000-000000000010'::uuid,
      'a7000000-0000-0000-0000-000000000020'::uuid,
      'initial'::text,
      'a7000000-0000-0000-0000-000000000999'::uuid)$$,
  'P0001',
  'DESTINATION_NOT_FOUND',
  'C: unknown destination rejected'
);

select * from finish();

rollback;
