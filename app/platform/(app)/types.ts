/**
 * Platform owner dashboard types. Local to the platform surface.
 */

export type OrganizationRow = {
  id: string
  name: string
  display_name: string
  organization_type: string
  status: string
  created_at: string
}

export type SubscriptionRow = {
  id: string
  organization_id: string
  plan_id: string
  status: string
  current_period_start: string
  current_period_end: string
}

export type PlanRow = {
  id: string
  code: string
  name: string
  price_minor_units: number
}

export type PaymentRow = {
  id: string
  organization_id: string
  plan_id: string | null
  subscription_id: string | null
  purpose: string
  source: string
  provider: string
  provider_reference: string
  amount_minor_units: number
  currency: string
  status: string
  confirmed_at: string | null
  created_at: string
}

/**
 * Denormalized row for the payment queue and recent payments panels —
 * joins the raw PaymentRow with the org name, plan name, and calculated
 * age, so the client doesn't have to re-resolve those on render.
 */
export type PaymentDisplayRow = PaymentRow & {
  organization_name: string
  plan_name: string | null
}

/**
 * One row for the orgs list panel — the organization plus its current
 * operational subscription's plan and period end, if any.
 */
export type OrgDisplayRow = OrganizationRow & {
  plan_name: string | null
  period_end: string | null
}
