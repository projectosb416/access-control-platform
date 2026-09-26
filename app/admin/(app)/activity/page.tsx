import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ActivityClient } from './activity-client'
import { STALE_SESSION_HOURS } from '@/lib/admin/sessions'

/**
 * /admin/activity — sessions and raw events for the admin's org.
 *
 * Two views:
 *   Sessions — Today / Attention / All
 *   Events   — All / Failures only
 *
 * "Attention" surfaces sessions that need admin action: open more than
 * STALE_SESSION_HOURS, or already marked unresolved. This is the surface
 * that closes known-issue #1 (unresolved sessions currently requiring
 * manual SQL).
 *
 * FK names in joins are explicit — access_sessions has two FKs to gates
 * (entered and exited), so Supabase needs disambiguation.
 */

const DAYS_WINDOW = 7
const SESSIONS_LIMIT = 200
const EVENTS_LIMIT = 300

interface SessionQueryRow {
  id: string
  status: string
  entered_at: string
  exited_at: string | null
  resolved_at: string | null
  resolution_reason: string | null
  person: { full_name: string } | { full_name: string }[] | null
  gate_entered: { name: string } | { name: string }[] | null
  gate_exited: { name: string } | { name: string }[] | null
}

interface EventQueryRow {
  id: string
  direction: 'entry' | 'exit'
  result_code: string
  reason: string | null
  recorded_at: string
  person: { full_name: string } | { full_name: string }[] | null
  gate: { name: string } | { name: string }[] | null
  guard_profile: { guard_code: string } | { guard_code: string }[] | null
}

function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

const SESSION_SELECT = [
  'id',
  'status',
  'entered_at',
  'exited_at',
  'resolved_at',
  'resolution_reason',
  'person:people!access_sessions_person_id_fkey(full_name)',
  'gate_entered:gates!access_sessions_gate_entered_id_fkey(name)',
  'gate_exited:gates!access_sessions_gate_exited_id_fkey(name)',
].join(', ')

const EVENT_SELECT = [
  'id',
  'direction',
  'result_code',
  'reason',
  'recorded_at',
  'person:people!access_events_person_id_fkey(full_name)',
  'gate:gates!access_events_gate_id_fkey(name)',
  'guard_profile:guard_profiles!access_events_guard_profile_id_fkey(guard_code)',
].join(', ')

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  const params = await searchParams
  const initialFilter: SessionFilter =
    params.filter === 'attention'
      ? 'attention'
      : params.filter === 'all'
        ? 'all'
        : 'today'

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/admin/login')
  }

  const { data: membership } = await supabase
    .from('organization_memberships')
    .select('organization_id')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (!membership) {
    redirect('/admin/setup')
  }

  const organizationId = membership.organization_id as string

  // Server Components are per-request. Date.now() here is not a re-render
  // hazard. Justified disable of the React 19 purity rule.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now()
  const since = new Date(nowMs - DAYS_WINDOW * 24 * 60 * 60 * 1000).toISOString()
  const staleThresholdMs = nowMs - STALE_SESSION_HOURS * 60 * 60 * 1000
  const staleThresholdIso = new Date(staleThresholdMs).toISOString()

  // Query 1: everything in the window (7 days back).
  const { data: sessionRaw } = await supabase
    .from('access_sessions')
    .select(SESSION_SELECT)
    .eq('organization_id', organizationId)
    .gte('entered_at', since)
    .order('entered_at', { ascending: false })
    .limit(SESSIONS_LIMIT)

  // Query 2: stale-open sessions outside the window. If a visitor entered
  // 10 days ago and never exited, we still need to surface it.
  const { data: staleRaw } = await supabase
    .from('access_sessions')
    .select(SESSION_SELECT)
    .eq('organization_id', organizationId)
    .eq('status', 'open')
    .lt('entered_at', staleThresholdIso)
    .order('entered_at', { ascending: true })
    .limit(SESSIONS_LIMIT)

  const { data: eventRaw } = await supabase
    .from('access_events')
    .select(EVENT_SELECT)
    .eq('organization_id', organizationId)
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: false })
    .limit(EVENTS_LIMIT)

  const mergedRows = new Map<string, SessionQueryRow>()
  for (const r of (sessionRaw ?? []) as unknown as SessionQueryRow[]) {
    mergedRows.set(r.id, r)
  }
  for (const r of (staleRaw ?? []) as unknown as SessionQueryRow[]) {
    if (!mergedRows.has(r.id)) mergedRows.set(r.id, r)
  }

  const sessions: SessionRow[] = Array.from(mergedRows.values()).map((s) => {
    const person = unwrap(s.person)
    const gIn = unwrap(s.gate_entered)
    const gOut = unwrap(s.gate_exited)
    const enteredMs = new Date(s.entered_at).getTime()
    const isStale = s.status === 'open' && enteredMs < staleThresholdMs

    return {
      id: s.id,
      status: s.status,
      entered_at: s.entered_at,
      exited_at: s.exited_at,
      resolved_at: s.resolved_at,
      resolution_reason: s.resolution_reason,
      person_name: person?.full_name ?? 'Unknown',
      gate_entered_name: gIn?.name ?? '—',
      gate_exited_name: gOut?.name ?? null,
      is_stale: isStale,
    }
  })

  // Sort merged by entered_at desc for display
  sessions.sort(
    (a, b) => new Date(b.entered_at).getTime() - new Date(a.entered_at).getTime(),
  )

  const events: EventRow[] = ((eventRaw ?? []) as unknown as EventQueryRow[]).map((e) => {
    const person = unwrap(e.person)
    const gate = unwrap(e.gate)
    const guard = unwrap(e.guard_profile)
    return {
      id: e.id,
      direction: e.direction,
      result_code: e.result_code,
      reason: e.reason,
      recorded_at: e.recorded_at,
      person_name: person?.full_name ?? null,
      gate_name: gate?.name ?? '—',
      guard_code: guard?.guard_code ?? '—',
    }
  })

  return (
    <ActivityClient
      organizationId={organizationId}
      windowDays={DAYS_WINDOW}
      initialFilter={initialFilter}
      initialSessions={sessions}
      initialEvents={events}
    />
  )
}

export type SessionFilter = 'today' | 'attention' | 'all'

export interface SessionRow {
  id: string
  status: string
  entered_at: string
  exited_at: string | null
  resolved_at: string | null
  resolution_reason: string | null
  person_name: string
  gate_entered_name: string
  gate_exited_name: string | null
  is_stale: boolean
}

export interface EventRow {
  id: string
  direction: 'entry' | 'exit'
  result_code: string
  reason: string | null
  recorded_at: string
  person_name: string | null
  gate_name: string
  guard_code: string
}
