/**
 * Billing page types. Mirrors the row shapes returned by the queries in
 * page.tsx. Local to the billing surface — no cross-feature sharing.
 */

export type SubscriptionStatus =
  | 'trial'
  | 'active'
  | 'past_due'
  | 'grace_period'
  | 'suspended'
  | 'cancelled'
  | 'expired'
  | 'superseded'

export type SubscriptionRow = {
  id: string
  plan_id: string
  status: SubscriptionStatus
  current_period_start: string
  current_period_end: string
  cancelled_at: string | null
}

export type PlanRow = {
  id: string
  code: string
  name: string
  description: string | null
  currency: string
  price_minor_units: number
  billing_cycle_months: number
}

export type EntitlementRow = {
  entitlement_code: string
  entitlement_value: unknown
}

export type PaymentRow = {
  id: string
  amount_minor_units: number
  currency: string
  status: string
  purpose: string
  provider: string
  provider_reference: string
  created_at: string
  confirmed_at: string | null
}

export type UsageCount = {
  used: number
  max: number
}
