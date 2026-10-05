'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

/**
 * Payment destinations management.
 *
 * Lists all destinations (active and inactive). Platform admins add,
 * edit, activate, and deactivate. The active destination is what org
 * admins see on their billing page when they choose to pay by bank
 * transfer.
 *
 * Inline form, not modal — the admin can reference existing
 * destinations while filling in a new one. Same pattern as
 * units-add-form on the admin surface.
 *
 * All writes go through the three RPCs from migration 0066. Client
 * validation is UX only; the server is authoritative on label
 * requirement and the incomplete-destination gate.
 */

export type DestinationRow = {
  id: string
  label: string
  business_name: string | null
  bank_account_name: string | null
  bank_name: string | null
  bank_account_number: string | null
  bank_transfer_note: string | null
  is_active: boolean
}

export function DestinationsClient({
  destinations,
}: {
  destinations: DestinationRow[]
}) {
  const router = useRouter()

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<DestinationRow | null>(null)

  // Form field state.
  const [label, setLabel] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [bankAccountName, setBankAccountName] = useState('')
  const [bankName, setBankName] = useState('')
  const [bankAccountNumber, setBankAccountNumber] = useState('')
  const [bankTransferNote, setBankTransferNote] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function openAdd() {
    setLabel('')
    setBusinessName('')
    setBankAccountName('')
    setBankName('')
    setBankAccountNumber('')
    setBankTransferNote('')
    setEditing(null)
    setError(null)
    setFormOpen(true)
  }

  function openEdit(d: DestinationRow) {
    setLabel(d.label)
    setBusinessName(d.business_name ?? '')
    setBankAccountName(d.bank_account_name ?? '')
    setBankName(d.bank_name ?? '')
    setBankAccountNumber(d.bank_account_number ?? '')
    setBankTransferNote(d.bank_transfer_note ?? '')
    setEditing(d)
    setError(null)
    setFormOpen(true)
  }

  function closeForm() {
    if (submitting) return
    setFormOpen(false)
    setEditing(null)
    setError(null)
  }

  async function handleSubmit() {
    setError(null)
    const trimmedLabel = label.trim()
    if (!trimmedLabel) {
      setError('Please provide a label.')
      return
    }

    setSubmitting(true)
    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc(
        'upsert_payment_destination',
        {
          p_id: editing?.id ?? null,
          p_label: trimmedLabel,
          p_business_name: businessName.trim() || null,
          p_bank_account_name: bankAccountName.trim() || null,
          p_bank_name: bankName.trim() || null,
          p_bank_account_number: bankAccountNumber.trim() || null,
          p_bank_transfer_note: bankTransferNote.trim() || null,
        },
      )

      if (rpcError) {
        setError(friendlyError(rpcError.message))
        return
      }

      setFormOpen(false)
      setEditing(null)
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleActivate(d: DestinationRow) {
    setError(null)
    setPendingAction(d.id)
    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc(
        'set_active_payment_destination',
        { p_id: d.id },
      )
      if (rpcError) {
        setError(friendlyError(rpcError.message))
        return
      }
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setPendingAction(null)
    }
  }

  async function handleDeactivate(d: DestinationRow) {
    setError(null)
    setPendingAction(d.id)
    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc(
        'deactivate_payment_destination',
        { p_id: d.id },
      )
      if (rpcError) {
        setError(friendlyError(rpcError.message))
        return
      }
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setPendingAction(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-sm">
          Bank accounts that org admins can pay into. Exactly one is
          active at a time.
        </p>
        {!formOpen ? (
          <Button type="button" size="sm" onClick={openAdd}>
            Add destination
          </Button>
        ) : null}
      </div>

      {error && !formOpen ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      {formOpen ? (
        <DestinationForm
          editing={editing}
          label={label}
          setLabel={setLabel}
          businessName={businessName}
          setBusinessName={setBusinessName}
          bankAccountName={bankAccountName}
          setBankAccountName={setBankAccountName}
          bankName={bankName}
          setBankName={setBankName}
          bankAccountNumber={bankAccountNumber}
          setBankAccountNumber={setBankAccountNumber}
          bankTransferNote={bankTransferNote}
          setBankTransferNote={setBankTransferNote}
          submitting={submitting}
          error={error}
          onSubmit={() => void handleSubmit()}
          onClose={closeForm}
        />
      ) : null}

      {destinations.length === 0 ? (
        <section className="bg-muted/40 rounded-lg border p-5">
          <p className="text-muted-foreground text-sm">
            No destinations yet. Add one to start receiving bank
            transfers.
          </p>
        </section>
      ) : (
        <ul className="flex flex-col gap-2">
          {destinations.map((d) => (
            <DestinationCard
              key={d.id}
              destination={d}
              pending={pendingAction === d.id}
              onEdit={() => openEdit(d)}
              onActivate={() => void handleActivate(d)}
              onDeactivate={() => void handleDeactivate(d)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Row card
// ---------------------------------------------------------------------------

function DestinationCard({
  destination,
  pending,
  onEdit,
  onActivate,
  onDeactivate,
}: {
  destination: DestinationRow
  pending: boolean
  onEdit: () => void
  onActivate: () => void
  onDeactivate: () => void
}) {
  const d = destination
  return (
    <li className="bg-background flex flex-col gap-2 rounded-md border px-3 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="truncate text-sm font-medium">{d.label}</span>
          {d.is_active ? (
            <span className="shrink-0 rounded-full bg-emerald-600/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
              Active
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={onEdit}
            disabled={pending}
            className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4 disabled:opacity-50"
          >
            Edit
          </button>
          {d.is_active ? (
            <button
              type="button"
              onClick={onDeactivate}
              disabled={pending}
              className="text-muted-foreground hover:text-destructive text-xs underline underline-offset-4 disabled:opacity-50"
            >
              {pending ? 'Deactivating…' : 'Deactivate'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onActivate}
              disabled={pending}
              className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4 disabled:opacity-50"
            >
              {pending ? 'Activating…' : 'Activate'}
            </button>
          )}
        </div>
      </div>

      {d.business_name ? (
        <p className="text-sm">{d.business_name}</p>
      ) : (
        <p className="text-muted-foreground text-xs italic">
          No trading name
        </p>
      )}

      {d.bank_name || d.bank_account_name || d.bank_account_number ? (
        <p className="text-muted-foreground text-xs">
          {d.bank_name ?? '—'} · {d.bank_account_name ?? '—'} ·{' '}
          {d.bank_account_number ?? '—'}
        </p>
      ) : (
        <p className="text-muted-foreground text-xs italic">
          No bank details
        </p>
      )}

      {d.bank_transfer_note ? (
        <p className="text-muted-foreground text-xs">
          Note: {d.bank_transfer_note}
        </p>
      ) : null}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

function DestinationForm({
  editing,
  label,
  setLabel,
  businessName,
  setBusinessName,
  bankAccountName,
  setBankAccountName,
  bankName,
  setBankName,
  bankAccountNumber,
  setBankAccountNumber,
  bankTransferNote,
  setBankTransferNote,
  submitting,
  error,
  onSubmit,
  onClose,
}: {
  editing: DestinationRow | null
  label: string
  setLabel: (v: string) => void
  businessName: string
  setBusinessName: (v: string) => void
  bankAccountName: string
  setBankAccountName: (v: string) => void
  bankName: string
  setBankName: (v: string) => void
  bankAccountNumber: string
  setBankAccountNumber: (v: string) => void
  bankTransferNote: string
  setBankTransferNote: (v: string) => void
  submitting: boolean
  error: string | null
  onSubmit: () => void
  onClose: () => void
}) {
  return (
    <section className="bg-muted/40 rounded-lg border p-5">
      <h2 className="mb-4 text-base font-medium">
        {editing ? 'Edit destination' : 'New destination'}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="label">
            Label <span className="text-muted-foreground">(admin only)</span>
          </Label>
          <Input
            id="label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Personal — Pishon"
            disabled={submitting}
            className="h-10"
          />
        </div>

        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="business-name">
            Trading name <span className="text-muted-foreground">(shown to customers)</span>
          </Label>
          <Input
            id="business-name"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="e.g. Omtic Digital Services"
            disabled={submitting}
            className="h-10"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="bank-name">Bank</Label>
          <Input
            id="bank-name"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
            placeholder="e.g. Fidelity Bank"
            disabled={submitting}
            className="h-10"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="bank-account-number">Account number</Label>
          <Input
            id="bank-account-number"
            value={bankAccountNumber}
            onChange={(e) => setBankAccountNumber(e.target.value)}
            placeholder="10 digits"
            disabled={submitting}
            className="h-10"
          />
        </div>

        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="bank-account-name">
            Account holder name
          </Label>
          <Input
            id="bank-account-name"
            value={bankAccountName}
            onChange={(e) => setBankAccountName(e.target.value)}
            placeholder="e.g. Pishon Samuel IGHO"
            disabled={submitting}
            className="h-10"
          />
        </div>

        <div className="grid gap-2 sm:col-span-2">
          <Label htmlFor="bank-transfer-note">
            Transfer note{' '}
            <span className="text-muted-foreground">(optional, shown to customers)</span>
          </Label>
          <Input
            id="bank-transfer-note"
            value={bankTransferNote}
            onChange={(e) => setBankTransferNote(e.target.value)}
            placeholder="e.g. Use the BT reference as narration"
            disabled={submitting}
            className="h-10"
          />
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive mt-4 rounded-md px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="button" onClick={onSubmit} disabled={submitting}>
          {submitting ? 'Saving…' : editing ? 'Save changes' : 'Create'}
        </Button>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

function friendlyError(code: string): string {
  if (code.includes('NOT_AUTHENTICATED')) return 'Your session expired. Please sign in again.'
  if (code.includes('NOT_PLATFORM_ADMIN')) return "You don't have platform admin access."
  if (code.includes('LABEL_REQUIRED')) return 'Please provide a label.'
  if (code.includes('DESTINATION_NOT_FOUND')) return 'Destination no longer exists.'
  if (code.includes('INCOMPLETE_DESTINATION')) return 'This destination is missing required fields and cannot be activated.'
  return 'Could not save. Please try again.'
}
