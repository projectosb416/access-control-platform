import { createClient } from '@/lib/supabase/server'
import { PlatformDashboard } from './platform-dashboard'
import type {
  OrganizationRow,
  SubscriptionRow,
  PlanRow,
  PaymentRow,
  PaymentDisplayRow,
  OrgDisplayRow,
} from './types'

/**
 * /platform — platform owner dashboard.
 *
 * Server Component. Five panels, all reads parallel:
 *
 *   1. Overview stats       — orgs by status, MRR, pending payments
 *   2. Payment queue        — pending_confirmation manual payments
 *   3. Recent payments      — last 20 across all tenants
 *   4. Organizations        — all orgs with current plan
 *   5. Recent signups       — orgs created in last 30 days
 *
 * RLS: all reads are permitted by the platform-admin policies on
 * organizations (0063), subscriptions (0019), payment_transactions
 * (0020). No RPC needed.
 */

const SIGNUP_WINDOW_DAYS = 30

export default async function PlatformHomePage() {
  const supabase = await createClient()

  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now()
  const signupCutoffIso = new Date(
    nowMs - SIGNUP_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  const [
    orgsRes,
    subscriptionsRes,
    plansRes,
    pendingRes,
    recentPaymentsRes,
  ] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, name, display_name, organization_type, status, created_at')
      .order('created_at', { ascending: false }),

    supabase
      .from('subscriptions')
      .select('id, organization_id, plan_id, status, current_period_start, current_period_end')
      .in('status', ['trial', 'active', 'past_due', 'grace_period']),

    supabase.from('plans').select('id, code, name, price_minor_units'),

    supabase
      .from('payment_transactions')
      .select('id, organization_id, plan_id, subscription_id, purpose, source, provider, provider_reference, amount_minor_units, currency, status, confirmed_at, created_at')
      .eq('status', 'pending_confirmation')
      .eq('source', 'manual')
      .order('created_at', { ascending: true }),

    supabase
      .from('payment_transactions')
      .select('id, organization_id, plan_id, subscription_id, purpose, source, provider, provider_reference, amount_minor_units, currency, status, confirmed_at, created_at')
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const organizations = (orgsRes.data ?? []) as OrganizationRow[]
  const subscriptions = (subscriptionsRes.data ?? []) as SubscriptionRow[]
  const plans = (plansRes.data ?? []) as PlanRow[]
  const pendingRaw = (pendingRes.data ?? []) as PaymentRow[]
  const recentRaw = (recentPaymentsRes.data ?? []) as PaymentRow[]

  // ---- Lookups --------------------------------------------------------
  const orgNameById = new Map(organizations.map((o) => [o.id, o.display_name]))
  const planById = new Map(plans.map((p) => [p.id, p]))
  const planByIdForSubscription = new Map(subscriptions.map((s) => [s.organization_id, s]))

  // ---- Payment display rows -------------------------------------------
  const decoratePayment = (p: PaymentRow): PaymentDisplayRow => ({
    ...p,
    organization_name: orgNameById.get(p.organization_id) ?? '—',
    plan_name: p.plan_id ? (planById.get(p.plan_id)?.name ?? null) : null,
  })

  const pendingPayments = pendingRaw.map(decoratePayment)
  const recentPayments = recentRaw.map(decoratePayment)

  // ---- Org display rows -----------------------------------------------
  const orgDisplay: OrgDisplayRow[] = organizations.map((o) => {
    const sub = planByIdForSubscription.get(o.id)
    const planName = sub ? (planById.get(sub.plan_id)?.name ?? null) : null
    return {
      ...o,
      plan_name: planName,
      period_end: sub ? sub.current_period_end : null,
    }
  })

  // ---- Stats ----------------------------------------------------------
  const totalOrgs = organizations.length
  const activeOrgs = organizations.filter((o) => o.status === 'active').length
  const provisioningOrgs = organizations.filter((o) => o.status === 'provisioning').length
  const suspendedOrgs = organizations.filter((o) => o.status === 'suspended').length
  const pendingPaymentCount = pendingPayments.length

  // MRR equivalent — sum of annual plan prices / 12, over operational subs
  let mrrKobo = 0
  for (const s of subscriptions) {
    const plan = planById.get(s.plan_id)
    if (!plan) continue
    // plan.price_minor_units is total per 12-month cycle
    // monthly equivalent = price / 12
    mrrKobo += Math.round(plan.price_minor_units / 12)
  }

  // ---- Signups in window ----------------------------------------------
  const recentSignups = organizations.filter(
    (o) => o.created_at >= signupCutoffIso,
  )

  return (
    <PlatformDashboard
      stats={{
        totalOrgs,
        activeOrgs,
        provisioningOrgs,
        suspendedOrgs,
        pendingPaymentCount,
        mrrKobo,
      }}
      pendingPayments={pendingPayments}
      recentPayments={recentPayments}
      organizations={orgDisplay}
      recentSignups={recentSignups.map((o) => ({
        ...o,
        plan_name: planById.get(planByIdForSubscription.get(o.id)?.plan_id ?? '')?.name ?? null,
        period_end: planByIdForSubscription.get(o.id)?.current_period_end ?? null,
      }))}
      nowIso={new Date(nowMs).toISOString()}
    />
  )
}
