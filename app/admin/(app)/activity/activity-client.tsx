'use client'

import { useState } from 'react'
import type { SessionRow, EventRow } from './page'

/**
 * Activity view — two tabs, one page.
 *
 *   Sessions (default) — who came in, who's inside, who left.
 *   Events             — every attempt including failures.
 *
 * No pagination or infinite scroll for v1. Capped at 100 sessions / 300
 * events fetched server-side, filtered to the last 7 days. When volume
 * justifies it, add virtualized lists and cursor pagination.
 */

type Tab = 'sessions' | 'events'
type SessionFilter = 'today' | 'week'
type EventFilter = 'all' | 'failures'

export function ActivityClient({
  windowDays,
  initialSessions,
  initialEvents,
}: {
  windowDays: number
  initialSessions: SessionRow[]
  initialEvents: EventRow[]
}) {
  const [tab, setTab] = useState<Tab>('sessions')
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('today')
  const [eventFilter, setEventFilter] = useState<EventFilter>('all')

  const startOfToday = startOfTodayMs()

  const visibleSessions = initialSessions.filter((s) => {
    if (sessionFilter === 'week') return true
    return new Date(s.entered_at).getTime() >= startOfToday
  })

  const visibleEvents = initialEvents.filter((e) => {
    if (eventFilter === 'all') return true
    return e.result_code !== 'GRANTED'
  })

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Recent visits and gate events. Showing the last {windowDays} days.
        </p>
      </header>

      {/* Tab switcher */}
      <div className="bg-muted mb-6 flex gap-1 rounded-lg p-1">
        <TabButton label="Sessions" value="sessions" current={tab} onSelect={setTab} />
        <TabButton label="Events" value="events" current={tab} onSelect={setTab} />
      </div>

      {tab === 'sessions' ? (
        <>
          <div className="mb-4 flex items-center gap-2">
            <FilterChip label="Today" value="today" current={sessionFilter} onSelect={setSessionFilter} />
            <FilterChip label={`Last ${windowDays} days`} value="week" current={sessionFilter} onSelect={setSessionFilter} />
          </div>
          <SessionList sessions={visibleSessions} />
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
    </div>
  )
}

// ---------------------------------------------------------------------------

function TabButton<T extends string>({
  label,
  value,
  current,
  onSelect,
}: {
  label: string
  value: T
  current: T
  onSelect: (v: T) => void
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
  label,
  value,
  current,
  onSelect,
}: {
  label: string
  value: T
  current: T
  onSelect: (v: T) => void
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

// ---------------------------------------------------------------------------

function SessionList({ sessions }: { sessions: SessionRow[] }) {
  if (sessions.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
        No sessions in this window.
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
                {formatTime(s.entered_at)}
                {' → '}
                {s.exited_at ? formatTime(s.exited_at) : 'still inside'}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {s.gate_entered_name}
                {s.gate_exited_name && s.gate_exited_name !== s.gate_entered_name
                  ? ` → ${s.gate_exited_name}`
                  : ''}
              </p>
              {s.status === 'unresolved' && s.resolution_reason ? (
                <p className="text-muted-foreground mt-1 text-xs italic">
                  Resolved: {s.resolution_reason}
                </p>
              ) : null}
            </div>
            <SessionStatusBadge status={s.status} />
          </div>
        </li>
      ))}
    </ul>
  )
}

function SessionStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    open: 'bg-blue-600/15 text-blue-800 dark:text-blue-300',
    completed: 'bg-emerald-600/15 text-emerald-800 dark:text-emerald-300',
    unresolved: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  }
  const label = status === 'open' ? 'Inside' : status
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        styles[status] ?? 'bg-muted text-muted-foreground'
      }`}
    >
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------

function EventList({ events }: { events: EventRow[] }) {
  if (events.length === 0) {
    return (
      <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
        No events in this window.
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
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-tight ${styles[tier]}`}
    >
      {code}
    </span>
  )
}

// ---------------------------------------------------------------------------

function startOfTodayMs(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`

  if (d.getTime() >= today.getTime()) {
    return time
  }

  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  if (d.getTime() >= yesterday.getTime()) {
    return `Yesterday ${time}`
  }

  return `${d.getDate()} ${d.toLocaleString(undefined, { month: 'short' })} ${time}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
