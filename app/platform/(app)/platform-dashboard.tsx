'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import type {
  PaymentDisplayRow,
  OrgDisplayRow,
} from './types'

/**
 * Platform owner dashboard — five panels, one write action.
 *
 * Panels:
 *   1. Overview stats     — counts + MRR
 *   2. Payment queue      — pending_confirmation rows + Confirm action
 *   3. Recent payments    — last 20, all statuses
 *   4. Organizations      — all orgs with plan + period end
 *   5. Recent signups     — new orgs in the last 30 days
 *
 * The only write is confirm_manual_payment (migration 0021) — a
 * SECURITY DEFINER function that flips a pending manual payment to
 * succeeded and creates the subscription. Idempotent. No new RPC.
 */

const ORGANIZATION_TYPE_LABEL: Record<string, string> = {
  residential: 'Residential',
  workplace: 'Workplace',
  other: 'Other',
}

export function PlatformDashboard({
  stats,
  pendingPayments,
  recentPayments,
  organizations,
  recentSignups,
  nowIso,
}: {
  stats: {
    totalOrgs: number
    activeOrgs: number
    provisioningOrgs: number
    suspendedOrgs: number
    pendingPaymentCount: number
    mrrKobo: number
  }
  pendingPayments: PaymentDisplayRow[]
  recentPayments: PaymentDisplayRow[]
  organizations: OrgDisplayRow[]
  recentSignups: OrgDisplayRow[]
  nowIso: string
}) {
  const router = useRouter()
  const [confirmTarget, setConfirmTarget] = useState<PaymentDisplayRow | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    if (!confirmTarget) return
    setError(null)
    setConfirming(true)
    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc('confirm_manual_payment', {
        p_payment_id: confirmTarget.id,
      })

      if (rpcError) {
        setError(friendlyError(rpcError.message))
        return
      }

      setConfirmTarget(null)
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-8">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Platform overview
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            All organizations, subscriptions, and payments.
          </p>
        </div>
      </header>

      {error ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive mb-4 rounded-md px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-4">
        <StatsPanel stats={stats} />
        <PaymentQueuePanel
          payments={pendingPayments}
          onConfirm={(p) => setConfirmTarget(p)}
          nowIso={nowIso}
        />
        <RecentPaymentsPanel payments={recentPayments} nowIso={nowIso} />
        <OrganizationsPanel organizations={organizations} nowIso={nowIso} />
        <RecentSignupsPanel signups={recentSignups} nowIso={nowIso} />
      </div>

      {confirmTarget ? (
        <ConfirmPaymentDialog
          payment={confirmTarget}
          confirming={confirming}
          onConfirm={() => void handleConfirm()}
          onClose={() => setConfirmTarget(null)}
        />
      ) : null}
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

function StatsPanel({
  stats,
}: {
  stats: {
    totalOrgs: number
    activeOrgs: number
    provisioningOrgs: number
    suspendedOrgs: number
    pendingPaymentCount: number
    mrrKobo: number
  }
}) {
  const cells = [
    { label: 'Total orgs', value: stats.totalOrgs.toString() },
    { label: 'Active', value: stats.activeOrgs.toString() },
    { label: 'Provisioning', value: stats.provisioningOrgs.toString() },
    { label: 'Suspended', value: stats.suspendedOrgs.toString() },
    {
      label: 'MRR (₦)',
      value: formatMoney(stats.mrrKobo, 'NGN'),
    },
    {
      label: 'Payments pending',
      value: stats.pendingPaymentCount.toString(),
      highlight: stats.pendingPaymentCount > 0,
    },
  ]

  return (
    <Panel title="Overview">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cells.map((c) => (
          <div
            key={c.label}
            className="bg-background flex flex-col gap-1 rounded-md border px-3 py-3"
          >
            <span className="text-2xl font-semibold tracking-tight">
              {c.value}
            </span>
            <span
              className={
                'text-xs ' +
                (c.highlight
                  ? 'text-amber-700 dark:text-amber-400 font-medium'
                  : 'text-muted-foreground')
              }
            >
              {c.label}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function PaymentQueuePanel({
  payments,
  onConfirm,
  nowIso,
}: {
  payments: PaymentDisplayRow[]
  onConfirm: (p: PaymentDisplayRow) => void
  nowIso: string
}) {
  return (
    <Panel title="Payment queue">
      {payments.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No payments awaiting confirmation.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {payments.map((p) => (
            <li
              key={p.id}
              className="bg-background flex flex-col gap-2 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {p.organization_name}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {formatMoney(p.amount_minor_units, p.currency)} ·{' '}
                  {p.plan_name ?? '—'} · ref {p.provider_reference}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Initiated {formatAbsolute(new Date(p.created_at), new Date(nowIso))}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => onConfirm(p)}
                className="shrink-0"
              >
                Confirm
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function RecentPaymentsPanel({
  payments,
  nowIso,
}: {
  payments: PaymentDisplayRow[]
  nowIso: string
}) {
  return (
    <Panel title="Recent payments">
      {payments.length === 0 ? (
        <p className="text-muted-foreground text-sm">No payments yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {payments.map((p) => (
            <li
              key={p.id}
              className="bg-background flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {p.organization_name} ·{' '}
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
  )
}

function OrganizationsPanel({
  organizations,
  nowIso,
}: {
  organizations: OrgDisplayRow[]
  nowIso: string
}) {
  return (
    <Panel title="Organizations">
      {organizations.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No organizations yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {organizations.map((o) => (
            <li key={o.id}>
              <Link
                href={`/platform/orgs/${o.id}`}
                className="bg-background hover:bg-muted/40 flex flex-col gap-2 rounded-md border px-3 py-2 transition-colors sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {o.display_name}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {ORGANIZATION_TYPE_LABEL[o.organization_type] ??
                      o.organization_type}{' '}
                    · Created {formatAbsolute(new Date(o.created_at), new Date(nowIso))}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-muted-foreground text-xs">
                    {o.plan_name ?? '—'}
                    {o.period_end
                      ? ` · until ${formatDate(new Date(o.period_end))}`
                      : ''}
                  </span>
                  <span className={statusClass(o.status)}>{o.status}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function RecentSignupsPanel({
  signups,
  nowIso,
}: {
  signups: OrgDisplayRow[]
  nowIso: string
}) {
  return (
    <Panel title="Recent signups (last 30 days)">
      {signups.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No new organizations in the last 30 days.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {signups.map((o) => (
            <li
              key={o.id}
              className="bg-background flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {o.display_name}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {formatAbsolute(new Date(o.created_at), new Date(nowIso))}
                  {o.plan_name ? ` · ${o.plan_name}` : ' · no plan yet'}
                </p>
              </div>
              <span className={statusClass(o.status)}>{o.status}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function ConfirmPaymentDialog({
  payment,
  confirming,
  onConfirm,
  onClose,
}: {
  payment: PaymentDisplayRow
  confirming: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div className="bg-background relative w-full max-w-md rounded-lg border p-5 shadow-lg">
        <h3 className="text-lg font-semibold tracking-tight">
          Confirm payment?
        </h3>
        <p className="text-muted-foreground mt-2 text-sm">
          Confirm that{' '}
          <strong className="text-foreground">
            {formatMoney(payment.amount_minor_units, payment.currency)}
          </strong>{' '}
          from <strong className="text-foreground">{payment.organization_name}</strong>{' '}
          (ref {payment.provider_reference}) has landed. This activates the
          subscription for this organization immediately.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={confirming}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={confirming}
          >
            {confirming ? 'Confirming…' : 'Confirm payment'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
      return base + 'bg-blue-500/15 text-blue-800 dark:text-blue-300'
    case 'suspended':
      return base + 'bg-destructive/15 text-destructive'
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

function friendlyError(code: string): string {
  if (code.includes('NOT_AUTHENTICATED')) return 'Your session expired. Please sign in again.'
  if (code.includes('NOT_PLATFORM_ADMIN')) return "You don't have platform admin access."
  if (code.includes('PAYMENT_NOT_FOUND')) return 'Payment not found.'
  if (code.includes('NOT_MANUAL_PAYMENT')) return 'Only manual payments can be confirmed here.'
  if (code.includes('PAYMENT_NOT_PENDING')) return 'This payment is no longer awaiting confirmation.'
  return 'Could not confirm the payment. Please try again.'
}
