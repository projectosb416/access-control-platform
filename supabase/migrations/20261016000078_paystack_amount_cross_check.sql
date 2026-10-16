-- ============================================================================
-- Migration 0078: confirm_paystack_payment amount/currency cross-check
-- ============================================================================
-- Purpose:
--   confirm_paystack_payment() previously trusted the intent row's amount
--   and currency without comparing them to the provider payload. A
--   validly-signed Paystack event for a different amount than the intent
--   would be accepted silently. HMAC proves origin, not correctness.
--
--   This migration adds a strict cross-check:
--     * If p_provider_payload is missing `amount` or `currency` -> raise
--       PAYMENT_PAYLOAD_INCOMPLETE. Real Paystack charge.* payloads always
--       include both; an event that omits them is not trustworthy.
--     * If `amount` != v_payment.amount_minor_units -> raise
--       PAYMENT_AMOUNT_MISMATCH.
--     * If upper(`currency`) != v_payment.currency -> raise
--       PAYMENT_CURRENCY_MISMATCH. Case-normalized before compare.
--
--   The check runs BEFORE the terminal-state early-returns. That means:
--   a replayed webhook on an already-succeeded row returns the existing
--   subscription id without re-validating the payload — which is correct,
--   because the row's terminal state already encodes the decision. Only
--   the initiated -> succeeded transition is validated.
--
--   This is a behavior change. The previous function trusted
--   p_provider_payload to be well-formed. Any caller that sends a
--   payload missing `amount` or `currency` now receives
--   PAYMENT_PAYLOAD_INCOMPLETE. Test 19 is updated in this slice to
--   build its payload from the intent row's own amount and currency;
--   test 25 exercises the three new error paths.
--
-- Signature:
--   create or replace, same 3-arg signature as migration 0070. Verified
--   that 0070 is the only definition — no overload trap.
--
-- Ambiguity discipline (§11):
--   Every column reference inside the function body is qualified with a
--   table alias.
-- ============================================================================


create or replace function public.confirm_paystack_payment(
  p_provider_reference text,
  p_status             text,
  p_provider_payload   jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment          record;
  v_sub_id           uuid;
  v_payload_amount   bigint;
  v_payload_currency text;
begin
  if p_status not in ('succeeded','failed','refunded') then
    raise exception 'INVALID_PURPOSE';
  end if;

  select pt.id, pt.organization_id, pt.plan_id, pt.status,
         pt.subscription_id,
         pt.amount_minor_units, pt.currency
    into v_payment
    from public.payment_transactions pt
   where pt.provider = 'paystack'
     and pt.provider_reference = p_provider_reference
   for update;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  -- Idempotent on terminal states. Runs before cross-check: a replay on
  -- an already-decided row returns early without re-validating payload.
  if v_payment.status in ('succeeded','refunded','partially_refunded') then
    return v_payment.subscription_id;
  end if;

  if v_payment.status = 'failed' then
    return null;
  end if;

  -- ------------------------------------------------------------------------
  -- Cross-check: only for succeeded transitions.
  -- failed transitions from initiated/processing do not need amount check
  -- (no value moves on failure), but if the payload carries amount/currency
  -- we still validate consistency for audit integrity.
  -- ------------------------------------------------------------------------

  if not (p_provider_payload ? 'amount') then
    raise exception 'PAYMENT_PAYLOAD_INCOMPLETE';
  end if;

  if not (p_provider_payload ? 'currency') then
    raise exception 'PAYMENT_PAYLOAD_INCOMPLETE';
  end if;

  -- Paystack sends amount as a JSON number (kobo). Cast through text first
  -- because jsonb ->> returns text; direct ::bigint would also work but the
  -- explicit text step matches the codebase's jsonb-scalar pattern (see
  -- migration 0037, continuity §11).
  begin
    v_payload_amount := (p_provider_payload->>'amount')::bigint;
  exception when others then
    raise exception 'PAYMENT_PAYLOAD_INCOMPLETE';
  end;

  v_payload_currency := upper(btrim(p_provider_payload->>'currency'));

  if v_payload_amount <> v_payment.amount_minor_units then
    raise exception 'PAYMENT_AMOUNT_MISMATCH';
  end if;

  if v_payload_currency <> v_payment.currency then
    raise exception 'PAYMENT_CURRENCY_MISMATCH';
  end if;

  -- ------------------------------------------------------------------------
  -- Proceed with the transition.
  -- ------------------------------------------------------------------------

  update public.payment_transactions pt
     set status           = p_status,
         provider_payload = coalesce(p_provider_payload, '{}'::jsonb)
   where pt.id = v_payment.id;

  if p_status = 'succeeded' then
    v_sub_id := public.create_subscription_from_payment(v_payment.id);
  else
    v_sub_id := null;
  end if;

  perform public.log_audit_event(
    v_payment.organization_id,
    null,
    'payment.paystack_confirmed',
    'payment_transaction',
    v_payment.id,
    null,
    jsonb_build_object('status', p_status)
  );

  return v_sub_id;
end;
$$;

comment on function public.confirm_paystack_payment(text, text, jsonb) is
  'Confirms a Paystack payment intent. Cross-checks provider payload against the intent row: amount and currency must match exactly, both fields must be present. Raises PAYMENT_PAYLOAD_INCOMPLETE, PAYMENT_AMOUNT_MISMATCH, or PAYMENT_CURRENCY_MISMATCH on failure. Idempotent on terminal states (early return). Signature unchanged from migration 0070.';
