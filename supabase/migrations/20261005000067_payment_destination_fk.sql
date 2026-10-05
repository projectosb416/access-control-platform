-- ============================================================================
-- Migration 0067: payment_destination FK + extended intent function
-- ============================================================================
-- Purpose:
--   Records which bank destination received each manual payment. Closes
--   the follow-up noted in migration 0065's header: "payment_transactions
--   should eventually record which destination received the money."
--
-- Two changes:
--
--   1. add column payment_destinations.payment_destination_id uuid
--      (nullable — existing rows in staging keep NULL; new rows from the
--      customer billing flow populate it).
--
--   2. create or replace record_manual_payment_intent — adds a fourth
--      parameter p_destination_id uuid default null. When provided,
--      validates the destination exists and stores it on the row.
--
-- The FK uses on delete restrict. Combined with payment_destinations'
-- no-DELETE-policy, rows cannot be hard-deleted. This matches the
-- no-hard-delete convention that runs through the whole schema.
--
-- Idempotency note: this migration is not idempotent for the ALTER —
-- `add column` has no `if not exists` in Postgres for FK-constrained
-- columns. If staging or production already has the column, the
-- migration must be corrected, not re-run. That is intentional: it
-- surfaces drift loudly rather than silently skipping.
-- ============================================================================


alter table public.payment_transactions
  add column payment_destination_id uuid
  references public.payment_destinations(id) on delete restrict;

create index payment_transactions_payment_destination_id
  on public.payment_transactions(payment_destination_id)
  where payment_destination_id is not null;

comment on column public.payment_transactions.payment_destination_id is
  'Bank destination that received this payment. Nullable — populated by the customer-initiated manual flow; older rows keep NULL.';


-- ----------------------------------------------------------------------------
-- Extend record_manual_payment_intent to accept p_destination_id.
-- ----------------------------------------------------------------------------

create or replace function public.record_manual_payment_intent(
  p_organization_id uuid,
  p_plan_id         uuid,
  p_purpose         text default 'initial',
  p_destination_id  uuid default null
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

  -- Validate destination if provided. Missing destination raises
  -- DESTINATION_NOT_FOUND; that code is already in the error-mapping
  -- doc from migration 0066's companion commit.
  if p_destination_id is not null then
    if not exists (
      select 1 from public.payment_destinations d
       where d.id = p_destination_id
    ) then
      raise exception 'DESTINATION_NOT_FOUND';
    end if;
  end if;

  v_reference  := public.generate_payment_reference();
  v_payment_id := public.uuidv7();

  insert into public.payment_transactions (
    id, organization_id, plan_id, purpose,
    source, provider, provider_reference,
    amount_minor_units, currency, status,
    initiated_by, payment_destination_id
  ) values (
    v_payment_id, p_organization_id, p_plan_id, p_purpose,
    'manual', 'bank_transfer', v_reference,
    v_plan.price_minor_units, v_plan.currency, 'pending_confirmation',
    v_account_id, p_destination_id
  );

  return query select
    v_payment_id,
    v_reference,
    v_plan.price_minor_units,
    v_plan.currency;
end;
$$;

comment on function public.record_manual_payment_intent(uuid, uuid, text, uuid) is
  'Org admin signals intent to pay by bank transfer. Returns BT reference for bank narration. Optional p_destination_id records which bank account received the payment.';
