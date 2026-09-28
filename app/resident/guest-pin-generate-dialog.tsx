'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { GenerateGuestPinResponse } from './types'

/**
 * Two-stage dialog: form → share.
 *
 * The plaintext PIN exists only in this component's memory, briefly,
 * between the POST response and the resident tapping Done. It is never
 * persisted, never logged, and never returned in a list query.
 *
 * On "Done" (share view), the dialog calls router.refresh() to re-run
 * the Server Component and re-fetch the list. Authoritative over any
 * optimistic local state.
 */

const ACCESS_TYPE_OPTIONS = [
  { value: 'visitor',       label: 'Visitor' },
  { value: 'family_member', label: 'Family' },
  { value: 'vendor',        label: 'Vendor' },
  { value: 'contractor',    label: 'Contractor' },
  { value: 'client',        label: 'Client' },
  { value: 'employee',      label: 'Employee' },
  { value: 'other',         label: 'Other' },
] as const

type AuthorizationType = 'one_time' | 'reusable'

type DurationPreset =
  | { kind: 'hours'; hours: number; label: string }
  | { kind: 'days'; days: number; label: string }
  | { kind: 'eod'; label: string }

const ONE_TIME_PRESETS: DurationPreset[] = [
  { kind: 'hours', hours: 2, label: '2 hours' },
  { kind: 'hours', hours: 4, label: '4 hours' },
  { kind: 'eod', label: 'Today' },
]

const REUSABLE_PRESETS: DurationPreset[] = [
  { kind: 'eod', label: 'Today' },
  { kind: 'days', days: 7, label: '7 days' },
  { kind: 'days', days: 30, label: '30 days' },
]

export function GuestPinDialog({
  open,
  onClose,
  unitId,
  estateName,
  unitLabel,
  residentName,
  nowIso,
}: {
  open: boolean
  onClose: () => void
  unitId: string
  estateName: string
  unitLabel: string
  residentName: string
  nowIso: string
}) {
  const router = useRouter()

  const [stage, setStage] = useState<'form' | 'share'>('form')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [visitorName, setVisitorName] = useState('')
  const [visitorPhone, setVisitorPhone] = useState('')
  const [purpose, setPurpose] = useState('')
  const [accessType, setAccessType] = useState<string>('visitor')
  const [authType, setAuthType] = useState<AuthorizationType>('one_time')
  const [presetIndex, setPresetIndex] = useState(0)

  const [generated, setGenerated] = useState<GenerateGuestPinResponse | null>(null)
  const [generatedUntilIso, setGeneratedUntilIso] = useState<string>('')

  if (!open) return null

  function reset() {
    setStage('form')
    setSubmitting(false)
    setError(null)
    setVisitorName('')
    setVisitorPhone('')
    setPurpose('')
    setAccessType('visitor')
    setAuthType('one_time')
    setPresetIndex(0)
    setGenerated(null)
    setGeneratedUntilIso('')
  }

  function handleClose() {
    if (submitting) return
    reset()
    onClose()
  }

  function handleDone() {
    reset()
    onClose()
    router.refresh()
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const trimmedName = visitorName.trim()
    const trimmedPurpose = purpose.trim()
    const trimmedPhone = visitorPhone.trim()

    if (!trimmedName) {
      setError('Please enter the visitor name.')
      return
    }
    if (!trimmedPurpose) {
      setError('Please enter what the visit is for.')
      return
    }

    const presets = authType === 'reusable' ? REUSABLE_PRESETS : ONE_TIME_PRESETS
    const preset = presets[presetIndex] ?? presets[0]
    const { from, until } = computeWindow(preset)

    setSubmitting(true)
    try {
      const res = await fetch('/api/resident/guest-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: unitId,
          visitor_full_name: trimmedName,
          visitor_phone: trimmedPhone || null,
          purpose: trimmedPurpose,
          access_type: accessType,
          authorization_type: authType,
          valid_from: from,
          valid_until: until,
          note: null,
        }),
      })

      const json = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(friendlyError(json?.code))
        return
      }

      if (
        typeof json.authorization_id !== 'string' ||
        typeof json.credential_id !== 'string' ||
        typeof json.pin !== 'string'
      ) {
        setError('Something went wrong. Please try again.')
        return
      }

      setGenerated({
        authorization_id: json.authorization_id,
        credential_id: json.credential_id,
        pin: json.pin,
      })
      setGeneratedUntilIso(until)
      setStage('share')
    } catch {
      setError('Network error. Please check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={handleClose}
        className="absolute inset-0 bg-black/50"
      />
      <div className="bg-background relative max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg border p-5 shadow-lg">
        {stage === 'form' ? (
          <FormView
            visitorName={visitorName}
            setVisitorName={setVisitorName}
            visitorPhone={visitorPhone}
            setVisitorPhone={setVisitorPhone}
            purpose={purpose}
            setPurpose={setPurpose}
            accessType={accessType}
            setAccessType={setAccessType}
            authType={authType}
            setAuthType={(v) => {
              setAuthType(v)
              setPresetIndex(0)
            }}
            presetIndex={presetIndex}
            setPresetIndex={setPresetIndex}
            error={error}
            submitting={submitting}
            onSubmit={handleSubmit}
            onCancel={handleClose}
          />
        ) : (
          <ShareView
            generated={generated as GenerateGuestPinResponse}
            untilIso={generatedUntilIso}
            visitorName={visitorName}
            authType={authType}
            estateName={estateName}
            unitLabel={unitLabel}
            residentName={residentName}
            nowIso={nowIso}
            onDone={handleDone}
          />
        )}
      </div>
    </div>
  )
}

