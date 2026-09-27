'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import { AddUnitsSection } from './units-add-form'
import { InviteDialog, CancelInviteDialog } from './units-invite-dialog'
import type {
  GeneratedInvite,
  OccupancyInfo,
  PropertyOption,
  UnitRow,
} from './types'

/**
 * Units — orchestrator for the units surface.
 *
 * Responsibilities:
 *   - Property selector + active/all filter
 *   - List rendering with per-unit occupancy state
 *   - Invite generation (RPC) and cancel (RPC)
 *   - Passing state down to AddUnitsSection, InviteDialog, CancelInviteDialog
 *
 * Concerns deliberately delegated:
 *   - Add-units form + preview overlay  → units-add-form.tsx
 *   - Invite share + cancel dialogs     → units-invite-dialog.tsx
 *   - Shared interfaces                 → types.ts
 */

type StatusFilter = 'active' | 'all'

const INVITE_DURATION_MINUTES = 24 * 60

export function UnitsClient({
  organizationId,
  orgStatus,
  properties,
  initialUnits,
  occupancyByUnit,
}: {
  organizationId: string
  orgStatus: string
  properties: PropertyOption[]
  initialUnits: UnitRow[]
  occupancyByUnit: Record<string, OccupancyInfo>
}) {
  const router = useRouter()

  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? '')
  const [filter, setFilter] = useState<StatusFilter>('active')

  // Invite — plaintext codes held only for the current page session.
  const [invitesByUnit, setInvitesByUnit] = useState<
    Record<string, GeneratedInvite>
  >({})
  const [inviteDialog, setInviteDialog] = useState<GeneratedInvite | null>(null)
  const [generatingFor, setGeneratingFor] = useState<string | null>(null)

  const [cancelTarget, setCancelTarget] = useState<UnitRow | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Capture mount time once for invite-expiry countdown.
  const [mountedAt] = useState(() => Date.now())

  const operational = orgStatus === 'active'
  const hasProperties = properties.length > 0

  const existingLabels = useMemo(() => {
    const set = new Set<string>()
    for (const u of initialUnits) {
      if (u.property_id === propertyId) {
        set.add(u.label.trim().toLowerCase())
      }
    }
    return set
  }, [initialUnits, propertyId])

  const visibleUnits = initialUnits.filter((u) => {
    if (u.property_id !== propertyId) return false
    if (filter === 'active') return u.status === 'active'
    return true
  })

  const currentPropertyName =
    properties.find((p) => p.id === propertyId)?.name ?? 'Property'

  function clearMessages() {
    setError(null)
    setNotice(null)
  }

  async function handleGenerateInvite(unit: UnitRow) {
    clearMessages()
    setGeneratingFor(unit.id)

    try {
      const supabase = createClient()
      const { data, error: rpcError } = await supabase.rpc(
        'generate_unit_invite',
        {
          p_organization_id: organizationId,
          p_unit_id: unit.id,
          p_duration_minutes: INVITE_DURATION_MINUTES,
        },
      )

      if (rpcError) {
        setError(mapInviteError(rpcError.message))
        return
      }

      const row = Array.isArray(data) ? data[0] : data
      const code = (row?.code as string) ?? ''
      const expiresAt = (row?.expires_at as string) ?? ''
      const occupancyId = (row?.occupancy_id as string) ?? ''

      if (!code || !expiresAt || !occupancyId) {
        setError('Invite was generated but response was malformed.')
        return
      }

      const origin =
        typeof window !== 'undefined' ? window.location.origin : ''
      const link = `${origin}/resident/join/${code}`

      const generated: GeneratedInvite = {
        occupancyId,
        code,
        link,
        expiresAt,
        propertyName: currentPropertyName,
      }

      setInvitesByUnit((prev) => ({ ...prev, [unit.id]: generated }))
      setInviteDialog(generated)
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setGeneratingFor(null)
    }
  }

  async function handleCancelInvite() {
    if (!cancelTarget) return
    clearMessages()
    setCancelling(true)

    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc('cancel_unit_invite', {
        p_organization_id: organizationId,
        p_unit_id: cancelTarget.id,
        p_reason: 'cancelled by admin',
      })

      if (rpcError) {
        setError(mapInviteError(rpcError.message))
        return
      }

      setInvitesByUnit((prev) => {
        const next = { ...prev }
        delete next[cancelTarget.id]
        return next
      })

      setNotice(`${cancelTarget.label}: invite cancelled.`)
      setCancelTarget(null)
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setCancelling(false)
    }
  }

  if (!hasProperties) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Units</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Units belong to a property. Create a property first.
          </p>
        </header>
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
          No active property found. Complete organization setup to create one.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Units</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Units within your property. Invite residents to a specific unit, or
          bulk-create units for estates with many houses or flats.
        </p>
      </header>

      {!operational ? (
        <div className="mb-6 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <strong className="font-medium">Subscription not yet active.</strong>{' '}
          You can see existing units but cannot add or invite until your
          organization is active.
        </div>
      ) : null}

      {properties.length > 1 ? (
        <div className="mb-4 grid gap-2">
          <Label htmlFor="propertySelect">Property</Label>
          <select
            id="propertySelect"
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            className="border-input bg-background h-11 max-w-md rounded-md border px-3 text-sm"
          >
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="mb-4 flex items-center gap-2">
        <FilterChip
          label="Active"
          value="active"
          current={filter}
          onSelect={setFilter}
        />
        <FilterChip label="All" value="all" current={filter} onSelect={setFilter} />
      </div>

      {error ? (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive mb-4 rounded-md px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="bg-muted mb-4 rounded-md px-3 py-2 text-sm">{notice}</p>
      ) : null}

      <section className="mb-8">
        {visibleUnits.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
            No units yet for this property. Add your first one below.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visibleUnits.map((u) => {
              const occ = occupancyByUnit[u.id] ?? { kind: 'vacant' }
              const inactive = u.status !== 'active'
              const cached = invitesByUnit[u.id]
              const generating = generatingFor === u.id

              return (
                <li
                  key={u.id}
                  className={`flex items-start justify-between gap-4 rounded-lg border px-4 py-3 ${
                    inactive ? 'bg-muted/10 opacity-70' : 'bg-muted/30'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{u.label}</p>
                    {u.notes ? (
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">
                        {u.notes}
                      </p>
                    ) : null}
                    {occ.kind === 'invited' ? (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {formatInviteStatus(occ.expires_at, mountedAt)}
                      </p>
                    ) : null}
                    {occ.kind === 'occupied' && occ.resident_name ? (
                      <p className="text-muted-foreground mt-1 text-xs">
                        Occupied by {occ.resident_name}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <OccupancyBadge occ={occ} unitStatus={u.status} />

                    {!inactive && operational && occ.kind === 'vacant' ? (
                      <button
                        type="button"
                        onClick={() => handleGenerateInvite(u)}
                        disabled={generating}
                        className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4 disabled:opacity-50"
                      >
                        {generating ? 'Generating…' : 'Invite resident'}
                      </button>
                    ) : null}

                    {!inactive && operational && occ.kind === 'invited' ? (
                      <>
                        {cached ? (
                          <button
                            type="button"
                            onClick={() => setInviteDialog(cached)}
                            className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
                          >
                            Show link
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setCancelTarget(u)}
                          className="text-muted-foreground hover:text-destructive text-xs underline underline-offset-4"
                        >
                          Cancel invite
                        </button>
                      </>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <AddUnitsSection
        propertyId={propertyId}
        existingLabels={existingLabels}
        operational={operational}
      />

      <InviteDialog invite={inviteDialog} onClose={() => setInviteDialog(null)} />

      <CancelInviteDialog
        target={cancelTarget}
        cancelling={cancelling}
        onConfirm={() => void handleCancelInvite()}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

function OccupancyBadge({
  occ,
  unitStatus,
}: {
  occ: OccupancyInfo
  unitStatus: string
}) {
  if (unitStatus !== 'active') {
    return (
      <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
        {unitStatus}
      </span>
    )
  }
  if (occ.kind === 'occupied') {
    return (
      <span className="rounded-full bg-blue-600/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-800 dark:text-blue-300">
        Occupied
      </span>
    )
  }
  if (occ.kind === 'invited') {
    return (
      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">
        Invite pending
      </span>
    )
  }
  return (
    <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
      Vacant
    </span>
  )
}

function formatInviteStatus(
  expiresAt: string | null,
  mountedAt: number,
): string {
  if (!expiresAt) return 'Invite pending'
  const ms = new Date(expiresAt).getTime() - mountedAt
  if (ms <= 0) return 'Invite expired'
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  if (hours >= 1) return `Expires in ${hours}h ${minutes}m`
  return `Expires in ${minutes}m`
}

function FilterChip({
  label,
  value,
  current,
  onSelect,
}: {
  label: string
  value: StatusFilter
  current: StatusFilter
  onSelect: (v: StatusFilter) => void
}) {
  const active = current === value
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-foreground text-background'
          : 'bg-muted text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

function mapInviteError(message: string): string {
  if (message.includes('NOT_AUTHORIZED')) {
    return 'You don’t have permission for this action.'
  }
  if (message.includes('SUBSCRIPTION_INACTIVE')) {
    return 'Your organization is not active yet. Complete setup or choose a plan first.'
  }
  if (message.includes('UNIT_NOT_FOUND')) {
    return 'This unit no longer exists.'
  }
  if (message.includes('UNIT_ARCHIVED')) {
    return 'This unit is archived.'
  }
  if (message.includes('UNIT_ALREADY_OCCUPIED')) {
    return 'This unit already has an active resident. Eject them first.'
  }
  if (message.includes('INVITE_NOT_FOUND')) {
    return 'No live invite found for this unit.'
  }
  return 'Could not complete the invite action. Please try again.'
}
