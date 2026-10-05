-- ============================================================================
-- Migration 0065: payment_destinations
-- ============================================================================
-- Purpose:
--   Multiple bank transfer destinations the platform can accept
--   payments into. Exactly one is active at any time. The active row
--   is what org admins see on the billing page when they choose to
--   pay by bank transfer.
--
-- Why multi-row instead of a singleton:
--   The bootstrap plan is personal account first, business account
--   after ODS registers. Multi-row means switching destinations is a
--   flag flip in the UI, not a migration or code deploy. Also covers
--   future cases: partner accounts, vendor accounts, temporary
--   receiving accounts.
--
-- Active-row enforcement:
--   Partial unique index on (is_active) WHERE is_active = true. At
--   most one row can be active. Zero is allowed (no destination
--   configured yet) — the customer-facing billing page must handle
--   that gracefully.
--
-- Two names for professionalism:
--   bank_account_name is the account holder name on the actual bank
--   account (e.g. "Pishon Samuel IGHO"). business_name is the
--   trading name shown to the customer in the primary position
--   (e.g. "Omtic Digital Services"). Both are displayed; the
--   customer never sees an ambiguous single name.
--
--   label is admin-facing only. Used to tell destinations apart in
--   the management UI. Never shown to customers.
--
-- RLS:
--   SELECT — any authenticated user, but filtered to is_active = true
--     unless the caller is a platform admin. A customer sees only the
--     destination to pay into. Inactive destinations are not leaked.
--   INSERT / UPDATE — platform admin only.
--   No DELETE policy — destinations are deactivated (is_active = false)
--     or archived, not hard-deleted. Matches the no-hard-delete tenant
--     convention.
--
-- No seed:
--   The table starts empty. The platform admin adds destinations from
--   the dashboard (T2). Customer-facing billing page handles empty
--   state.
--
-- Ambiguity discipline (§11):
--   Column references will be qualified with a table alias in the
--   functions that follow (T2's swap function). This migration is
--   schema + policy only.
--
-- Follow-up noted (not in this migration):
--   payment_transactions should eventually record which destination
--   received the money (payment_destination_id FK). Deferred — a
--   separate migration when the customer-facing billing flow lands.
-- ============================================================================


create table public.payment_destinations (
  id                    uuid primary key default public.uuidv7(),

  -- Admin-facing label. Never shown to customers.
  label                 text not null,

  -- Customer-facing trading name, shown in primary position.
  business_name         text,

  -- Actual bank account details.
  bank_account_name     text,
  bank_name             text,
  bank_account_number   text,
  bank_transfer_note    text,

  -- Exactly one active at a time. See partial unique index below.
  is_active             boolean not null default false,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint payment_destinations_label_not_blank
    check (length(btrim(label)) > 0)
);

comment on table public.payment_destinations is
  'Bank transfer destinations. At most one active (partial unique index). The active row is shown to org admins on the billing page.';

comment on column public.payment_destinations.label is
  'Admin-facing label, e.g. "Personal — Pishon". Never shown to customers.';

comment on column public.payment_destinations.business_name is
  'Trading name shown to customers, e.g. "Omtic Digital Services".';

comment on column public.payment_destinations.bank_account_name is
  'Account holder name on the actual bank account, e.g. "Pishon Samuel IGHO".';

comment on column public.payment_destinations.bank_transfer_note is
  'Optional extra instructions shown to payers (e.g. "use the BT reference as narration").';


create trigger payment_destinations_set_updated_at
  before update on public.payment_destinations
  for each row execute function public.set_updated_at();


-- ----------------------------------------------------------------------------
-- Exactly one active destination at a time.
-- ----------------------------------------------------------------------------

create unique index payment_destinations_one_active
  on public.payment_destinations (is_active)
  where is_active = true;


-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------

alter table public.payment_destinations enable row level security;

-- Active destination visible to any authenticated user. Inactive rows
-- are not leaked to non-admins.
create policy payment_destinations_select_active
  on public.payment_destinations for select
  to authenticated
  using (is_active = true);

-- Platform admins see all rows, active or not.
create policy payment_destinations_select_platform_admin
  on public.payment_destinations for select
  to authenticated
  using (public.is_platform_admin());

-- Platform admins create new destinations.
create policy payment_destinations_insert_platform_admin
  on public.payment_destinations for insert
  to authenticated
  with check (public.is_platform_admin());

-- Platform admins update destinations (edit details, activate / deactivate).
create policy payment_destinations_update_platform_admin
  on public.payment_destinations for update
  to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- No DELETE policy — destinations are deactivated, not deleted.
