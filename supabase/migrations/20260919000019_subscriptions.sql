-- ============================================================================
-- Migration 0019: subscriptions
-- ============================================================================
-- Purpose:
--   Track an organization's billing state. Drives the entitlement checks
--   that gate operational actions across the platform (handoff §28).
--
-- Model — one row per plan period:
--   - Each initial signup, renewal, or plan change creates a NEW row.
--   - The previous row moves to status 'superseded'.
--   - Payment events (failure, recovery, expiry) change status on the
--     CURRENT row — they do not create new rows.
--
--   This gives clean history: "org was on Pro from Jan–Jun, then on
--   Standard from Jun–Dec" without rewriting anything (§38).
--
-- Lifecycle (handoff §22):
--   TRIAL → ACTIVE → PAST_DUE → GRACE_PERIOD → SUSPENDED
--   exceptional CANCELLED / EXPIRED / SUPERSEDED
--   Verified payment returns PAST_DUE / GRACE_PERIOD / SUSPENDED → ACTIVE.
--
-- Currency and price live on the plan; subscription records the period
-- and plan_id only. Amounts actually charged live on payment_transactions.
--
-- Safety rules:
--   - At most one operational subscription per organization (partial index).
--   - Cancelled / superseded rows require their timestamps.
--   - Trial / grace periods require their end timestamps.
-- ============================================================================


create table public.subscriptions (
  id                    uuid primary key default public.uuidv7(),
  organization_id       uuid not null references public.organizations(id) on delete restrict,
  plan_id               uuid not null references public.plans(id) on delete restrict,

  status                text not null default 'trial'
                        check (status in (
                          'trial','active','past_due','grace_period','suspended',
                          'cancelled','expired','superseded'
                        )),

  -- The period this subscription covers. On renewal, a new row starts
  -- with current_period_start = old row's current_period_end.
  current_period_start  timestamptz not null,
  current_period_end    timestamptz not null,

  -- Trial support.
  trial_ends_at         timestamptz,

  -- Grace support. Set when status moves to grace_period.
  grace_ends_at         timestamptz,

  -- Cancellation. Set when status moves to cancelled.
  cancelled_at          timestamptz,
  cancelled_by          uuid references public.accounts(id) on delete set null,
  cancel_reason         text,

  -- Superseded: the current row was replaced by a plan change or renewal.
  -- superseded_by points at the new row that replaced this one.
  superseded_at         timestamptz,
  superseded_by         uuid references public.subscriptions(id) on delete set null,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint subscriptions_period_order
    check (current_period_end > current_period_start),

  constraint subscriptions_trial_consistency
    check ((status = 'trial') = (trial_ends_at is not null)),

  constraint subscriptions_grace_consistency
    check ((status = 'grace_period') = (grace_ends_at is not null)),

  constraint subscriptions_cancelled_consistency
    check ((status = 'cancelled') = (cancelled_at is not null)),

  constraint subscriptions_superseded_consistency
    check ((status = 'superseded') = (superseded_at is not null))
);

comment on table public.subscriptions is
  'Per-org billing state. One row per plan period. Drives entitlement checks.';

comment on column public.subscriptions.current_period_end is
  'End of the period this subscription covers. Renewal creates a new row with period_start = this.';

comment on column public.subscriptions.superseded_by is
  'When this row was replaced by a plan change or renewal: id of the new row.';

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create index subscriptions_organization_id on public.subscriptions(organization_id);
create index subscriptions_plan_id on public.subscriptions(plan_id);

-- Fast "current subscription for this org" — used by the operational helper.
create index subscriptions_operational_by_org
  on public.subscriptions(organization_id, current_period_end desc)
  where status in ('trial','active','past_due','grace_period');

-- Safety: at most one OPERATIONAL subscription per org at a time.
-- History rows (superseded, cancelled, expired, suspended) don't compete.
create unique index subscriptions_one_operational_per_org
  on public.subscriptions(organization_id)
  where status in ('trial','active','past_due','grace_period');

-- Fast "what needs renewal soon".
create index subscriptions_period_end
  on public.subscriptions(current_period_end)
  where status in ('active','past_due');


-- ----------------------------------------------------------------------------
-- Helper: is_org_operational
-- ----------------------------------------------------------------------------
-- The single source of truth for "can this org do operational things?"
-- Used by evaluate_entry and start_shift_session. Not used by evaluate_exit —
-- exit is always allowed (§23: never block safe exit of an active visitor).
--
-- Returns true when BOTH:
--   - org.status = 'active'   (admin hasn't suspended the tenant)
--   - an operational subscription exists
--
-- Returns false otherwise (org in provisioning, or subscription suspended).

create or replace function public.is_org_operational(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.organizations
      where id = p_organization_id
        and status = 'active'
    )
    and exists (
      select 1 from public.subscriptions
      where organization_id = p_organization_id
        and status in ('trial','active','past_due','grace_period')
    );
$$;

comment on function public.is_org_operational(uuid) is
  'True if the org is active AND has an operational subscription. The gate for ENTRY and shift start.';


-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------

alter table public.subscriptions enable row level security;

-- Org admins read their own subscriptions (current + history).
create policy subscriptions_select_org_admin on public.subscriptions
  for select
  using (public.is_org_admin(organization_id));

-- Platform admins read all subscriptions (revenue/health monitoring, §27).
create policy subscriptions_select_platform_admin on public.subscriptions
  for select
  using (public.is_platform_admin());

-- No INSERT policy — subscriptions are created only by service-role code
-- (the Subscription Service, acting on verified payment provider webhooks).
-- No UPDATE policy — status transitions are service-role only.
-- No DELETE policy — history is preserved, never hard-deleted.
