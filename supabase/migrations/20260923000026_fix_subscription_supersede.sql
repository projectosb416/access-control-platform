-- ============================================================================
-- Migration 0026: fix subscription supersede order
-- ============================================================================
-- Bug (from migration 0021):
--   create_subscription_from_payment tried to supersede the existing
--   operational subscription BEFORE inserting the new one, and set
--   superseded_by to the new subscription's id in the same UPDATE.
--
--   The FK subscriptions_superseded_by_fkey rejects that immediately —
--   the new subscription doesn't exist yet. The UPDATE fails, the old
--   subscription stays active, and the subsequent INSERT hits the unique
--   partial index subscriptions_one_operational_per_org.
--
--   Latent since 0021. Never surfaced in Phase 5.5 because the test at
--   that time used a fresh org with no prior subscription, so the
--   supersede branch was never executed. Phase 7.1's audit tests
--   exercised the renewal path for the first time and exposed it.
--
-- Fix:
--   Split the supersede into three ordered steps so nothing references a
--   row that does not yet exist:
--     1. Mark old sub superseded (status, superseded_at) — no FK touched.
--     2. Insert new sub.
--     3. Set old sub's superseded_by = new sub id — FK satisfied.
--
--   Also switches from `is not null` on the record to `FOUND`, which is
--   the canonical PostgreSQL way to test whether SELECT INTO returned rows.
-- ============================================================================

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

  if found then
    v_period_start := greatest(v_existing_sub.current_period_end, now());
  else
    v_period_start := now();
  end if;

  v_period_end := v_period_start + make_interval(months => v_plan.billing_cycle_months);
  v_new_sub_id := public.uuidv7();

  -- Step 1: supersede the existing operational subscription.
  --         Does NOT set superseded_by yet — the new sub doesn't exist.
  if found then
    update public.subscriptions
       set status = 'superseded',
           superseded_at = now()
     where id = v_existing_sub.id;
  end if;

  -- Step 2: insert the new subscription. The old one has left the
  --         operational slot, so the unique partial index allows this.
  insert into public.subscriptions (
    id, organization_id, plan_id, status,
    current_period_start, current_period_end
  ) values (
    v_new_sub_id, v_payment.organization_id, v_payment.plan_id, 'active',
    v_period_start, v_period_end
  );

  -- Step 3: link the old sub to the new one. Both rows exist now, so the
  --         FK on superseded_by is satisfied.
  if found then
    update public.subscriptions
       set superseded_by = v_new_sub_id
     where id = v_existing_sub.id;
  end if;

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
  'Internal: creates subscription from a succeeded payment; supersedes prior operational; activates org. Three-step supersede avoids self-referential FK ordering issue.';
