'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

/**
 * "Choose a plan" surface for an org that has no operational
 * subscription. Renders three plan cards; clicking one opens a dialog
 * that calls record_manual_payment_intent and displays the BT
 * reference + the active bank destination's details for the customer
 * to transfer against.
 *
 * The destination is read server-side and passed as a prop. If null,
 * the flow is disabled — a customer cannot pay without somewhere to
 * send money.
 *
 * After the RPC returns, the payment row exists with
 * status='pending_confirmation'. It shows up on the platform
 * dashboard's payment queue. Platform owner confirms via the existing
 * Confirm action; the subscription then activates and the admin's
 * next page load shows the operational plan.
 */

export type PlanOption = {
  id: string
  code: string
  name: string
  description: string | null
  price_minor_units: number
  currency: string
  billing_cycle_months: number
}

export type ActiveDestination = {
  id: string
  business_name: string | null
  bank_name: string | null
  bank_account_name: string | null
  bank_account_number: string | null
  bank_transfer_note: string | null
}

type Stage = 'closed' | 'confirm' | 'transfer'

type PaymentResult = {
  paymentId: string
  reference: string
  amountMinorUnits: number
  currency: string
}

export function ChoosePlan({
  organizationId,
  plans,
  activeDestination,
}: {
  organizationId: string
  plans: PlanOption[]
  activeDestination: ActiveDestination | null
}) {
  const router = useRouter()

  const [stage, setStage] = useState<Stage>('closed')
  const [selectedPlan, setSelectedPlan] = useState<PlanOption | null>(null)
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [paystackLoading, setPaystackLoading] = useState(false)

  const payDisabled = activeDestination === null
  const bankTransferAvailable = activeDestination !== null

  function openConfirm(plan: PlanOption) {
    setSelectedPlan(plan)
    setPaymentResult(null)
    setError(null)
    setStage('confirm')
  }

  function closeDialog() {
    if (submitting) return
    setStage('closed')
    setSelectedPlan(null)
    setPaymentResult(null)
    setError(null)
    setCopied(null)
  }

  async function handlePayOnline() {
    if (!selectedPlan) return
    setError(null)
    setPaystackLoading(true)
    try {
      const res = await fetch('/api/paystack/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: organizationId,
          plan_id: selectedPlan.id,
          purpose: 'initial',
        }),
      })

      const payload = (await res.json().catch(() => null)) as
        | { authorization_url?: string; code?: string }
        | null

      if (!res.ok) {
        setError(friendlyError(payload?.code ?? 'SYSTEM_UNAVAILABLE'))
        setPaystackLoading(false)
        return
      }

      if (!payload?.authorization_url) {
        setError('Could not start the payment. Please try again.')
        setPaystackLoading(false)
        return
      }

      // Redirects the browser; the component unmounts on navigation.
      window.location.href = payload.authorization_url
    } catch {
      setError('Could not start the payment. Please try again.')
      setPaystackLoading(false)
    }
  }

  async function handleGetReference() {
    if (!selectedPlan) return
    setError(null)
    setSubmitting(true)
    try {
      const supabase = createClient()
      const { data, error: rpcError } = await supabase.rpc(
        'record_manual_payment_intent',
        {
          p_organization_id: organizationId,
          p_plan_id: selectedPlan.id,
          p_purpose: 'initial',
          p_destination_id: activeDestination?.id ?? null,
        },
      )

      if (rpcError) {
        setError(friendlyError(rpcError.message))
        return
      }

      const row = Array.isArray(data) ? data[0] : data
      if (
        !row ||
        typeof row.payment_id !== 'string' ||
        typeof row.reference !== 'string' ||
        typeof row.amount_minor_units !== 'number'
      ) {
        setError('Could not start the payment. Please try again.')
        return
      }

      setPaymentResult({
        paymentId: row.payment_id,
        reference: row.reference,
        amountMinorUnits: row.amount_minor_units,
        currency: row.currency ?? selectedPlan.currency,
      })
      setStage('transfer')
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function copyField(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    } catch {
      // Clipboard unavailable — value visible for manual entry.
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="mb-2">
        <h2 className="text-lg font-semibold tracking-tight">
          Choose a plan
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Pick a tier, get a payment reference, and transfer the amount
          to the account shown. Your subscription activates once we
          confirm the payment.
        </p>
      </header>

      {payDisabled ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <strong className="font-medium">
            Bank transfer currently unavailable.
          </strong>{' '}
          Pay by card to continue.
        </div>
      ) : null}

      {plans.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No plans are available right now. Contact support.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-3">
          {plans.map((p) => (
            <li
              key={p.id}
              className="bg-background flex flex-col gap-3 rounded-lg border p-4"
            >
              <div>
                <h3 className="text-base font-semibold">{p.name}</h3>
                {p.description ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {p.description}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xl font-semibold tracking-tight">
                  {formatMoney(
                    Math.round(p.price_minor_units / p.billing_cycle_months),
                    p.currency,
                  )}{' '}
                  <span className="text-muted-foreground text-xs font-normal">
                    / month
                  </span>
                </span>
                <span className="text-muted-foreground text-xs">
                  {formatMoney(p.price_minor_units, p.currency)} + VAT per
                  year
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => openConfirm(p)}
              >
                Choose
              </Button>
            </li>
          ))}
        </ul>
      )}

      {stage !== 'closed' && selectedPlan ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={closeDialog}
            className="absolute inset-0 bg-black/50"
          />
          <div className="bg-background relative w-full max-w-md rounded-lg border p-5 shadow-lg">
            {stage === 'confirm' ? (
              <ConfirmStage
                bankTransferAvailable={bankTransferAvailable}
                plan={selectedPlan}
                submitting={submitting}
                paystackLoading={paystackLoading}
                error={error}
                onBack={closeDialog}
                onContinue={() => void handleGetReference()}
                onPayOnline={() => void handlePayOnline()}
              />
            ) : null}

            {stage === 'transfer' && paymentResult ? (
              <TransferStage
                payment={paymentResult}
                plan={selectedPlan}
                destination={activeDestination}
                copied={copied}
                onCopy={(k, v) => void copyField(k, v)}
                onDone={closeDialog}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Dialog stages
// ---------------------------------------------------------------------------

function ConfirmStage({
  plan,
  submitting,
  paystackLoading,
  bankTransferAvailable,
  error,
  onBack,
  onContinue,
  onPayOnline,
}: {
  plan: PlanOption
  submitting: boolean
  paystackLoading: boolean
  bankTransferAvailable: boolean
  error: string | null
  onBack: () => void
  onContinue: () => void
  onPayOnline: () => void
}) {
  return (
    <>
      <h3 className="text-lg font-semibold tracking-tight">
        Continue with {plan.name}?
      </h3>
      <p className="text-muted-foreground mt-2 text-sm">
        Pay securely by card via Paystack, or get a bank transfer
        reference.
      </p>

      <div className="bg-muted/40 mt-4 flex flex-col gap-1 rounded-md border px-3 py-3 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Plan</span>
          <span className="font-medium">{plan.name}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">Amount</span>
          <span className="font-medium">
            {formatMoney(plan.price_minor_units, plan.currency)}
          </span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted-foreground">VAT</span>
          <span className="font-medium">
            {formatMoney(Math.round(plan.price_minor_units * 0.075), plan.currency)}{' '}
            (7.5%)
          </span>
        </div>
        <div className="flex justify-between gap-3 border-t pt-1 mt-1">
          <span className="text-muted-foreground">Total due</span>
          <span className="font-semibold">
            {formatMoney(
              Math.round(plan.price_minor_units * 1.075),
              plan.currency,
            )}
          </span>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive mt-3 rounded-md px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={submitting || paystackLoading}
        >
          Cancel
        </Button>
        {bankTransferAvailable ? (
          <Button
            type="button"
            variant="outline"
            onClick={onContinue}
            disabled={submitting || paystackLoading}
          >
            {submitting ? 'Preparing…' : 'Get reference'}
          </Button>
        ) : null}
        <Button
          type="button"
          onClick={onPayOnline}
          disabled={submitting || paystackLoading}
        >
          {paystackLoading ? 'Redirecting…' : 'Pay online with card'}
        </Button>
      </div>
    </>
  )
}

function TransferStage({
  payment,
  plan,
  destination,
  copied,
  onCopy,
  onDone,
}: {
  payment: PaymentResult
  plan: PlanOption
  destination: ActiveDestination | null
  copied: string | null
  onCopy: (key: string, value: string) => void
  onDone: () => void
}) {
  return (
    <>
      <h3 className="text-lg font-semibold tracking-tight">
        Transfer instructions
      </h3>
      <p className="text-muted-foreground mt-2 text-sm">
        Send{' '}
        <strong className="text-foreground">
          {formatMoney(payment.amountMinorUnits, payment.currency)}
        </strong>{' '}
        using the reference below as the narration.
      </p>

      <div className="bg-muted/40 mt-4 flex flex-col gap-3 rounded-md border px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-muted-foreground text-[10px] uppercase tracking-wide">
              Reference
            </p>
            <p className="font-mono text-lg font-semibold">
              {payment.reference}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onCopy('ref', payment.reference)}
          >
            {copied === 'ref' ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>

      {destination ? (
        <div className="mt-3 flex flex-col gap-2 text-sm">
          {destination.business_name ? (
            <p className="font-medium">{destination.business_name}</p>
          ) : null}
          <Row label="Bank">{destination.bank_name ?? '—'}</Row>
          <Row label="Account holder">
            {destination.bank_account_name ?? '—'}
          </Row>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Account number</span>
            <span className="flex items-center gap-2">
              <span className="font-mono font-medium">
                {destination.bank_account_number ?? '—'}
              </span>
              {destination.bank_account_number ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    onCopy('acct', destination.bank_account_number as string)
                  }
                >
                  {copied === 'acct' ? 'Copied' : 'Copy'}
                </Button>
              ) : null}
            </span>
          </div>
          {destination.bank_transfer_note ? (
            <p className="text-muted-foreground mt-1 text-xs">
              {destination.bank_transfer_note}
            </p>
          ) : null}
        </div>
      ) : null}

      <p className="text-muted-foreground mt-4 text-xs">
        Your {plan.name} subscription activates once we confirm the
        transfer. This page will update automatically.
      </p>

      <div className="mt-5 flex justify-end">
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  )
}

function formatMoney(minorUnits: number, currency: string): string {
  const major = minorUnits / 100
  const symbol = currency === 'NGN' ? '₦' : currency === 'USD' ? '$' : ''
  return `${symbol}${major.toLocaleString('en-US')}`
}

function friendlyError(code: string): string {
  if (code.includes('NOT_AUTHENTICATED')) return 'Your session expired. Please sign in again.'
  if (code.includes('NOT_ORG_ADMIN')) return "You don't have permission to do this."
  if (code.includes('INVALID_PURPOSE')) return 'Invalid payment purpose.'
  if (code.includes('PLAN_NOT_AVAILABLE')) return 'That plan is no longer available.'
  if (code.includes('DESTINATION_NOT_FOUND')) return 'The destination no longer exists. Contact support.'
  if (code.includes('PAYSTACK_INIT_FAILED')) return 'Could not reach Paystack. Try again, or pay by bank transfer.'
  return 'Could not start the payment. Please try again.'
}
