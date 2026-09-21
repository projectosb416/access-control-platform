-- ============================================================================
-- Migration 0020: payment_transactions
-- ============================================================================
-- Purpose:
--   Provider-agnostic record of every payment attempt — success, failure,
--   refund, chargeback. Supports two verification paths:
--
--     1. Webhook (digital providers: Paystack, Flutterwave, etc.)
--        Customer pays → provider webhook → row auto-created as 'succeeded'
--        → subscription auto-created → org auto-activated.
--
--     2. Manual (bank transfer, while digital-provider onboarding is pending)
--        Customer transfers → clicks "I have sent the money" → row created
--        with status 'pending_confirmation' → platform admin verifies money
--        landed → admin confirms → row moves to 'succeeded' → subscription
--        and org activation proceed.
--
--   The `source` column distinguishes the two paths for audits and reporting.
--
-- Idempotency:
--   Payment providers resend webhooks. The unique key (provider,
--   provider_reference) means a replayed webhook finds its existing row
--   instead of creating a duplicate (§23).
--
-- States (handoff §22 + the manual-confirmation addition):
--   INITIATED → PROCESSING → PENDING_CONFIRMATION → SUCCEEDED / FAILED
--   terminal: REFUNDED, PARTIALLY_REFUNDED, CHARGEBACK
--
-- Money:
--   Integer minor units (kobo, cents). Never floats. Currency on the row,
--   not derived from plan — refunds and chargebacks may differ.
-- ============================================================================


create table public.payment_transactions (
  id                          uuid primary key default public.uuidv7(),
  organization_id             uuid not null references public.organizations(id) on delete restrict,

  -- The plan this payment is for. Set for initial payments (subscription
  -- may not exist yet). On renewal, both plan_id and subscription_id set.
  plan_id                     uuid references public.plans(id) on delete restrict,

  -- Subscription this payment funds. Nullable during initial signup —
  -- subscription is created only after the payment succeeds.
  subscription_id             uuid references public.subscriptions(id) on delete restrict,

  -- Purpose category, for reporting and reconciliation.
  purpose                     text not null default 'initial'
                              check (purpose in (
                                'initial','renewal','upgrade','addon','adjustment'
                              )),

  -- How this row was created.
  source                      text not null default 'webhook'
                              check (source in ('webhook','manual')),

  -- Provider identity.
  provider                    text not null
                              check (length(btrim(provider)) > 0),
  provider_reference          text not null
                              check (length(btrim(provider_reference)) > 0),

  -- Amount charged (or refunded), in minor units.
  amount_minor_units          bigint not null check (amount_minor_units >= 0),
  currency                    text not null
                              check (length(currency) = 3 and currency = upper(currency)),

  status                      text not null default 'initiated'
                              check (status in (
                                'initiated','processing','pending_confirmation',
                                'succeeded','failed',
                                'refunded','partially_refunded','chargeback'
                              )),

  -- Manual payment confirmation. Set when a platform admin verifies the
  -- money landed (bank transfer) and confirms the row.
  confirmed_at                timestamptz,
  confirmed_by                uuid references public.accounts(id) on delete set null,

  -- Refund / chargeback tracking.
  refunded_amount_minor_units bigint
                              check (refunded_amount_minor_units is null
                                     or refunded_amount_minor_units >= 0),
  refunded_at                 timestamptz,
  chargeback_at               timestamptz,

  -- Failure reason, if any.
  failure_reason              text,

  -- Raw webhook body (or manual note). Never contains our secrets.
  provider_payload            jsonb not null default '{}'::jsonb,

  -- Who initiated this payment row. NULL for webhook-driven creates.
  initiated_by                uuid references public.accounts(id) on delete set null,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  -- Manual payment confirmation consistency.
  constraint payment_transactions_confirmation_consistency
    check ((confirmed_at is not null) = (confirmed_by is not null)),

  constraint payment_transactions_manual_implies_confirmation
    check (
      source <> 'manual'
      or status not in ('succeeded')
      or confirmed_at is not null
    ),

  -- Refund consistency.
  constraint payment_transactions_pending_confirmation_requires_manual
    check (status <> 'pending_confirmation' or source = 'manual'),

  constraint payment_transactions_refund_consistency
    check (
      (status = 'refunded'
        and refunded_at is not null
        and refunded_amount_minor_units is not null)
      or (status = 'partially_refunded'
        and refunded_at is not null
        and refunded_amount_minor_units is not null
        and refunded_amount_minor_units < amount_minor_units)
      or (status not in ('refunded','partially_refunded'))
    ),

  constraint payment_transactions_chargeback_consistency
    check ((status = 'chargeback') = (chargeback_at is not null)),

  constraint payment_transactions_succeeded_no_failure
    check (status <> 'succeeded' or failure_reason is null)
);

