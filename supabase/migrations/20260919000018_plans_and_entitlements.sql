-- ============================================================================
-- Migration 0018: plans and plan_entitlements
-- ============================================================================
-- Purpose:
--   Define what customers buy (plans) and what each plan unlocks
--   (entitlements). Plans are global — same catalog offered to every org.
--   Platform Admin manages plans; orgs choose from the active set.
--
-- Billing model:
--   Price is per billing cycle, not per month. Display of "X/month, billed
--   yearly" is derived: monthly = price_minor_units / billing_cycle_months.
--   Storing the total-charged amount (not the monthly rate) keeps the number
--   we actually charge the customer stable against future UI changes.
--
-- Entitlements:
--   Key-value, not fixed columns. Adding "sms_notifications" or
--   "max_events_per_month" is a data insert, not a migration. Values are
--   jsonb so any plan can mix ints, booleans, and strings — but code that
--   reads a given key knows what shape to expect.
--
--   Known keys (defined by product, not by schema):
--     max_gates, max_guards, max_units, max_properties,
--     max_household_members_per_unit, sms_notifications, audit_retention_days,
--     support_level
--
-- Money storage:
--   Integer minor units (kobo for NGN, cents for USD). Never floats.
--   `currency` is ISO 4217, 3 letters, uppercase.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. plans
-- ----------------------------------------------------------------------------

create table public.plans (
  id                     uuid primary key default public.uuidv7(),
  code                   text not null,
  name                   text not null,
  description            text,

  currency               text not null
                         check (length(currency) = 3 and currency = upper(currency)),

  -- Amount charged per billing cycle, in minor units.
  price_minor_units      bigint not null check (price_minor_units >= 0),

  -- Number of months per billing cycle. 12 = billed yearly.
  billing_cycle_months   int not null default 12
                         check (billing_cycle_months > 0 and billing_cycle_months <= 36),

  -- Display ordering.
  sort_order             int not null default 0,

  status                 text not null default 'active'
                         check (status in ('active','archived')),

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint plans_code_not_blank check (length(btrim(code)) > 0),
  constraint plans_name_not_blank check (length(btrim(name)) > 0)
);

comment on table public.plans is
  'Plan catalog. Global — same set offered to every organization.';

comment on column public.plans.price_minor_units is
  'Amount charged per billing cycle in the currency''s smallest unit (kobo, cents). Never floats.';

comment on column public.plans.billing_cycle_months is
  'Cycle length in months. 12 = billed yearly. Monthly display rate derives from price / cycle.';

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

-- Globally unique plan code.
create unique index plans_unique_code on public.plans(code);

-- Fast "active plans, in display order".
create index plans_active_ordered on public.plans(sort_order)
  where status = 'active';


-- ----------------------------------------------------------------------------
-- 2. plan_entitlements
-- ----------------------------------------------------------------------------
-- Key-value. One row per (plan, entitlement key).
-- Values are jsonb so integer limits, boolean flags, and string tiers all
-- coexist cleanly without a schema change per new entitlement.

create table public.plan_entitlements (
  id                    uuid primary key default public.uuidv7(),
  plan_id               uuid not null references public.plans(id) on delete restrict,
  entitlement_code      text not null,
  entitlement_value     jsonb not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint plan_entitlements_code_not_blank
    check (length(btrim(entitlement_code)) > 0)
);

comment on table public.plan_entitlements is
  'Per-plan entitlement values. Key-value so new entitlements are data, not migrations.';

comment on column public.plan_entitlements.entitlement_value is
  'jsonb: can be integer (limit), boolean (feature on/off), or string (tier). Code reading the key knows the shape.';

create trigger plan_entitlements_set_updated_at
  before update on public.plan_entitlements
  for each row execute function public.set_updated_at();

-- One value per (plan, code).
create unique index plan_entitlements_unique_code_per_plan
  on public.plan_entitlements(plan_id, entitlement_code);

create index plan_entitlements_plan_id on public.plan_entitlements(plan_id);


-- ----------------------------------------------------------------------------
-- 3. Row Level Security
-- ----------------------------------------------------------------------------
-- Plans are global. Every authenticated user can read the active catalog.
-- Only platform admins write.

alter table public.plans              enable row level security;
alter table public.plan_entitlements  enable row level security;

create policy plans_select_authenticated on public.plans
  for select
  to authenticated
  using (status = 'active' or public.is_platform_admin());

create policy plans_write_platform_admin on public.plans
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy plan_entitlements_select_authenticated on public.plan_entitlements
  for select
  to authenticated
  using (
    exists (
      select 1 from public.plans p
      where p.id = plan_entitlements.plan_id
        and (p.status = 'active' or public.is_platform_admin())
    )
  );

create policy plan_entitlements_write_platform_admin on public.plan_entitlements
  for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- No DELETE policies — plans and entitlements are archived (status change),
-- never hard-deleted (§38).
