'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import type { GuestPin } from './types'
import { GuestPinDialog } from './guest-pin-generate-dialog'

/**
 * Guest access section for the resident dashboard.
 *
 * Renders two lists — Active and Recently ended — and a "Generate" button
 * that opens the dialog. Active rows also expose a Revoke action.
 *
 * After generation or revocation, the section calls router.refresh() to
 * re-fetch the list from the Server Component.
 *
 * nowIso is supplied by the Server Component so expiry labels render
 * identically on server and client — no hydration mismatch.
 */
export function GuestPinSection({
  unitId,
  estateName,
  unitLabel,
  residentName,
  initialPins,
  nowIso,
}: {
  unitId: string
  estateName: string
  unitLabel: string
  residentName: string
  initialPins: GuestPin[]
  nowIso: string
}) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<GuestPin | null>(null)

  const active = initialPins.filter((p) => p.is_active)
  const ended = initialPins.filter((p) => !p.is_active)

  return (
    <section className="bg-muted/40 rounded-lg border p-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-medium">Guest access</h2>
        <Button type="button" size="sm" onClick={() => setDialogOpen(true)}>
          Generate
        </Button>
      </header>

      {active.length === 0 && ended.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No guest PINs yet. Tap Generate when someone is coming.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {active.length > 0 ? (
            <PinList
              title="Active"
              pins={active}
              nowIso={nowIso}
              onRevoke={(pin) => setRevokeTarget(pin)}
            />
          ) : null}
          {ended.length > 0 ? (
            <PinList title="Recently ended" pins={ended} nowIso={nowIso} />
          ) : null}
        </div>
      )}

      <GuestPinDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        unitId={unitId}
        estateName={estateName}
        unitLabel={unitLabel}
        residentName={residentName}
        nowIso={nowIso}
      />

      {revokeTarget ? (
        <RevokePinDialog
          key={revokeTarget.authorization_id}
          target={revokeTarget}
          onClose={() => setRevokeTarget(null)}
          onSuccess={() => {
            setRevokeTarget(null)
            router.refresh()
          }}
        />
      ) : null}
    </section>
  )
}

function PinList({
  title,
  pins,
  nowIso,
  onRevoke,
}: {
  title: string
  pins: GuestPin[]
  nowIso: string
  onRevoke?: (pin: GuestPin) => void
}) {
  return (
    <div>
      <h3 className="text-muted-foreground mb-2 text-xs uppercase tracking-wide">
        {title}
      </h3>
      <ul className="flex flex-col gap-2">
        {pins.map((pin) => (
          <PinRow
            key={pin.authorization_id}
            pin={pin}
            nowIso={nowIso}
            onRevoke={onRevoke}
          />
        ))}
      </ul>
    </div>
  )
}

function PinRow({
  pin,
  nowIso,
  onRevoke,
}: {
  pin: GuestPin
  nowIso: string
  onRevoke?: (pin: GuestPin) => void
}) {
  const isReusable = pin.authorization_type === 'reusable'
  const visitorLabel = pin.visitor_full_name ?? 'Visitor'
  const expiresLabel = formatExpiry(pin, nowIso)

  return (
    <li className="bg-background flex flex-col gap-1 rounded-md border px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium">{visitorLabel}</span>
        {isReusable ? (
          <span className="text-muted-foreground shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
            Reusable
          </span>
        ) : null}
      </div>
      <p className="text-muted-foreground truncate text-xs">{pin.purpose}</p>
      <p className="text-muted-foreground text-xs">{expiresLabel}</p>
      {isReusable && pin.entry_count > 0 ? (
        <p className="text-muted-foreground text-xs">
          Used {pin.entry_count} {pin.entry_count === 1 ? 'time' : 'times'}
        </p>
      ) : null}
      {onRevoke ? (
        <button
          type="button"
          onClick={() => onRevoke(pin)}
          className="text-muted-foreground hover:text-foreground mt-1 self-start text-xs underline underline-offset-4"
        >
          Revoke
        </button>
      ) : null}
    </li>
  )
}

/**
 * Confirm dialog for revoking an active guest PIN. Owns its network call
 * and error state; the parent supplies the target and closes on success.
 * Mounted with a key derived from target.authorization_id so a new target
 * gets a fresh mount (clean state) without an effect.
 */
function RevokePinDialog({
  target,
  onClose,
  onSuccess,
}: {
  target: GuestPin
  onClose: () => void
  onSuccess: () => void
}) {
  const [revoking, setRevoking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const visitorLabel = target.visitor_full_name ?? 'this visitor'

  async function handleConfirm() {
    setRevoking(true)
    setError(null)
    try {
      const res = await fetch('/api/resident/guest-pin/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorization_id: target.authorization_id }),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(friendlyRevokeError(json?.code))
        return
      }

      onSuccess()
    } catch {
      setError('Network error. Please check your connection and try again.')
    } finally {
      setRevoking(false)
    }
  }

  function handleClose() {
    if (revoking) return
    onClose()
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
      <div className="bg-background relative w-full max-w-md rounded-lg border p-5 shadow-lg">
        <h3 className="text-lg font-semibold tracking-tight">
          Revoke PIN for {visitorLabel}?
        </h3>
        <p className="text-muted-foreground mt-2 text-sm">
          The PIN stops working immediately. This cannot be undone.
        </p>

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
            onClick={handleClose}
            disabled={revoking}
          >
            Keep PIN
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={revoking}>
            {revoking ? 'Revoking…' : 'Revoke PIN'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Format the expiry label deterministically given nowIso. Server and client
 * both use the same nowIso, so the output matches and React hydration stays
 * clean. No relative time derived from real Date.now().
 */
function formatExpiry(pin: GuestPin, nowIso: string): string {
  const until = new Date(pin.valid_until)
  const now = new Date(nowIso)

  if (!pin.is_active) {
    if (pin.status === 'revoked') return 'Revoked'
    if (pin.status === 'cancelled') return 'Cancelled'
    return `Ended ${formatAbsolute(until, now)}`
  }

  return `Expires ${formatAbsolute(until, now)}`
}

function formatAbsolute(until: Date, now: Date): string {
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

function friendlyRevokeError(code: unknown): string {
  switch (code) {
    case 'NOT_AUTHENTICATED':
      return 'Your session expired. Please log in again.'
    case 'NOT_AUTHORIZED':
      return "You don't have permission to revoke this PIN."
    case 'AUTHORIZATION_NOT_FOUND':
      return 'This PIN no longer exists.'
    case 'NOT_REVOKABLE':
      return 'This PIN can no longer be revoked.'
    case 'MISSING_REQUIRED_FIELD':
      return 'Something went wrong. Please try again.'
    case 'SYSTEM_UNAVAILABLE':
      return 'Something went wrong. Please try again.'
    default:
      return 'Something went wrong. Please try again.'
  }
}
