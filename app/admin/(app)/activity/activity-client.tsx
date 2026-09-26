'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
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
import { STALE_SESSION_HOURS } from '@/lib/admin/sessions'
import type { SessionRow, EventRow, SessionFilter } from './page'

/**
 * Activity view — two tabs.
 *
 *   Sessions (default) — Today / Attention / All
 *   Events             — All / Failures only
 *
 * Row actions on the Sessions tab:
 *   is_stale (open + >STALE hours)  → Mark unresolved (calls mark_session_unresolved)
 *   status === 'unresolved'         → Add note        (calls resolve_session)
 *
 * After any action, router.refresh() re-runs the Server Component so the
 * list reflects the new state — no client-side list mutation, no drift.
 *
 * Both RPCs are SECURITY DEFINER, self-enforce org-admin, and are called
 * through the admin's own authenticated session.
 */

type Tab = 'sessions' | 'events'
type EventFilter = 'all' | 'failures'

export function ActivityClient({
  organizationId,
  windowDays,
  initialFilter,
  initialSessions,
  initialEvents,
}: {
  organizationId: string
  windowDays: number
  initialFilter: SessionFilter
  initialSessions: SessionRow[]
  initialEvents: EventRow[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('sessions')
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>(initialFilter)
  const [eventFilter, setEventFilter] = useState<EventFilter>('all')

  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Mark unresolved dialog
  const [markTarget, setMarkTarget] = useState<SessionRow | null>(null)
  const [markReason, setMarkReason] = useState('')
  const [marking, setMarking] = useState(false)

  // Add note dialog
  const [noteTarget, setNoteTarget] = useState<SessionRow | null>(null)
  const [noteReason, setNoteReason] = useState('')
  const [noteText, setNoteText] = useState('')
  const [noting, setNoting] = useState(false)

  // Compute today-at-midnight once on mount. Lazy useState initializer is
  // the React-19-correct pattern — no Date.now() during render.
  const [todayMs] = useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  })

  const visibleSessions = initialSessions.filter((s) => {
    if (sessionFilter === 'all') return true
    if (sessionFilter === 'attention') {
      return s.is_stale || s.status === 'unresolved'
    }
    // today
    return new Date(s.entered_at).getTime() >= todayMs
  })

  const visibleEvents = initialEvents.filter((e) => {
    if (eventFilter === 'all') return true
    return e.result_code !== 'GRANTED'
  })

  const attentionCount = initialSessions.filter(
    (s) => s.is_stale || s.status === 'unresolved',
  ).length

  function clearMessages() {
    setError(null)
    setNotice(null)
  }

  async function handleMarkUnresolved(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!markTarget) return
    clearMessages()

    const reason = markReason.trim()
    if (!reason) {
      setError('Please provide a reason.')
      return
    }

    setMarking(true)
    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc('mark_session_unresolved', {
        p_organization_id: organizationId,
        p_session_id: markTarget.id,
        p_reason: reason,
      })

      if (rpcError) {
        setError(mapMarkError(rpcError.message))
        return
      }

      setNotice(`${markTarget.person_name}'s session marked unresolved.`)
      setMarkTarget(null)
      setMarkReason('')
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setMarking(false)
    }
  }

  async function handleAddNote(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!noteTarget) return
    clearMessages()

    const reason = noteReason.trim()
    if (!reason) {
      setError('Please provide a short reason.')
      return
    }

    setNoting(true)
    try {
      const supabase = createClient()
      const { error: rpcError } = await supabase.rpc('resolve_session', {
        p_organization_id: organizationId,
        p_session_id: noteTarget.id,
        p_reason: reason,
        p_notes: noteText.trim() || null,
      })

      if (rpcError) {
        setError(mapNoteError(rpcError.message))
        return
      }

      setNotice('Note added.')
      setNoteTarget(null)
      setNoteReason('')
      setNoteText('')
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setNoting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Recent visits and gate events. Showing the last {windowDays} days.
        </p>
      </header>

      <div className="bg-muted mb-6 flex gap-1 rounded-lg p-1">
        <TabButton label="Sessions" value="sessions" current={tab} onSelect={setTab} />
        <TabButton
          label={attentionCount > 0 ? `Events` : 'Events'}
          value="events"
          current={tab}
          onSelect={setTab}
        />
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

      {tab === 'sessions' ? (
        <>
          <div className="mb-4 flex items-center gap-2">
            <FilterChip label="Today" value="today" current={sessionFilter} onSelect={setSessionFilter} />
            <FilterChip
              label={attentionCount > 0 ? `Attention (${attentionCount})` : 'Attention'}
              value="attention"
              current={sessionFilter}
              onSelect={setSessionFilter}
            />
            <FilterChip label={`All (${windowDays}d)`} value="all" current={sessionFilter} onSelect={setSessionFilter} />
          </div>
          <SessionList
            sessions={visibleSessions}
            onMarkUnresolved={setMarkTarget}
            onAddNote={setNoteTarget}
          />
        </>
      ) : (
        <>
          <div className="mb-4 flex items-center gap-2">
            <FilterChip label="All results" value="all" current={eventFilter} onSelect={setEventFilter} />
            <FilterChip label="Failures only" value="failures" current={eventFilter} onSelect={setEventFilter} />
          </div>
          <EventList events={visibleEvents} />
        </>
      )}

      {/* Mark unresolved dialog */}
      <AlertDialog
        open={markTarget !== null}
        onOpenChange={(open) => {
          if (!open && !marking) {
            setMarkTarget(null)
            setMarkReason('')
          }
        }}
      >
        <AlertDialogContent>
          <form onSubmit={handleMarkUnresolved}>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Mark {markTarget?.person_name}&apos;s visit as unresolved?
              </AlertDialogTitle>
              <AlertDialogDescription>
                The visitor entered {STALE_SESSION_HOURS}+ hours ago and no exit
                was recorded. Marking the session unresolved clears the
                blockage — the visitor can enter again. The historical record
                is preserved; the session is not deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="grid gap-2 py-4">
              <Label htmlFor="markReason">Reason</Label>
              <Input
                id="markReason"
                value={markReason}
                onChange={(e) => setMarkReason(e.target.value)}
                placeholder="e.g. left without scanning out"
                disabled={marking}
                autoFocus
                className="h-11"
              />
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel disabled={marking}>Cancel</AlertDialogCancel>
              <AlertDialogAction type="submit" disabled={marking || !markReason.trim()}>
                {marking ? 'Marking…' : 'Mark unresolved'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add note dialog */}
      <AlertDialog
        open={noteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !noting) {
            setNoteTarget(null)
            setNoteReason('')
            setNoteText('')
          }
        }}
      >
        <AlertDialogContent>
          <form onSubmit={handleAddNote}>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Add note to {noteTarget?.person_name}&apos;s session?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This session was already marked unresolved. Add investigation
                details to the record. The session status does not change.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="grid gap-3 py-4">
              <div className="grid gap-2">
                <Label htmlFor="noteReason">Reason</Label>
                <Input
                  id="noteReason"
                  value={noteReason}
                  onChange={(e) => setNoteReason(e.target.value)}
                  placeholder="e.g. investigated, unit owner confirmed departure"
                  disabled={noting}
                  autoFocus
                  className="h-11"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="noteText">
                  Notes{' '}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="noteText"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Additional detail"
                  disabled={noting}
                  className="h-11"
                />
              </div>
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel disabled={noting}>Cancel</AlertDialogCancel>
              <AlertDialogAction type="submit" disabled={noting || !noteReason.trim()}>
                {noting ? 'Saving…' : 'Add note'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------

function TabButton<T extends string>({
  label, value, current, onSelect,
}: {
  label: string; value: T; current: T; onSelect: (v: T) => void
}) {
  const active = current === value
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={active}
      className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
        active ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

function FilterChip<T extends string>({
  label, value, current, onSelect,
}: {
  label: string; value: T; current: T; onSelect: (v: T) => void
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

function SessionList({
  sessions,
  onMarkUnresolved,
  onAddNote,
}: {
  sessions: SessionRow[]
  onMarkUnresolved: (s: SessionRow) => void
  onAddNote: (s: SessionRow) => void
}) {
  if (sessions.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
        No sessions in this view.
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-2">
      {sessions.map((s) => (
        <li key={s.id} className="bg-muted/30 rounded-lg border px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate font-medium">{s.person_name}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {formatTime(s.entered_at)} → {s.exited_at ? formatTime(s.exited_at) : 'still inside'}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {s.gate_entered_name}
                {s.gate_exited_name && s.gate_exited_name !== s.gate_entered_name
                  ? ` → ${s.gate_exited_name}`
                  : ''}
              </p>
              {s.status === 'unresolved' && s.resolution_reason ? (
                <p className="text-muted-foreground mt-1 text-xs italic">
                  Note: {s.resolution_reason}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <SessionStatusBadge status={s.status} isStale={s.is_stale} />
              {s.is_stale ? (
                <button
                  type="button"
                  onClick={() => onMarkUnresolved(s)}
                  className="text-xs underline underline-offset-4 text-amber-800 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-200"
                >
                  Mark unresolved
                </button>
              ) : null}
              {s.status === 'unresolved' && !s.resolution_reason ? (
                <button
                  type="button"
                  onClick={() => onAddNote(s)}
                  className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
                >
                  Add note
                </button>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

function SessionStatusBadge({ status, isStale }: { status: string; isStale: boolean }) {
  let cls = 'bg-muted text-muted-foreground'
  let label = status

  if (status === 'open') {
    if (isStale) {
      cls = 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
      label = 'Stale'
    } else {
      cls = 'bg-blue-600/15 text-blue-800 dark:text-blue-300'
      label = 'Inside'
    }
  } else if (status === 'completed') {
    cls = 'bg-emerald-600/15 text-emerald-800 dark:text-emerald-300'
  } else if (status === 'unresolved') {
    cls = 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
  }

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  )
}

function EventList({ events }: { events: EventRow[] }) {
  if (events.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
        No events in this view.
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-1">
      {events.map((e) => (
        <li key={e.id} className="rounded-md border px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <ResultBadge code={e.result_code} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {e.direction === 'entry' ? 'Entry' : 'Exit'}
                  {e.person_name ? ` · ${e.person_name}` : ''}
                </p>
                <p className="text-muted-foreground mt-0.5 truncate text-xs">
                  {e.gate_name} · {e.guard_code}
                  {e.reason ? ` · ${e.reason}` : ''}
                </p>
              </div>
            </div>
            <span className="text-muted-foreground shrink-0 text-xs">
              {formatTime(e.recorded_at)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}

function ResultBadge({ code }: { code: string }) {
  const tier =
    code === 'GRANTED'
      ? 'positive'
      : ['EXPIRED_AUTHORIZATION', 'UNRESOLVED_VISIT', 'NO_ACTIVE_SESSION', 'RATE_LIMITED', 'DENIED'].includes(code)
        ? 'warning'
        : 'negative'
  const styles: Record<string, string> = {
    positive: 'bg-emerald-600/15 text-emerald-800 dark:text-emerald-300',
    warning: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
    negative: 'bg-red-600/15 text-red-800 dark:text-red-300',
  }
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-tight ${styles[tier]}`}>
      {code}
    </span>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`

  if (d.getTime() >= today.getTime()) return time
  if (d.getTime() >= yesterday.getTime()) return `Yesterday ${time}`
  return `${d.getDate()} ${d.toLocaleString(undefined, { month: 'short' })} ${time}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function mapMarkError(message: string): string {
  if (message.includes('NOT_AUTHORIZED')) return 'You don’t have permission for this action.'
  if (message.includes('REASON_REQUIRED')) return 'Please provide a reason.'
  if (message.includes('SESSION_NOT_OPEN')) {
    return 'This session is no longer open — someone else may have just updated it.'
  }
  return 'Could not mark the session. Please try again.'
}

function mapNoteError(message: string): string {
  if (message.includes('NOT_AUTHORIZED')) return 'You don’t have permission for this action.'
  if (message.includes('REASON_REQUIRED')) return 'Please provide a reason.'
  if (message.includes('SESSION_NOT_RESOLVABLE')) {
    return 'This session cannot be annotated — someone else may have just updated it.'
  }
  return 'Could not add the note. Please try again.'
}
