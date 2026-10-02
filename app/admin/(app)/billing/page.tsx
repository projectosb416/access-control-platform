import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { BillingClient } from './billing-client'
import type {
  SubscriptionRow,
  PlanRow,
  EntitlementRow,
  PaymentRow,
  UsageCount,
} from './types'

/**
 * /admin/billing — subscription, usage, entitlements, payment history.
 *
 * Server Component. Reads from subscriptions, plans, plan_entitlements,
 * payment_transactions (all RLS-permitted for org admins), plus usage
 * counts from gates, guard_profiles, units, properties.
 *
 * The only client interaction is the cancel confirm dialog — everything
 * else is read-only rendering.
 */

const COUNTABLE_KEYS = [
  { code: 'max_properties', table: 'properties', label: 'Properties' },
  { code: 'max_gates',      table: 'gates',      label: 'Gates' },
  { code: 'max_guards',     table: 'guard_profiles', label: 'Guards' },
  { code: 'max_units',      table: 'units',      label: 'Units' },
] as const

export default async function BillingPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/admin/login')
  }

  const { data: membership } = await supabase
    .from('organization_memberships')
    .select('organization_id')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (!membership) {
    redirect('/admin/setup')
  }

  const organizationId = membership.organization_id as string

  // ---- Subscription: prefer operational; fall back to most recent ----
  const { data: operational } = await supabase
    .from('subscriptions')
    .select('id, plan_id, status, current_period_start, current_period_end, cancelled_at')
    .eq('organization_id', organizationId)
    .in('status', ['trial', 'active', 'past_due', 'grace_period'])
    .order('current_period_end', { ascending: false })
    .limit(1)
    .maybeSingle()

  let subscription: SubscriptionRow | null = null
  if (operational) {
    subscription = operational as SubscriptionRow
  } else {
    // No operational row — show the most recent historical one for context.
    const { data: latest } = await supabase
      .from('subscriptions')
      .select('id, plan_id, status, current_period_start, current_period_end, cancelled_at')
      .eq('organization_id', organizationId)
      .order('current_period_end', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (latest) subscription = latest as SubscriptionRow
  }

  // ---- Plan + entitlements (only if a subscription exists) ----
  let plan: PlanRow | null = null
  let entitlements: EntitlementRow[] = []

  if (subscription) {
    const { data: planRow } = await supabase
      .from('plans')
      .select('id, code, name, description, currency, price_minor_units, billing_cycle_months')
      .eq('id', subscription.plan_id)
      .maybeSingle()

    if (planRow) plan = planRow as PlanRow

    const { data: ents } = await supabase
      .from('plan_entitlements')
      .select('entitlement_code, entitlement_value')
      .eq('plan_id', subscription.plan_id)

    entitlements = (ents ?? []) as EntitlementRow[]
  }

  // ---- Usage counts ----
  const usage: Record<string, UsageCount> = {}

  const [{ count: propertiesCount }, { count: gatesCount }, { count: guardsCount }, { count: unitsCount }] =
    await Promise.all([
      supabase
        .from('properties')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('status', 'active'),
      supabase
        .from('gates')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('status', 'active'),
      supabase
        .from('guard_profiles')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('status', 'active'),
      supabase
        .from('units')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'active')
        .in(
          'property_id',
          (
            await supabase
              .from('properties')
              .select('id')
              .eq('organization_id', organizationId)
          ).data?.map((p) => (p as { id: string }).id) ?? ['00000000-0000-0000-0000-000000000000'],
        ),
    ])

  const counts: Record<string, number> = {
    max_properties: propertiesCount ?? 0,
    max_gates: gatesCount ?? 0,
    max_guards: guardsCount ?? 0,
    max_units: unitsCount ?? 0,
  }

  for (const { code } of COUNTABLE_KEYS) {
    const ent = entitlements.find((e) => e.entitlement_code === code)
    const max = typeof ent?.entitlement_value === 'number' ? ent.entitlement_value : 0
    usage[code] = { used: counts[code] ?? 0, max }
  }

  // ---- Payment history (last 10) ----
  const { data: paymentsRaw } = await supabase
    .from('payment_transactions')
    .select('id, amount_minor_units, currency, status, purpose, provider, provider_reference, created_at, confirmed_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(10)

  const payments = (paymentsRaw ?? []) as PaymentRow[]

  return (
    <BillingClient
      organizationId={organizationId}
      subscription={subscription}
      plan={plan}
      entitlements={entitlements}
      usage={usage}
      payments={payments}
      countableLabels={Object.fromEntries(COUNTABLE_KEYS.map((k) => [k.code, k.label]))}
    />
  )
}
