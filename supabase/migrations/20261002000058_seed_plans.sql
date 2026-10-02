-- ============================================================================
-- Migration 0058: seed plan catalog
-- ============================================================================
-- Purpose:
--   Populate the plans + plan_entitlements catalog with the three
--   production tiers: Starter, Standard, Premium.
--
-- Pricing model (locked in this session, per product decision):
--   - Annual prepay only. price_minor_units = total charged per 12-month
--     cycle, in kobo (NGN minor unit). Monthly display is derived as
--     price_minor_units / 12 by the UI.
--   - Prices are VAT-exclusive. 7.5% VAT is added at invoice/receipt
--     generation. A future VAT rate change does not require migrating
--     plan prices.
--   - Three tiers, hard caps. No auto-upgrade on overage. When an org
--     hits a limit, the operation fails with PLAN_LIMIT_REACHED and the
--     UI prompts to contact sales for an upgrade. Auto-upgrade and
--     scheduled cancellation are v2 work, alongside the platform-admin
--     upgrade-confirmation UI.
--
-- Axis design:
--   Pricing axes are operational scale — properties, gates, guards,
--   units. Non-pricing entitlements (household members, guest PINs,
--   audit retention) are generous because their unit cost is negligible;
--   limits exist for abuse prevention, not to force upgrades. A 2-gate
--   estate with high household-member needs fits comfortably in Starter
--   under these numbers, which is the intent.
--
-- Idempotent:
--   Every insert uses ON CONFLICT DO NOTHING. Re-running this migration
--   against a partially-seeded catalog produces no errors. Adjusting a
--   plan price later requires a separate UPDATE migration — this seed is
--   initial state only.
--
-- Values:
--   Starter  — ₦30,000/mo × 12 = ₦360,000 = 36,000,000 kobo
--   Standard — ₦45,000/mo × 12 = ₦540,000 = 54,000,000 kobo
--   Premium  — ₦60,000/mo × 12 = ₦720,000 = 72,000,000 kobo
--
-- Deterministic UUIDs:
--   Plans use fixed UUIDs so re-runs are idempotent and entitlement rows
--   can reference them literally. Prefix "1000...0N" where N is the tier.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Plans
-- ----------------------------------------------------------------------------

insert into public.plans (
  id, code, name, description,
  currency, price_minor_units, billing_cycle_months, sort_order, status
) values
  (
    '10000000-0000-4000-8000-000000000001',
    'starter',
    'Starter',
    'For single-property estates with up to 2 gates and 100 units.',
    'NGN', 36000000, 12, 10, 'active'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'standard',
    'Standard',
    'For growing estates with up to 4 gates, 2 properties, and 250 units.',
    'NGN', 54000000, 12, 20, 'active'
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'premium',
    'Premium',
    'For large estates or multi-property portfolios with up to 8 gates and 500 units.',
    'NGN', 72000000, 12, 30, 'active'
  )
on conflict (id) do nothing;


-- ----------------------------------------------------------------------------
-- 2. Entitlements — 9 keys × 3 plans
-- ----------------------------------------------------------------------------
-- Values are jsonb. Shape per key:
--   max_properties, max_gates, max_guards, max_units,
--   max_household_members_per_unit, max_guest_pins_per_resident_per_day,
--   audit_retention_days                     -> integer
--   sms_notifications                        -> boolean
--   support_level                            -> string

insert into public.plan_entitlements (plan_id, entitlement_code, entitlement_value) values

  -- Starter
  ('10000000-0000-4000-8000-000000000001', 'max_properties',                        '1'::jsonb),
  ('10000000-0000-4000-8000-000000000001', 'max_gates',                             '2'::jsonb),
  ('10000000-0000-4000-8000-000000000001', 'max_guards',                            '4'::jsonb),
  ('10000000-0000-4000-8000-000000000001', 'max_units',                             '100'::jsonb),
  ('10000000-0000-4000-8000-000000000001', 'max_household_members_per_unit',        '10'::jsonb),
  ('10000000-0000-4000-8000-000000000001', 'max_guest_pins_per_resident_per_day',   '25'::jsonb),
  ('10000000-0000-4000-8000-000000000001', 'audit_retention_days',                  '90'::jsonb),
  ('10000000-0000-4000-8000-000000000001', 'sms_notifications',                     'false'::jsonb),
  ('10000000-0000-4000-8000-000000000001', 'support_level',                         '"email"'::jsonb),

  -- Standard
  ('10000000-0000-4000-8000-000000000002', 'max_properties',                        '2'::jsonb),
  ('10000000-0000-4000-8000-000000000002', 'max_gates',                             '4'::jsonb),
  ('10000000-0000-4000-8000-000000000002', 'max_guards',                            '10'::jsonb),
  ('10000000-0000-4000-8000-000000000002', 'max_units',                             '250'::jsonb),
  ('10000000-0000-4000-8000-000000000002', 'max_household_members_per_unit',        '20'::jsonb),
  ('10000000-0000-4000-8000-000000000002', 'max_guest_pins_per_resident_per_day',   '50'::jsonb),
  ('10000000-0000-4000-8000-000000000002', 'audit_retention_days',                  '180'::jsonb),
  ('10000000-0000-4000-8000-000000000002', 'sms_notifications',                     'false'::jsonb),
  ('10000000-0000-4000-8000-000000000002', 'support_level',                         '"email_whatsapp"'::jsonb),

  -- Premium
  ('10000000-0000-4000-8000-000000000003', 'max_properties',                        '5'::jsonb),
  ('10000000-0000-4000-8000-000000000003', 'max_gates',                             '8'::jsonb),
  ('10000000-0000-4000-8000-000000000003', 'max_guards',                            '25'::jsonb),
  ('10000000-0000-4000-8000-000000000003', 'max_units',                             '500'::jsonb),
  ('10000000-0000-4000-8000-000000000003', 'max_household_members_per_unit',        '50'::jsonb),
  ('10000000-0000-4000-8000-000000000003', 'max_guest_pins_per_resident_per_day',   '100'::jsonb),
  ('10000000-0000-4000-8000-000000000003', 'audit_retention_days',                  '365'::jsonb),
  ('10000000-0000-4000-8000-000000000003', 'sms_notifications',                     'true'::jsonb),
  ('10000000-0000-4000-8000-000000000003', 'support_level',                         '"priority"'::jsonb)

on conflict (plan_id, entitlement_code) do nothing;