function FormView({
  visitorName,
  setVisitorName,
  visitorPhone,
  setVisitorPhone,
  purpose,
  setPurpose,
  accessType,
  setAccessType,
  authType,
  setAuthType,
  presetIndex,
  setPresetIndex,
  error,
  submitting,
  onSubmit,
  onCancel,
}: {
  visitorName: string
  setVisitorName: (v: string) => void
  visitorPhone: string
  setVisitorPhone: (v: string) => void
  purpose: string
  setPurpose: (v: string) => void
  accessType: string
  setAccessType: (v: string) => void
  authType: AuthorizationType
  setAuthType: (v: AuthorizationType) => void
  presetIndex: number
  setPresetIndex: (v: number) => void
  error: string | null
  submitting: boolean
  onSubmit: (e: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
}) {
  const presets = authType === 'reusable' ? REUSABLE_PRESETS : ONE_TIME_PRESETS

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <header>
        <h3 className="text-lg font-semibold tracking-tight">
          New guest PIN
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">
          The PIN is shown once after generating. Share it with your visitor.
        </p>
      </header>

      <div className="grid gap-2">
        <Label htmlFor="visitor-name">Visitor name</Label>
        <Input
          id="visitor-name"
          value={visitorName}
          onChange={(e) => setVisitorName(e.target.value)}
          placeholder="e.g. John the plumber"
          maxLength={120}
          autoFocus
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="visitor-phone">
          Phone <span className="text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="visitor-phone"
          type="tel"
          value={visitorPhone}
          onChange={(e) => setVisitorPhone(e.target.value)}
          placeholder="+234..."
          maxLength={40}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="purpose">Purpose</Label>
        <Input
          id="purpose"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder="Fixing pipes"
          maxLength={200}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="access-type">Type of visit</Label>
        <select
          id="access-type"
          value={accessType}
          onChange={(e) => setAccessType(e.target.value)}
          className="border-input bg-background h-11 rounded-md border px-3 text-sm"
        >
          {ACCESS_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-2">
        <Label>How it works</Label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              setAuthType('one_time')
              setPresetIndex(0)
            }}
            className={
              'rounded-md border px-3 py-2 text-left text-sm transition-colors ' +
              (authType === 'one_time'
                ? 'border-foreground bg-muted'
                : 'border-input hover:bg-muted')
            }
          >
            <div className="font-medium">One visit</div>
            <div className="text-muted-foreground text-xs">
              Enter once, exit once
            </div>
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthType('reusable')
              setPresetIndex(0)
            }}
            className={
              'rounded-md border px-3 py-2 text-left text-sm transition-colors ' +
              (authType === 'reusable'
                ? 'border-foreground bg-muted'
                : 'border-input hover:bg-muted')
            }
          >
            <div className="font-medium">Reusable</div>
            <div className="text-muted-foreground text-xs">
              Use every time, until expiry
            </div>
          </button>
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Valid for</Label>
        <div className="grid grid-cols-3 gap-2">
          {presets.map((p, i) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setPresetIndex(i)}
              className={
                'rounded-md border px-3 py-2 text-sm transition-colors ' +
                (presetIndex === i
                  ? 'border-foreground bg-muted'
                  : 'border-input hover:bg-muted')
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-1 flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Generating…' : 'Generate PIN'}
        </Button>
      </div>
    </form>
  )
}

