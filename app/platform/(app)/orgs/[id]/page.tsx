import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

/**
 * /platform/orgs/[id] — per-organization drill-down.
 *
 * Server Component only. No interactivity — reads org, its current
 * subscription, its plan, recent payments, and recent audit events.
 *
 * All reads permitted by platform-admin RLS policies (verified in
 * STEP B1): organizations, subscriptions, payment_transactions,
 * audit_events, plans.
 *
 * Not rendered in v1: actor resolution (requires reading accounts,
 * which has no platform-admin policy), audit metadata (per-event
 * drill-down is a future slice), subscription history beyond the
 * current operational row.
 */

type OrgRow = {
  id: string
  name: string
  display_name: string
  organization_type: string
  status: string
  created_at: string
}

type SubRow = {
  id: string
  plan_id: string
  status: string
  current_period_start: string
  current_period_end: string
}

type PlanRow = {
  id: string
  code: string
  name: string
  price_minor_units: number
  currency: string
  billing_cycle_months: number
}

type PaymentRow = {
  id: string
  amount_minor_units: number
  currency: string
  status: string
  purpose: string
  provider: string
  provider_reference: string
  created_at: string
}

type AuditRow = {
  id: string
  action: string
  target_type: string
  target_id: string | null
  reason: string | null
  recorded_at: string
}

const MAX_PAYMENTS = 20
const MAX_AUDIT = 50

