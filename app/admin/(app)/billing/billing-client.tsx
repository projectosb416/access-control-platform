'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import type {
  SubscriptionRow,
  PlanRow,
  EntitlementRow,
  PaymentRow,
  UsageCount,
} from './types'

/**
 * Billing client component. Renders the plan card, usage grid,
 * entitlements table, payment history, and a cancel-subscription
 * confirm dialog.
 *
 * The only write path is cancel_subscription (migration 0059). All
 * other content is read-only rendering.
 *
 * Cancellation is immediate per 0059: no new tenant activity, but
 * existing shifts, valid PINs, and household-member credentials keep
 * working. That's why the confirm dialog copy is honest — "ends your
 * access immediately" — rather than implying period-end cancellation.
 */

const OPERATIONAL_STATUSES = new Set([
  'trial',
  'active',
  'past_due',
  'grace_period',
])

export function BillingClient({
  organizationId,
  subscription,
  plan,
  entitlements,
  usage,
  payments,
  countableLabels,
}: {
  organizationId: string
  subscription: SubscriptionRow
  plan: PlanRow | null
  entitlements: EntitlementRow[]
  usage: Record<string, UsageCount>
  payments: PaymentRow[]
  countableLabels: Record<string, string>
}) {
  const router = useRouter()

  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOperational = subscription
    ? OPERATIONAL_STATUSES.has(subscription.status)
    : false

  async function handleCancel() {
    setError(null)
    setCancelling(true)
    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc('cancel_subscription', {
        p_organization_id: organizationId,
        p_reason: 'cancelled by admin via billing page',
      })

      if (rpcError) {
        setError(friendlyError(rpcError.message))
        return
      }

      setCancelOpen(false)
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your subscription, usage, and payment history.
        </p>
      </header>

      {error ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive mb-4 rounded-md px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-6">
          <StatusBanner status={subscription.status} />

          {plan ? (
            <PlanCard
              plan={plan}
              subscription={subscription}
              isOperational={isOperational}
            />
          ) : null}

          <UsageSection
            usage={usage}
            countableLabels={countableLabels}
          />

          <EntitlementsSection entitlements={entitlements} />

          <PaymentsSection payments={payments} />

          {isOperational ? (
            <section className="border-destructive/30 mt-2 rounded-lg border p-5">
              <h2 className="text-base font-medium">Cancel subscription</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Cancelling ends your access immediately. Unused time is not
                refunded. Gates stay operational for existing shifts and
                valid PINs keep working — but you won&apos;t be able to
                create new shifts, people, or authorizations.
              </p>
              <Button
                type="button"
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10 mt-4"
                onClick={() => setCancelOpen(true)}
              >
                Cancel subscription
              </Button>
            </section>
          ) : null}
      </div>

      {cancelOpen ? (
        <ConfirmCancel
          cancelling={cancelling}
          onConfirm={() => void handleCancel()}
          onClose={() => setCancelOpen(false)}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------

function StatusBanner({ status }: { status: string }) {
  const config: Record<string, { tone: string; title: string; body: string }> = {
    active: {
      tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200',
      title: 'Active',
      body: 'Your subscription is current.',
    },
    trial: {
      tone: 'border-blue-500/30 bg-blue-500/10 text-blue-900 dark:text-blue-200',
      title: 'Trial',
      body: 'Your trial subscription is active.',
    },
    past_due: {
      tone: 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200',
      title: 'Past due',
      body: 'A payment is overdue. Please contact support.',
    },
    grace_period: {
      tone: 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200',
      title: 'Grace period',
      body: 'Your subscription is in a grace period.',
    },
    suspended: {
      tone: 'border-destructive/30 bg-destructive/10 text-destructive',
      title: 'Suspended',
      body: 'Your subscription is suspended. Contact support to reactivate.',
    },
    cancelled: {
      tone: 'border-muted bg-muted/40 text-muted-foreground',
      title: 'Cancelled',
      body: 'Your subscription is cancelled. No new activity can be created.',
    },
    expired: {
      tone: 'border-muted bg-muted/40 text-muted-foreground',
      title: 'Expired',
      body: 'Your subscription period ended. Contact support to renew.',
    },
    superseded: {
      tone: 'border-muted bg-muted/40 text-muted-foreground',
      title: 'Superseded',
      body: 'This subscription was replaced by a newer one.',
    },
  }

  const c = config[status] ?? {
    tone: 'border-muted bg-muted/40 text-muted-foreground',
    title: status,
    body: 'Unknown subscription state.',
  }

  return (
    <section className={`rounded-lg border p-4 ${c.tone}`}>
      <p className="text-sm font-medium">{c.title}</p>
      <p className="mt-0.5 text-xs opacity-80">{c.body}</p>
    </section>
  )
}

function PlanCard({
  plan,
  subscription,
  isOperational,
}: {
  plan: PlanRow
  subscription: SubscriptionRow
  isOperational: boolean
}) {
  const monthly = plan.price_minor_units / plan.billing_cycle_months
  const priceLabel = formatMoney(monthly, plan.currency)
  const totalLabel = formatMoney(plan.price_minor_units, plan.currency)

  return (
    <section className="bg-muted/40 rounded-lg border p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            Current plan
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">
            {plan.name}
          </h2>
          {plan.description ? (
            <p className="text-muted-foreground mt-1 text-sm">
              {plan.description}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Price</span>
          <span className="font-medium">
            {priceLabel} / month · {totalLabel} + VAT per year
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">
            {isOperational ? 'Renews' : 'Period ended'}
          </span>
          <span className="font-medium">
            {formatDate(subscription.current_period_end)}
          </span>
        </div>
      </div>
    </section>
  )
}

function UsageSection({
  usage,
  countableLabels,
}: {
  usage: Record<string, UsageCount>
  countableLabels: Record<string, string>
}) {
  const entries = Object.entries(usage)

  return (
    <section className="bg-muted/40 rounded-lg border p-5">
      <h2 className="mb-3 text-base font-medium">Usage</h2>
      <div className="flex flex-col gap-2">
        {entries.map(([code, { used, max }]) => {
          const pct = max > 0 ? used / max : 0
          const warning = pct >= 0.8
          const over = max > 0 && used >= max
          return (
            <div
              key={code}
              className="bg-background flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <span className="text-sm">
                {countableLabels[code] ?? code}
              </span>
              <span
                className={
                  'text-xs font-medium ' +
                  (over
                    ? 'text-destructive'
                    : warning
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-muted-foreground')
                }
              >
                {used} of {max}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function EntitlementsSection({
  entitlements,
}: {
  entitlements: EntitlementRow[]
}) {
  if (entitlements.length === 0) return null

  // Sort deterministically: countable keys first (already in Usage),
  // then the rest alphabetically.
  const countable = new Set([
    'max_properties',
    'max_gates',
    'max_guards',
    'max_units',
  ])
  const rest = entitlements
    .filter((e) => !countable.has(e.entitlement_code))
    .sort((a, b) => a.entitlement_code.localeCompare(b.entitlement_code))

  return (
    <section className="bg-muted/40 rounded-lg border p-5">
      <h2 className="mb-3 text-base font-medium">Plan features</h2>
      <div className="flex flex-col gap-2">
        {rest.map((e) => (
          <div
            key={e.entitlement_code}
            className="bg-background flex items-center justify-between gap-3 rounded-md border px-3 py-2"
          >
            <span className="text-sm">{prettyLabel(e.entitlement_code)}</span>
            <span className="text-muted-foreground text-xs font-medium">
              {formatValue(e.entitlement_value)}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function PaymentsSection({ payments }: { payments: PaymentRow[] }) {
  return (
    <section className="bg-muted/40 rounded-lg border p-5">
      <h2 className="mb-3 text-base font-medium">Payment history</h2>
      {payments.length === 0 ? (
        <p className="text-muted-foreground text-sm">No payments yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {payments.map((p) => (
            <li
              key={p.id}
              className="bg-background flex items-start justify-between gap-3 rounded-md border px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {formatMoney(p.amount_minor_units, p.currency)}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {p.purpose} · {p.provider} · {p.provider_reference}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {formatDate(p.created_at)}
                </p>
              </div>
              <span className={paymentStatusClass(p.status)}>
                {p.status.replace(/_/g, ' ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ConfirmCancel({
  cancelling,
  onConfirm,
  onClose,
}: {
  cancelling: boolean
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
          Cancel your subscription?
        </h3>
        <p className="text-muted-foreground mt-2 text-sm">
          This ends your access immediately. Unused time is not refunded.
          Existing shifts and valid PINs continue to work, but you won&apos;t
          be able to create new shifts, people, or authorizations. Contact
          support to reactivate.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={cancelling}
          >
            Keep subscription
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={cancelling}
            className="bg-destructive hover:bg-destructive/90 text-white"
          >
            {cancelling ? 'Cancelling…' : 'Cancel subscription'}
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

function formatDate(iso: string): string {
  const d = new Date(iso)
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`
}

function prettyLabel(code: string): string {
  const map: Record<string, string> = {
    max_household_members_per_unit: 'Household members per unit',
    max_guest_pins_per_resident_per_day: 'Guest PINs per resident per day',
    audit_retention_days: 'Audit retention',
    sms_notifications: 'SMS notifications',
    support_level: 'Support level',
  }
  if (map[code]) return map[code]
  return code
    .replace(/^max_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatValue(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') {
    if (v === 365 || v === 180 || v === 90) return `${v} days`
    return v.toLocaleString('en-US')
  }
  if (typeof v === 'string') return v.replace(/_/g, ' ')
  return String(v)
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
  if (code.includes('NOT_AUTHENTICATED')) return 'Your session expired. Please log in again.'
  if (code.includes('NOT_AUTHORIZED')) return "You don't have permission to do that."
  if (code.includes('NO_ACTIVE_SUBSCRIPTION')) return 'No active subscription to cancel.'
  return 'Something went wrong. Please try again.'
}
