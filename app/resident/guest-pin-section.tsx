'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { GuestPin } from './types'
import { GuestPinDialog } from './guest-pin-generate-dialog'

/**
 * Guest access section for the resident dashboard.
 *
 * Renders two lists — Active and Recently ended — and a "Generate" button
 * that opens the dialog. The dialog handles the form + share flow. After
 * a successful generation, the dialog calls router.refresh() to re-fetch
 * the list from the Server Component.
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
  const [dialogOpen, setDialogOpen] = useState(false)

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
            <PinList title="Active" pins={active} nowIso={nowIso} />
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
    </section>
  )
}

function PinList({
  title,
  pins,
  nowIso,
}: {
  title: string
  pins: GuestPin[]
  nowIso: string
}) {
  return (
    <div>
      <h3 className="text-muted-foreground mb-2 text-xs uppercase tracking-wide">
        {title}
      </h3>
      <ul className="flex flex-col gap-2">
        {pins.map((pin) => (
          <PinRow key={pin.authorization_id} pin={pin} nowIso={nowIso} />
        ))}
      </ul>
    </div>
  )
}

function PinRow({ pin, nowIso }: { pin: GuestPin; nowIso: string }) {
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
    </li>
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