export default async function OrgDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [orgRes, subRes, payRes, auditRes] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, name, display_name, organization_type, status, created_at')
      .eq('id', id)
      .maybeSingle(),

    supabase
      .from('subscriptions')
      .select('id, plan_id, status, current_period_start, current_period_end')
      .eq('organization_id', id)
      .order('current_period_end', { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from('payment_transactions')
      .select('id, amount_minor_units, currency, status, purpose, provider, provider_reference, created_at')
      .eq('organization_id', id)
      .order('created_at', { ascending: false })
      .limit(MAX_PAYMENTS),

    supabase
      .from('audit_events')
      .select('id, action, target_type, target_id, reason, recorded_at')
      .eq('organization_id', id)
      .order('recorded_at', { ascending: false })
      .limit(MAX_AUDIT),
  ])

  const org = orgRes.data as OrgRow | null
  if (!org) {
    notFound()
  }

  const subscription = subRes.data as SubRow | null
  const payments = (payRes.data ?? []) as PaymentRow[]
  const auditEvents = (auditRes.data ?? []) as AuditRow[]

  // Fetch the plan if there is a subscription.
  let plan: PlanRow | null = null
  if (subscription) {
    const { data: planRow } = await supabase
      .from('plans')
      .select('id, code, name, price_minor_units, currency, billing_cycle_months')
      .eq('id', subscription.plan_id)
      .maybeSingle()
    plan = planRow as PlanRow | null
  }

  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-8">
      <nav className="mb-6">
        <Link
          href="/platform"
          className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
        >
          ← Back to overview
        </Link>
      </nav>

      <header className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {org.display_name}
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              {orgTypeLabel(org.organization_type)} · Created{' '}
              {formatDate(new Date(org.created_at))}
            </p>
          </div>
          <span className={statusClass(org.status)}>{org.status}</span>
        </div>
      </header>

      <div className="flex flex-col gap-4">
        <SubscriptionPanel
          subscription={subscription}
          plan={plan}
        />

        <Panel title={`Recent payments (last ${MAX_PAYMENTS})`}>
          {payments.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No payments for this organization.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {payments.map((p) => (
                <li
                  key={p.id}
                  className="bg-background flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {formatMoney(p.amount_minor_units, p.currency)}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {p.purpose} · {p.provider} · {p.provider_reference} ·{' '}
                      {formatAbsolute(new Date(p.created_at), new Date(nowIso))}
                    </p>
                  </div>
                  <span className={paymentStatusClass(p.status)}>
                    {p.status.replace(/_/g, ' ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`Recent activity (last ${MAX_AUDIT})`}>
          {auditEvents.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No audit events for this organization.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {auditEvents.map((e) => (
                <li
                  key={e.id}
                  className="bg-background flex flex-col gap-1 rounded-md border px-3 py-2"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-mono text-sm">
                      {e.action}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {formatAbsolute(new Date(e.recorded_at), new Date(nowIso))}
                    </span>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    <span className="font-medium">target</span> {e.target_type}
                    {e.target_id ? ` · ${shortId(e.target_id)}` : ''}
                  </p>
                  {e.reason ? (
                    <p className="text-muted-foreground truncate text-xs">
                      {e.reason}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function Panel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-muted/40 rounded-lg border p-5">
      <h2 className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wide">
        {title}
      </h2>
      {children}
    </section>
  )
}

function SubscriptionPanel({
  subscription,
  plan,
}: {
  subscription: SubRow | null
  plan: PlanRow | null
}) {
  return (
    <Panel title="Current subscription">
      {!subscription ? (
        <p className="text-muted-foreground text-sm">
          No subscription for this organization.
        </p>
      ) : (
        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Plan</span>
            <span className="font-medium">{plan?.name ?? '—'}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Status</span>
            <span className={statusClass(subscription.status)}>
              {subscription.status.replace(/_/g, ' ')}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Period ends</span>
            <span className="font-medium">
              {formatDate(new Date(subscription.current_period_end))}
            </span>
          </div>
          {plan ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Annual price</span>
              <span className="font-medium">
                {formatMoney(plan.price_minor_units, plan.currency)}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function orgTypeLabel(t: string): string {
  const map: Record<string, string> = {
    residential: 'Residential',
    workplace: 'Workplace',
    other: 'Other',
  }
  return map[t] ?? t
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}

function formatMoney(minorUnits: number, currency: string): string {
  const major = minorUnits / 100
  const symbol = currency === 'NGN' ? '₦' : currency === 'USD' ? '$' : ''
  return `${symbol}${major.toLocaleString('en-US')}`
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function formatDate(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

function formatAbsolute(d: Date, now: Date): string {
  const sameDay =
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()

  if (sameDay) return `today at ${formatTimeUTC(d)}`

  const yesterday = new Date(now)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const isYesterday =
    d.getUTCFullYear() === yesterday.getUTCFullYear() &&
    d.getUTCMonth() === yesterday.getUTCMonth() &&
    d.getUTCDate() === yesterday.getUTCDate()

  if (isYesterday) return `yesterday at ${formatTimeUTC(d)}`

  return `${formatDate(d)} at ${formatTimeUTC(d)}`
}

function formatTimeUTC(d: Date): string {
  const h24 = d.getUTCHours()
  const m = d.getUTCMinutes().toString().padStart(2, '0')
  const period = h24 >= 12 ? 'PM' : 'AM'
  const h12 = ((h24 + 11) % 12) + 1
  return `${h12}:${m} ${period}`
}

function statusClass(status: string): string {
  const base =
    'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide '
  switch (status) {
    case 'active':
      return base + 'bg-emerald-600/15 text-emerald-800 dark:text-emerald-300'
    case 'provisioning':
    case 'trial':
      return base + 'bg-blue-500/15 text-blue-800 dark:text-blue-300'
    case 'suspended':
    case 'past_due':
      return base + 'bg-destructive/15 text-destructive'
    case 'grace_period':
      return base + 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
    default:
      return base + 'bg-muted text-muted-foreground'
  }
}

function paymentStatusClass(status: string): string {
  const base =
    'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide '
  switch (status) {
    case 'succeeded':
      return base + 'bg-emerald-600/15 text-emerald-800 dark:text-emerald-300'
    case 'pending_confirmation':
      return base + 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
    case 'failed':
    case 'chargeback':
      return base + 'bg-destructive/15 text-destructive'
    case 'refunded':
    case 'partially_refunded':
      return base + 'bg-blue-500/15 text-blue-800 dark:text-blue-300'
    default:
      return base + 'bg-muted text-muted-foreground'
  }
}
