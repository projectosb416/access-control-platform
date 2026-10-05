'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

/**
 * Refund action for a single payment row.
 *
 * Renders as a small underline link when the payment has a remaining
 * refundable balance (status succeeded or partially_refunded with
 * remaining > 0). Renders nothing otherwise.
 *
 * The DB function refund_payment (migration 0064) is the authoritative
 * gate — the client checks are UX only. If they drift, the server
 * rejects and this component shows the mapped error.
 *
 * Money input is in naira (major units). Converted to kobo (minor
 * units) via Math.round(x * 100) before the RPC call. The DB accepts
 * integer kobo only.
 *
 * After a successful refund, router.refresh() re-runs the parent
 * Server Component, which re-fetches the payments list. The button
 * disappears from fully-refunded rows on re-render.
 */

export function RefundButton({
  paymentId,
  amountMinorUnits,
  refundedAmountMinorUnits,
  currency,
}: {
  paymentId: string
  amountMinorUnits: number
  refundedAmountMinorUnits: number | null
  currency: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const alreadyRefunded = refundedAmountMinorUnits ?? 0
  const remaining = amountMinorUnits - alreadyRefunded

  // Default the amount input to the full remaining. Reset on dialog open.
  const [amountNaira, setAmountNaira] = useState<string>(() =>
    String(remaining / 100),
  )
  const [reason, setReason] = useState('')

  // Early return AFTER all hooks — Rules of Hooks.
  if (remaining <= 0) return null

  function openDialog() {
    setError(null)
    setAmountNaira(String(remaining / 100))
    setReason('')
    setOpen(true)
  }

  function closeDialog() {
    if (submitting) return
    setOpen(false)
  }

  async function handleConfirm() {
    setError(null)

    const parsed = Number.parseFloat(amountNaira)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter a valid amount greater than zero.')
      return
    }

    const amountKobo = Math.round(parsed * 100)
    if (amountKobo > remaining) {
      setError(
        `Amount exceeds the remaining ${formatMoney(remaining, currency)}.`,
      )
      return
    }

    const trimmedReason = reason.trim()
    if (!trimmedReason) {
      setError('Please provide a reason.')
      return
    }

    setSubmitting(true)
    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc('refund_payment', {
        p_payment_id: paymentId,
        p_amount_minor_units: amountKobo,
        p_reason: trimmedReason,
      })

      if (rpcError) {
        setError(friendlyError(rpcError.message))
        return
      }

      setOpen(false)
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className="text-muted-foreground hover:text-foreground shrink-0 text-xs underline underline-offset-4"
      >
        Refund
      </button>

      {open ? (
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
            <h3 className="text-lg font-semibold tracking-tight">
              Refund payment
            </h3>

            <div className="mt-3 flex flex-col gap-1 text-sm">
              <Row label="Original" value={formatMoney(amountMinorUnits, currency)} />
              {alreadyRefunded > 0 ? (
                <Row
                  label="Already refunded"
                  value={formatMoney(alreadyRefunded, currency)}
                />
              ) : null}
              <Row label="Remaining" value={formatMoney(remaining, currency)} />
            </div>

            <div className="mt-4 grid gap-2">
              <Label htmlFor="refund-amount">
                Amount to refund ({currencySymbol(currency)})
              </Label>
              <Input
                id="refund-amount"
                type="number"
                step="0.01"
                min="0"
                value={amountNaira}
                onChange={(e) => setAmountNaira(e.target.value)}
                disabled={submitting}
                className="h-11"
              />
            </div>

            <div className="mt-3 grid gap-2">
              <Label htmlFor="refund-reason">Reason</Label>
              <Input
                id="refund-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. customer requested, duplicate payment"
                disabled={submitting}
                className="h-11"
              />
            </div>

            {error ? (
              <p
                role="alert"
                className="bg-destructive/10 text-destructive mt-3 rounded-md px-3 py-2 text-sm"
              >
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={closeDialog}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={submitting}
              >
                {submitting ? 'Refunding…' : 'Confirm refund'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

function currencySymbol(currency: string): string {
  if (currency === 'NGN') return '₦'
  if (currency === 'USD') return '$'
  return currency
}

function formatMoney(minorUnits: number, currency: string): string {
  const major = minorUnits / 100
  return `${currencySymbol(currency)}${major.toLocaleString('en-US')}`
}

function friendlyError(code: string): string {
  if (code.includes('NOT_AUTHENTICATED')) return 'Your session expired. Please sign in again.'
  if (code.includes('NOT_PLATFORM_ADMIN')) return "You don't have platform admin access."
  if (code.includes('PAYMENT_NOT_FOUND')) return 'Payment not found.'
  if (code.includes('PAYMENT_NOT_REFUNDABLE')) return 'This payment cannot be refunded.'
  if (code.includes('INVALID_REFUND_AMOUNT')) return 'The refund amount is not valid.'
  if (code.includes('REFUND_EXCEEDS_REMAINING')) return 'That amount exceeds what is still refundable.'
  if (code.includes('REASON_REQUIRED')) return 'A reason is required.'
  return 'Could not process the refund. Please try again.'
}
