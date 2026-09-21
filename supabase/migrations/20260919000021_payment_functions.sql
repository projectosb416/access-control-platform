-- ============================================================================
-- Migration 0021: payment functions
-- ============================================================================
-- Purpose:
--   The five functions that turn a payment_transactions row into an active
--   subscription and an active organization. Two flows share one core.
--
-- Manual flow (bank transfer, while digital provider onboarding is pending):
--   org admin → record_manual_payment_intent()  → pending_confirmation row
--   customer sends money using the returned BT reference
--   platform admin → confirm_manual_payment()   → subscription + org active
--
-- Webhook flow (Paystack/Flutterwave, when the time comes):
--   provider → record_payment_webhook()  → subscription + org active
--
-- Both flows converge on create_subscription_from_payment(), which is the
-- only place that writes a subscription and flips the org to active. One
-- code path for the money-to-state transition means one place to audit.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. create_subscription_from_payment — internal core
-- ----------------------------------------------------------------------------
-- Called only by confirm_manual_payment() and record_payment_webhook().
-- Takes a payment already marked 'succeeded'. Creates the subscription.
-- Activates the org if it was in 'provisioning'.
-- Supersedes any existing operational subscription (renewal / upgrade).
--
-- Period logic:
--   First subscription:       period_start = now()
--   Renewal before expiry:    period_start = old period_end (extends seamlessly)
--   Renewal after expiry:     period_start = now() (no gap credit)
--   Upgrade (future):         same as renewal for now — flagged as v2

