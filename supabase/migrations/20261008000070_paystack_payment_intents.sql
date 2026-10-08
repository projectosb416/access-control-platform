-- ============================================================================
-- Migration 0070: Paystack payment intents
-- ============================================================================
-- Purpose:
--   Supports the local-first (Shape B) Paystack integration:
--
--     /api/paystack/initiate:
--       1. Creates a local payment_transactions row, status='initiated',
--          source='webhook', provider='paystack', reference PSK-XXXXXX.
--       2. Calls Paystack /transaction/initialize with the local reference.
--       3. Returns the Paystack checkout URL to the client.
--
--     /api/paystack/webhook (on charge.success):
--       Calls confirm_paystack_payment(reference, 'succeeded', payload).
--       That function finds the row, flips status, calls
--       create_subscription_from_payment, returns the subscription id.
--
-- Why not reuse record_payment_webhook:
--   Its idempotency guard (`if exists row with same provider+reference,
--   return its id and stop`) is correct for webhook retries but
--   incompatible with Shape B — the row always exists by the time the
--   webhook fires, so the guard would return early and never flip status
--   or create the subscription. confirm_paystack_payment is the Shape-B
--   counterpart: idempotent on terminal states, active on 'initiated'.
--
-- source='webhook' rationale:
--   The `source` column describes the confirmation channel, not the
--   creation channel. A Paystack payment is confirmed by webhook, even
--   when the row was created by our API. No CHECK constraint change.
--
-- Amount:
--   record_paystack_payment_intent stores the plan's price_minor_units
--   at intent time. The webhook reports the amount Paystack accepted;
--   confirm_paystack_payment does NOT cross-check them in v1 (queued
--   as a hardening follow-up). If the two diverge, the discrepancy is
--   visible in the payment row and the provider_payload.
--
-- Error codes:
--   NOT_AUTHENTICATED          — record intent, no session
--   NOT_ORG_ADMIN              — record intent, caller not org admin
--   PLAN_NOT_AVAILABLE         — record intent, plan missing or inactive
--   INVALID_PURPOSE            — record intent, purpose not initial/renewal/upgrade
--   PAYMENT_NOT_FOUND          — confirm, no matching row
--   (all existing in docs/phase-7/error-http-mapping.md)
--
-- Ambiguity discipline (§11):
--   Column references qualified with table aliases in every query
--   inside the two new functions.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. generate_paystack_reference
-- ----------------------------------------------------------------------------
-- Parallel to generate_payment_reference() (which is scoped to
-- provider='bank_transfer'). Same alphabet, same retry-on-collision
-- shape, different prefix (PSK-).

create or replace function public.generate_paystack_reference()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  alphabet  text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  candidate text;
  i         int;
  attempt   int;
  hit       boolean;
begin
  for attempt in 1..50 loop
    candidate := 'PSK-';
    for i in 1..6 loop
      candidate := candidate || substr(
        alphabet,
        1 + floor(random() * length(alphabet))::int,
        1
      );
    end loop;

    select exists (
      select 1 from public.payment_transactions pt
       where pt.provider = 'paystack'
         and pt.provider_reference = candidate
    ) into hit;

    if not hit then
      return candidate;
    end if;
  end loop;

  raise exception 'could not generate unique paystack reference after 50 attempts';
end;
$$;

comment on function public.generate_paystack_reference() is
  'Generates a unique PSK-XXXXXX reference for Paystack payments.';


-- ----------------------------------------------------------------------------
-- 2. record_paystack_payment_intent
-- ----------------------------------------------------------------------------

create or replace function public.record_paystack_payment_intent(
  p_organization_id uuid,
  p_plan_id         uuid,
  p_purpose         text default 'initial'
)
returns table (
  payment_id          uuid,
  reference           text,
  amount_minor_units  bigint,
  currency            text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan        record;
  v_account_id  uuid;
  v_reference   text;
  v_payment_id  uuid;
begin
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not public.is_org_admin(p_organization_id) then
    raise exception 'NOT_ORG_ADMIN';
  end if;

  if p_purpose not in ('initial','renewal','upgrade') then
    raise exception 'INVALID_PURPOSE';
  end if;

  select * into v_plan
    from public.plans pl
   where pl.id = p_plan_id
     and pl.status = 'active';

  if not found then
    raise exception 'PLAN_NOT_AVAILABLE';
  end if;

  v_reference  := public.generate_paystack_reference();
  v_payment_id := public.uuidv7();

  insert into public.payment_transactions (
    id, organization_id, plan_id, purpose,
    source, provider, provider_reference,
    amount_minor_units, currency, status,
    initiated_by
  ) values (
    v_payment_id, p_organization_id, p_plan_id, p_purpose,
    'webhook', 'paystack', v_reference,
    v_plan.price_minor_units, v_plan.currency, 'initiated',
    v_account_id
  );

  return query select
    v_payment_id,
    v_reference,
    v_plan.price_minor_units,
    v_plan.currency;
end;
$$;

comment on function public.record_paystack_payment_intent(uuid, uuid, text) is
  'Creates a local Paystack payment intent row. Shape B (local-first) — row visible on platform dashboard before webhook fires.';


-- ----------------------------------------------------------------------------
-- 3. confirm_paystack_payment
-- ----------------------------------------------------------------------------
-- Called by /api/paystack/webhook after signature verification.
-- Finds the intent row by reference, updates status, and (on succeeded)
-- delegates to create_subscription_from_payment. Idempotent on
-- terminal states.

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
begin
  if p_status not in ('succeeded','failed','refunded') then
    raise exception 'INVALID_PURPOSE';
  end if;

  select pt.id, pt.organization_id, pt.plan_id, pt.status,
         pt.subscription_id
    into v_payment
    from public.payment_transactions pt
   where pt.provider = 'paystack'
     and pt.provider_reference = p_provider_reference
   for update;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  -- Idempotent on terminal states.
  if v_payment.status in ('succeeded','refunded','partially_refunded') then
    return v_payment.subscription_id;
  end if;

  if v_payment.status = 'failed' then
    return null;
  end if;

  -- Only 'initiated' and 'processing' proceed from here.

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
  'Called by the Paystack webhook. Finds the intent row by reference, updates status, creates subscription on succeeded. Idempotent on terminal states.';