function ShareView({
  generated,
  untilIso,
  visitorName,
  authType,
  estateName,
  unitLabel,
  residentName,
  nowIso,
  onDone,
}: {
  generated: GenerateGuestPinResponse
  untilIso: string
  visitorName: string
  authType: AuthorizationType
  estateName: string
  unitLabel: string
  residentName: string
  nowIso: string
  onDone: () => void
}) {
  const [copied, setCopied] = useState(false)

  const untilDisplay = formatUntilLabel(untilIso, nowIso)

  const message =
    authType === 'reusable'
      ? `Hi ${visitorName} — your gate PIN for ${estateName} is ${generated.pin}.\n\nUse it every time you enter or leave, until ${untilDisplay}. Please don't share it with anyone else.\n\nSent by ${residentName} (Unit ${unitLabel}).`
      : `Hi ${visitorName} — your gate PIN for ${estateName} is ${generated.pin}.\n\nUse it once at the gate — both to enter and to exit. Valid until ${untilDisplay}.\n\nSent by ${residentName} (Unit ${unitLabel}).`

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(message)}`
  const emailHref = `mailto:?subject=${encodeURIComponent(
    `Guest PIN for ${estateName}`,
  )}&body=${encodeURIComponent(message)}`

  async function copyPin() {
    try {
      await navigator.clipboard.writeText(generated.pin)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable — digits are visible for manual entry.
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h3 className="text-lg font-semibold tracking-tight">
          PIN ready to share
        </h3>
        <p className="text-muted-foreground mt-1 text-sm">
          This PIN is shown once. If you lose it, generate a new one.
        </p>
      </header>

      <div className="bg-muted rounded-lg border px-4 py-6 text-center">
        <p className="text-muted-foreground mb-2 text-[10px] uppercase tracking-wide">
          Guest PIN
        </p>
        <p className="font-mono text-4xl font-semibold tracking-[0.3em]">
          {generated.pin}
        </p>
      </div>

      <div className="text-muted-foreground text-center text-xs">
        {authType === 'reusable' ? 'Reusable — until ' : 'Valid until '}
        {untilDisplay}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={copyPin}
          className="border-input hover:bg-muted rounded-md border px-3 py-2 text-sm font-medium transition-colors"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className="border-input hover:bg-muted rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors"
        >
          WhatsApp
        </a>
        <a
          href={emailHref}
          className="border-input hover:bg-muted rounded-md border px-3 py-2 text-center text-sm font-medium transition-colors"
        >
          Email
        </a>
      </div>

      <div className="mt-1 flex justify-end">
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeWindow(preset: DurationPreset): { from: string; until: string } {
  const now = new Date()
  const from = now

  let until: Date
  if (preset.kind === 'eod') {
    until = new Date(now)
    until.setHours(23, 59, 59, 999)
  } else if (preset.kind === 'hours') {
    until = new Date(now.getTime() + preset.hours * 60 * 60 * 1000)
  } else {
    until = new Date(now.getTime() + preset.days * 24 * 60 * 60 * 1000)
  }

  return { from: from.toISOString(), until: until.toISOString() }
}

function formatUntilLabel(untilIso: string, nowIso: string): string {
  const until = new Date(untilIso)
  const now = new Date(nowIso)

  const sameDay =
    until.getUTCFullYear() === now.getUTCFullYear() &&
    until.getUTCMonth() === now.getUTCMonth() &&
    until.getUTCDate() === now.getUTCDate()

  if (sameDay) {
    return `today at ${formatTimeUTC(until)}`
  }

  const tomorrow = new Date(now)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  const isTomorrow =
    until.getUTCFullYear() === tomorrow.getUTCFullYear() &&
    until.getUTCMonth() === tomorrow.getUTCMonth() &&
    until.getUTCDate() === tomorrow.getUTCDate()

  if (isTomorrow) {
    return `tomorrow at ${formatTimeUTC(until)}`
  }

  return `${formatDateUTC(until)} at ${formatTimeUTC(until)}`
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function formatDateUTC(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

function formatTimeUTC(d: Date): string {
  const h24 = d.getUTCHours()
  const m = d.getUTCMinutes().toString().padStart(2, '0')
  const period = h24 >= 12 ? 'PM' : 'AM'
  const h12 = ((h24 + 11) % 12) + 1
  return `${h12}:${m} ${period}`
}

function friendlyError(code: unknown): string {
  switch (code) {
    case 'NOT_AUTHENTICATED':
      return 'Your session expired. Please log in again.'
    case 'NOT_AUTHORIZED':
      return "You don't have permission to do that."
    case 'SUBSCRIPTION_INACTIVE':
      return "This estate's subscription is inactive."
    case 'UNIT_NOT_FOUND':
      return 'Unit not found.'
    case 'UNIT_NOT_ACTIVE':
      return 'This unit is no longer active.'
    case 'FULL_NAME_REQUIRED':
      return "Please enter the visitor's name."
    case 'PURPOSE_REQUIRED':
      return 'Please enter the purpose of the visit.'
    case 'INVALID_ACCESS_TYPE':
      return 'Please pick a type of visit.'
    case 'INVALID_AUTHORIZATION_TYPE':
      return 'Please pick one-visit or reusable.'
    case 'INVALID_VALIDITY_WINDOW':
      return 'Please pick a valid time window.'
    case 'PIN_COLLISION':
      return 'That PIN is already in use. Please try again.'
    case 'RATE_LIMITED':
      return "You've generated too many PINs recently. Try again later."
    case 'MISSING_REQUIRED_FIELD':
      return 'Please fill in all required fields.'
    case 'INVALID_BODY':
      return 'Something went wrong. Please try again.'
    case 'SYSTEM_UNAVAILABLE':
      return 'Something went wrong. Please try again.'
    default:
      return 'Something went wrong. Please try again.'
  }
}
