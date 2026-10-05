-- ============================================================================
-- Migration 0064: refund_payment
-- ============================================================================
-- Purpose:
--   Records a full or partial refund against a succeeded or already-
--   partially-refunded payment. Platform-admin only. Money movement
--   itself is out-of-band (bank transfer, or later a Paystack refund
--   API call); this function records intent and status, consistent
--   with the schema's separation between "we recorded a refund" and
--   "we sent the money back."
--
-- Idempotency and accumulation:
--   Partial refunds accumulate. A payment of ₦10,000 can receive ₦5,000
--   then ₦3,000 more. refunded_amount_minor_units reflects the running
--   total; refunded_at is the timestamp of the most recent refund.
--   A refund that would push the total above the original amount is
--   rejected with REFUND_EXCEEDS_REMAINING.
--
--   The 0020 CHECK constraint on `refunded` does not enforce
--   refunded_amount_minor_units <= amount_minor_units (only
--   `partially_refunded` constrains < amount_minor_units). This
--   function closes that gap by validating before update.
--
-- Not in this function:
--   - Actual money movement. Out of scope.
--   - Cancelling or altering the org's subscription. A refund does not
--     revoke access — separate admin action.
--   - Refunding pending/failed payments. Only succeeded and
--     partially_refunded are refundable.
--
-- Reason and attribution:
--   Recorded in audit_events (reason field, actor_account_id), not on
--   the payment row. Schema has no refund_reason/refunded_by column.
--   Same pattern as end_household_member (0057).
--
-- Error codes (docs/phase-7/error-http-mapping.md):
--   NOT_AUTHENTICATED      — 401
--   NOT_PLATFORM_ADMIN     — 403
--   PAYMENT_NOT_FOUND      — 404
--   PAYMENT_NOT_REFUNDABLE — 409  (status not succeeded/partially_refunded)
--   INVALID_REFUND_AMOUNT  — 400  (amount <= 0)
--   REFUND_EXCEEDS_REMAINING — 400 (total would exceed original)
--   REASON_REQUIRED        — 400  (blank reason)
--
-- Ambiguity discipline (§11): column references qualified with table
-- alias. RETURNING clauses and OUT params do not collide with the
-- column names in this function (no returns table).
-- ============================================================================

create or replace function public.refund_payment(
  p_payment_id          uuid,
  p_amount_minor_units  bigint,
  p_reason              text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id     uuid;
  v_payment        record;
  v_new_refunded   bigint;
  v_new_status     text;
begin
  -- 1. Authenticated.
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- 2. Platform admin only.
  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN';
  end if;

  -- 3. Input validation — amount positive.
  if p_amount_minor_units is null or p_amount_minor_units <= 0 then
    raise exception 'INVALID_REFUND_AMOUNT';
  end if;

  -- 4. Input validation — reason not blank.
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED';
  end if;

  -- 5. Lock the payment row for the duration of the transaction.
  select p.id, p.organization_id, p.amount_minor_units, p.status,
         p.refunded_amount_minor_units
    into v_payment
    from public.payment_transactions p
   where p.id = p_payment_id
   for update;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  -- 6. Status check — only succeeded and partially_refunded are refundable.
  if v_payment.status not in ('succeeded', 'partially_refunded') then
    raise exception 'PAYMENT_NOT_REFUNDABLE';
  end if;

  -- 7. Compute new refunded total and validate against original.
  v_new_refunded := coalesce(v_payment.refunded_amount_minor_units, 0)
                    + p_amount_minor_units;

  if v_new_refunded > v_payment.amount_minor_units then
    raise exception 'REFUND_EXCEEDS_REMAINING';
  end if;

  -- 8. Determine new status.
  if v_new_refunded = v_payment.amount_minor_units then
    v_new_status := 'refunded';
  else
    v_new_status := 'partially_refunded';
  end if;

  -- 9. Update. updated_at handled by trigger
  --    (payment_transactions_set_updated_at).
  update public.payment_transactions p
     set status                      = v_new_status,
         refunded_amount_minor_units = v_new_refunded,
         refunded_at                 = now()
   where p.id = p_payment_id;

  -- 10. Audit — same transaction. Reason and actor captured here.
  perform public.log_audit_event(
    v_payment.organization_id,
    v_account_id,
    'payment.refunded',
    'payment_transaction',
    p_payment_id,
    p_reason,
    jsonb_build_object(
      'amount_minor_units',    p_amount_minor_units,
      'new_total_refunded',    v_new_refunded,
      'original_amount',       v_payment.amount_minor_units,
      'new_status',            v_new_status
    )
  );
end;
$$;

comment on function public.refund_payment(uuid, bigint, text) is
  'Platform-admin only. Records a full or partial refund against a succeeded or partially_refunded payment. Partial refunds accumulate. Reason and attribution live in audit_events. Does not move money; records intent.';