create or replace function public.create_subscription_from_payment(p_payment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment       record;
  v_plan          record;
  v_existing_sub  record;
  v_new_sub_id    uuid;
  v_period_start  timestamptz;
  v_period_end    timestamptz;
begin
  select * into v_payment
    from public.payment_transactions
   where id = p_payment_id;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  if v_payment.status <> 'succeeded' then
    raise exception 'PAYMENT_NOT_SUCCEEDED';
  end if;

  if v_payment.plan_id is null then
    raise exception 'PAYMENT_MISSING_PLAN';
  end if;

  -- Already linked — nothing to do, return existing subscription.
  if v_payment.subscription_id is not null then
    return v_payment.subscription_id;
  end if;

  select * into v_plan
    from public.plans
   where id = v_payment.plan_id;

  if not found then
    raise exception 'PLAN_NOT_FOUND';
  end if;

  -- Find any current operational subscription to supersede.
  select * into v_existing_sub
    from public.subscriptions
   where organization_id = v_payment.organization_id
     and status in ('trial','active','past_due','grace_period')
   limit 1;

  if v_existing_sub is not null then
    v_period_start := greatest(v_existing_sub.current_period_end, now());
  else
    v_period_start := now();
  end if;

  v_period_end := v_period_start + make_interval(months => v_plan.billing_cycle_months);
  v_new_sub_id := public.uuidv7();

  -- Supersede the existing operational subscription FIRST — the partial
  -- unique index subscriptions_one_operational_per_org forbids two
  -- operational rows for the same org at the same instant.
  if v_existing_sub is not null then
    update public.subscriptions
       set status = 'superseded',
           superseded_at = now(),
           superseded_by = v_new_sub_id
     where id = v_existing_sub.id;
  end if;

  insert into public.subscriptions (
    id, organization_id, plan_id, status,
    current_period_start, current_period_end
  ) values (
    v_new_sub_id, v_payment.organization_id, v_payment.plan_id, 'active',
    v_period_start, v_period_end
  );

  -- Link payment to subscription.
  update public.payment_transactions
     set subscription_id = v_new_sub_id
   where id = p_payment_id;

  -- Activate the org if it was still provisioning.
  update public.organizations
     set status = 'active'
   where id = v_payment.organization_id
     and status = 'provisioning';

  return v_new_sub_id;
end;
$$;

comment on function public.create_subscription_from_payment(uuid) is
  'Internal: creates subscription from a succeeded payment; supersedes prior operational; activates org.';


-- ----------------------------------------------------------------------------
-- 2. record_manual_payment_intent — customer clicks "pay by bank transfer"
-- ----------------------------------------------------------------------------

create or replace function public.record_manual_payment_intent(
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
    from public.plans
   where id = p_plan_id
     and status = 'active';

  if not found then
    raise exception 'PLAN_NOT_AVAILABLE';
  end if;

  v_reference  := public.generate_payment_reference();
  v_payment_id := public.uuidv7();

  insert into public.payment_transactions (
    id, organization_id, plan_id, purpose,
    source, provider, provider_reference,
    amount_minor_units, currency, status,
    initiated_by
  ) values (
    v_payment_id, p_organization_id, p_plan_id, p_purpose,
    'manual', 'bank_transfer', v_reference,
    v_plan.price_minor_units, v_plan.currency, 'pending_confirmation',
    v_account_id
  );

  return query select
    v_payment_id,
    v_reference,
    v_plan.price_minor_units,
    v_plan.currency;
end;
$$;

comment on function public.record_manual_payment_intent(uuid, uuid, text) is
  'Org admin signals intent to pay by bank transfer. Returns BT reference for bank narration.';


-- ----------------------------------------------------------------------------
-- 3. confirm_manual_payment — platform admin verifies money landed
-- ----------------------------------------------------------------------------

create or replace function public.confirm_manual_payment(
  p_payment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment      record;
  v_admin_id     uuid;
  v_sub_id       uuid;
begin
  v_admin_id := public.current_account_id();

  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN';
  end if;

  select * into v_payment
    from public.payment_transactions
   where id = p_payment_id;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  if v_payment.source <> 'manual' then
    raise exception 'NOT_MANUAL_PAYMENT';
  end if;

  -- Idempotent: already confirmed → return existing subscription.
  if v_payment.status = 'succeeded' then
    return v_payment.subscription_id;
  end if;

  if v_payment.status <> 'pending_confirmation' then
    raise exception 'PAYMENT_NOT_PENDING';
  end if;

  update public.payment_transactions
     set status = 'succeeded',
         confirmed_at = now(),
         confirmed_by = v_admin_id
   where id = p_payment_id;

  v_sub_id := public.create_subscription_from_payment(p_payment_id);

  return v_sub_id;
end;
$$;

comment on function public.confirm_manual_payment(uuid) is
  'Platform admin confirms a manual payment has landed. Activates org + subscription. Idempotent.';


-- ----------------------------------------------------------------------------
-- 4. cancel_manual_payment — cancel a stale pending payment
-- ----------------------------------------------------------------------------

create or replace function public.cancel_manual_payment(
  p_payment_id uuid,
  p_reason     text default 'cancelled'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
begin
  select * into v_payment
    from public.payment_transactions
   where id = p_payment_id;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  if v_payment.status <> 'pending_confirmation' then
    raise exception 'PAYMENT_NOT_PENDING';
  end if;

  -- Org admin of that org, or platform admin.
  if not public.is_org_admin(v_payment.organization_id)
     and not public.is_platform_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  update public.payment_transactions
     set status = 'failed',
         failure_reason = p_reason
   where id = p_payment_id;
end;
$$;

comment on function public.cancel_manual_payment(uuid, text) is
  'Cancels a pending manual payment. Org admin or platform admin.';


-- ----------------------------------------------------------------------------
-- 5. record_payment_webhook — digital provider callback
-- ----------------------------------------------------------------------------
-- Idempotent by (provider, provider_reference). Returns existing row id on
-- replay. Auto-creates subscription + activates org on 'succeeded'.
--
-- Caller is the Payment Service running with the service-role key. No
-- user-level auth check — the service role itself is the trust boundary.

create or replace function public.record_payment_webhook(
  p_organization_id    uuid,
  p_plan_id            uuid,
  p_purpose            text,
  p_provider           text,
  p_provider_reference text,
  p_amount_minor_units bigint,
  p_currency           text,
  p_status             text,
  p_failure_reason     text default null,
  p_provider_payload   jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_new_id      uuid;
begin
  -- Idempotency check.
  select id into v_existing_id
    from public.payment_transactions
   where provider = p_provider
     and provider_reference = p_provider_reference;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  v_new_id := public.uuidv7();

  insert into public.payment_transactions (
    id, organization_id, plan_id, purpose,
    source, provider, provider_reference,
    amount_minor_units, currency, status,
    failure_reason, provider_payload
  ) values (
    v_new_id, p_organization_id, p_plan_id, p_purpose,
    'webhook', p_provider, p_provider_reference,
    p_amount_minor_units, p_currency, p_status,
    p_failure_reason, coalesce(p_provider_payload, '{}'::jsonb)
  );

  if p_status = 'succeeded' then
    perform public.create_subscription_from_payment(v_new_id);
  end if;

  return v_new_id;
end;
$$;

comment on function public.record_payment_webhook(
  uuid, uuid, text, text, text, bigint, text, text, text, jsonb
) is
  'Idempotent webhook receiver for digital payment providers. Auto-activates on succeeded.';
