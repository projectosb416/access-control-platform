import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ActivityClient } from './activity-client'

/**
 * /admin/activity — sessions and raw events for the admin's org.
 *
 * Two views in one page:
 *   Sessions — who came in, who's inside, who left. The daily question.
 *   Events   — every attempt, including failures. The security view.
 *
 * Both queries are scoped by RLS to the admin's org. FK names are explicit
 * because access_sessions has two FKs to gates (entered and exited) and
 * Supabase needs disambiguation.
 */

const DAYS_WINDOW = 7
const SESSIONS_LIMIT = 100
const EVENTS_LIMIT = 300

// Locally-typed shapes for joined results. Supabase's string-select parser
// does not infer nested FK shapes when names are qualified. We cast the
// result through `unknown` to these shapes — the query string is the
// source of truth, this is a typing gap only.
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

export default async function ActivityPage() {
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
  // hazard — the React 19 purity rule fires because the same rule catches
  // Client Components. Justified disable.
  // eslint-disable-next-line react-hooks/purity
  const since = new Date(Date.now() - DAYS_WINDOW * 24 * 60 * 60 * 1000).toISOString()

  const { data: sessionRaw } = await supabase
    .from('access_sessions')
    .select(
      [
        'id',
        'status',
        'entered_at',
        'exited_at',
        'resolved_at',
        'resolution_reason',
        'person:people!access_sessions_person_id_fkey(full_name)',
        'gate_entered:gates!access_sessions_gate_entered_id_fkey(name)',
        'gate_exited:gates!access_sessions_gate_exited_id_fkey(name)',
      ].join(', '),
    )
    .eq('organization_id', organizationId)
    .gte('entered_at', since)
    .order('entered_at', { ascending: false })
    .limit(SESSIONS_LIMIT)

  const { data: eventRaw } = await supabase
    .from('access_events')
    .select(
      [
        'id',
        'direction',
        'result_code',
        'reason',
        'recorded_at',
        'person:people!access_events_person_id_fkey(full_name)',
        'gate:gates!access_events_gate_id_fkey(name)',
        'guard_profile:guard_profiles!access_events_guard_profile_id_fkey(guard_code)',
      ].join(', '),
    )
    .eq('organization_id', organizationId)
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: false })
    .limit(EVENTS_LIMIT)

  const sessionRows = (sessionRaw ?? []) as unknown as SessionQueryRow[]
  const eventRows = (eventRaw ?? []) as unknown as EventQueryRow[]

  const sessions: SessionRow[] = sessionRows.map((s) => {
    const person = unwrap(s.person)
    const gIn = unwrap(s.gate_entered)
    const gOut = unwrap(s.gate_exited)
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
    }
  })

  const events: EventRow[] = eventRows.map((e) => {
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
      windowDays={DAYS_WINDOW}
      initialSessions={sessions}
      initialEvents={events}
    />
  )
}

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