comment on table public.payment_transactions is
  'Provider-agnostic payment ledger. Webhook-driven and manually-confirmed payments. Idempotent.';

comment on column public.payment_transactions.plan_id is
  'Which plan this payment is for. Set for initial payments where subscription does not exist yet.';

comment on column public.payment_transactions.source is
  'webhook: created by provider callback. manual: created by customer + confirmed by platform admin (bank transfer).';

comment on column public.payment_transactions.provider_reference is
  'Provider transaction id, or bank transfer reference for manual payments. Unique per provider.';

comment on column public.payment_transactions.status is
  'pending_confirmation: manual payment awaiting admin verification. succeeded: payment verified.';

comment on column public.payment_transactions.confirmed_at is
  'When a platform admin verified a manual payment. NULL for webhook-driven rows.';

create trigger payment_transactions_set_updated_at
  before update on public.payment_transactions
  for each row execute function public.set_updated_at();

-- Fast "all payments for this org, newest first".
create index payment_transactions_org_created
  on public.payment_transactions(organization_id, created_at desc);

-- Fast "payments for this subscription".
create index payment_transactions_subscription_id
  on public.payment_transactions(subscription_id)
  where subscription_id is not null;

-- Fast "payments for this plan" (reporting).
create index payment_transactions_plan_id
  on public.payment_transactions(plan_id)
  where plan_id is not null;

-- Idempotency: one row per (provider, provider_reference).
create unique index payment_transactions_provider_reference_unique
  on public.payment_transactions(provider, provider_reference);

-- Manual payments awaiting admin confirmation — the platform admin queue.
create index payment_transactions_pending_confirmation
  on public.payment_transactions(created_at)
  where status = 'pending_confirmation' and source = 'manual';

-- Failed payments awaiting retry or support.
create index payment_transactions_failed
  on public.payment_transactions(organization_id, created_at desc)
  where status in ('failed','chargeback');

-- Succeeded payments for revenue reporting.
create index payment_transactions_succeeded
  on public.payment_transactions(organization_id, created_at desc)
  where status = 'succeeded';


-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------

alter table public.payment_transactions enable row level security;

-- Org admins read their own payment history (billing page).
create policy payment_transactions_select_org_admin on public.payment_transactions
  for select
  using (public.is_org_admin(organization_id));

-- Platform admins read all payments (revenue monitoring, §27).
create policy payment_transactions_select_platform_admin on public.payment_transactions
  for select
  using (public.is_platform_admin());

-- No INSERT policy — payments are created only by service-role code.
-- No UPDATE policy — status transitions are service-role only.
-- No DELETE policy — financial records are permanent.


-- ----------------------------------------------------------------------------
-- Helper: generate_payment_reference
-- ----------------------------------------------------------------------------
-- Generates a unique BT-XXXXXX code for manual bank transfer payments.
-- Same alphabet as guard/shift codes — no visually ambiguous characters.
-- Uniqueness scoped to (provider='bank_transfer', provider_reference).
-- Retries on collision.

create or replace function public.generate_payment_reference()
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
    candidate := 'BT-';
    for i in 1..6 loop
      candidate := candidate || substr(
        alphabet,
        1 + floor(random() * length(alphabet))::int,
        1
      );
    end loop;

    select exists (
      select 1 from public.payment_transactions
      where provider = 'bank_transfer'
        and provider_reference = candidate
    ) into hit;

    if not hit then
      return candidate;
    end if;
  end loop;

  raise exception 'could not generate unique payment reference after 50 attempts';
end;
$$;

comment on function public.generate_payment_reference() is
  'Generates a unique BT-XXXXXX reference for manual bank transfer payments.';
