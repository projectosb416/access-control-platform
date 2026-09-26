'use client'

import { useState, useEffect, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { createClient } from '@/lib/supabase/client'
import type { ShiftRow } from './page'

/**
 * Shift list + add form + cancel action.
 *
 * Shift codes auto-generate via trigger, same as guard codes. Admin shares
 * the code with whoever is working that window.
 *
 * Cancel: sets status to 'cancelled'. If a guard is currently on shift,
 * their session cookie dies at the next middleware request — resolve_shift_session
 * requires sh.status = 'active'. Cancel is the kill switch.
 */

type StatusFilter = 'current' | 'all'

interface GateOption {
  id: string
  name: string
}

const DEFAULT_HOURS = 8

export function ShiftsClient({
  organizationId,
  orgStatus,
  gates,
  initialShifts,
}: {
  organizationId: string
  orgStatus: string
  gates: GateOption[]
  initialShifts: ShiftRow[]
}) {
  const router = useRouter()

  const [gateId, setGateId] = useState(gates[0]?.id ?? '')
  const [startLocal, setStartLocal] = useState('')
  const [endLocal, setEndLocal] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [justAdded, setJustAdded] = useState<{ gate: string; code: string } | null>(null)

  const [filter, setFilter] = useState<StatusFilter>('current')

  const [cancelTarget, setCancelTarget] = useState<ShiftRow | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const operational = orgStatus === 'active'

  // Current time in state — Date.now() during render is impure (React 19).
  // Updating once a minute keeps the "Current" filter accurate as shifts
  // expire, without the user needing to reload.
  const [now, setNow] = useState<number>(() => Date.now())
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(interval)
  }, [])

  const visibleShifts = initialShifts.filter((s) => {
    if (filter === 'all') return true
    if (s.status !== 'scheduled' && s.status !== 'active') return false
    return new Date(s.scheduled_end).getTime() > now
  })

  function clearMessages() {
    setError(null)
    setNotice(null)
  }

  // When start is set, default end to start + 8 hours.
  function onStartChange(v: string) {
    setStartLocal(v)
    if (!v) return
    const start = new Date(v)
    if (Number.isNaN(start.getTime())) return
    const end = new Date(start.getTime() + DEFAULT_HOURS * 3600 * 1000)
    // Format as YYYY-MM-DDTHH:MM (datetime-local format)
    const pad = (n: number) => String(n).padStart(2, '0')
    const formatted = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`
    setEndLocal(formatted)
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    clearMessages()
    setJustAdded(null)

    if (!gateId) {
      setError('Please choose a gate.')
      return
    }
    if (!startLocal || !endLocal) {
      setError('Please set a start and end time.')
      return
    }

    const start = new Date(startLocal)
    const end = new Date(endLocal)

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setError('Please enter valid dates and times.')
      return
    }

    if (start.getTime() < Date.now() - 60_000) {
      setError('Start time cannot be in the past.')
      return
    }

    if (end.getTime() <= start.getTime()) {
      setError('End time must be after the start time.')
      return
    }

    setSubmitting(true)
    try {
      const supabase = createClient()
      const { data, error: insertError } = await supabase
        .from('shifts')
        .insert({
          organization_id: organizationId,
          gate_id: gateId,
          shift_code: '',
          scheduled_start: start.toISOString(),
          scheduled_end: end.toISOString(),
          status: 'scheduled',
        })
        .select('shift_code')
        .single()

      if (insertError) {
        setError(mapInsertError(insertError.message))
        return
      }

      const gateName = gates.find((g) => g.id === gateId)?.name ?? 'Gate'
      setJustAdded({ gate: gateName, code: (data?.shift_code as string) ?? '' })
      setStartLocal('')
      setEndLocal('')
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel() {
    if (!cancelTarget) return
    clearMessages()
    setCancelling(true)
    try {
      const supabase = createClient()
      const { error: updateError } = await supabase
        .from('shifts')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancel_reason: 'cancelled by admin',
        })
        .eq('id', cancelTarget.id)

      if (updateError) {
        setError('Could not cancel the shift. Please try again.')
        return
      }

      setNotice(`${cancelTarget.shift_code} cancelled.`)
      setCancelTarget(null)
      router.refresh()
    } catch {
      setError('Could not cancel the shift. Please try again.')
    } finally {
      setCancelling(false)
    }
  }

  if (gates.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Shifts</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Scheduled time windows at each gate.
          </p>
        </header>
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
          Add a gate first — shifts are scheduled at a specific gate.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Shifts</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Scheduled time windows at each gate. Guards start a session by
          entering the shift code and their Guard ID.
        </p>
      </header>

      {!operational ? (
        <div className="bg-amber-500/10 text-amber-900 dark:text-amber-200 mb-6 rounded-md border border-amber-500/30 px-4 py-3 text-sm">
          <strong className="font-medium">Subscription not yet active.</strong>{' '}
          You can see existing shifts but cannot add new ones until your
          organization is active.
        </div>
      ) : null}

      <div className="mb-4 flex items-center gap-2">
        <FilterChip label="Current" value="current" current={filter} onSelect={setFilter} />
        <FilterChip label="All" value="all" current={filter} onSelect={setFilter} />
      </div>

      <section className="mb-8">
        {visibleShifts.length === 0 ? (
          <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-6 text-center text-sm">
            {filter === 'current'
              ? 'No active or upcoming shifts. Add one below.'
              : 'No shifts yet. Add your first one below.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visibleShifts.map((s) => {
              const cancellable =
                operational && (s.status === 'scheduled' || s.status === 'active')
              return (
                <li
                  key={s.id}
                  className="bg-muted/30 flex items-start justify-between gap-4 rounded-lg border px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{s.gate_name}</p>
                    <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">
                      {s.shift_code}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {formatRange(s.scheduled_start, s.scheduled_end)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <StatusBadge status={s.status} />
                    {cancellable ? (
                      <button
                        type="button"
                        onClick={() => setCancelTarget(s)}
                        className="text-muted-foreground hover:text-destructive text-xs underline underline-offset-4"
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-muted-foreground mb-3 text-sm font-medium tracking-wide uppercase">
          Add a shift
        </h2>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-lg border p-5">
          <div className="grid gap-2">
            <Label htmlFor="shiftGate">Gate</Label>
            <select
              id="shiftGate"
              value={gateId}
              onChange={(e) => setGateId(e.target.value)}
              disabled={!operational || submitting}
              className="border-input bg-background h-11 rounded-md border px-3 text-sm"
            >
              {gates.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="shiftStart">Start</Label>
            <Input
              id="shiftStart"
              type="datetime-local"
              value={startLocal}
              onChange={(e) => onStartChange(e.target.value)}
              disabled={!operational || submitting}
              className="h-11"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="shiftEnd">End</Label>
            <Input
              id="shiftEnd"
              type="datetime-local"
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
              disabled={!operational || submitting}
              className="h-11"
            />
            <p className="text-muted-foreground text-xs">
              Defaults to 8 hours after the start. Adjust if the shift is
              shorter or longer.
            </p>
          </div>

          {error ? (
            <p role="alert" className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
              {error}
            </p>
          ) : null}

          {notice ? (
            <p className="bg-muted rounded-md px-3 py-2 text-sm">{notice}</p>
          ) : null}

          {justAdded ? (
            <div className="bg-emerald-600/10 text-emerald-900 dark:text-emerald-200 rounded-md px-3 py-3 text-sm">
              <p className="font-medium">Shift added for {justAdded.gate}.</p>
              <p className="mt-2">
                Shift code:{' '}
                <span className="bg-background rounded px-2 py-0.5 font-mono font-medium">
                  {justAdded.code}
                </span>
              </p>
              <p className="text-muted-foreground mt-2 text-xs">
                Share this with the guard who will work this shift.
              </p>
            </div>
          ) : null}

          <div>
            <Button type="submit" disabled={!operational || submitting} className="h-11">
              {submitting ? 'Adding…' : 'Add shift'}
            </Button>
          </div>
        </form>
      </section>

      <AlertDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel {cancelTarget?.shift_code}?</AlertDialogTitle>
            <AlertDialogDescription>
              The shift code will no longer work at the gate. If a guard is
              currently on this shift, their session will end at the next
              request. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelling}>Keep shift</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void handleCancel()
              }}
              disabled={cancelling}
            >
              {cancelling ? 'Cancelling…' : 'Cancel shift'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
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
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-foreground text-background'
          : 'bg-muted text-muted-foreground hover:text-foreground'
      }`}
      aria-pressed={active}
    >
      {label}
    </button>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    scheduled: 'bg-blue-600/15 text-blue-800 dark:text-blue-300',
    active: 'bg-emerald-600/15 text-emerald-800 dark:text-emerald-300',
    completed: 'bg-muted text-muted-foreground',
    cancelled: 'bg-red-600/15 text-red-800 dark:text-red-300',
    interrupted: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  }
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        styles[status] ?? 'bg-muted text-muted-foreground'
      }`}
    >
      {status}
    </span>
  )
}

function formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso)
  const end = new Date(endIso)
  const dateStr = start.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  const timeStr = `${pad(start.getHours())}:${pad(start.getMinutes())} – ${pad(end.getHours())}:${pad(end.getMinutes())}`
  return `${dateStr} · ${timeStr}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function mapInsertError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('row-level security') || lower.includes('permission')) {
    return 'Your organization is not active yet. Complete setup or choose a plan first.'
  }
  if (lower.includes('shifts_scheduled_order')) {
    return 'End time must be after the start time.'
  }
  return 'Could not add the shift. Please try again.'
}
