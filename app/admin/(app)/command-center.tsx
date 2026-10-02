import {
  DoorOpen,
  ShieldCheck,
  LogIn,
  LogOut,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { STALE_SESSION_HOURS } from '@/lib/admin/sessions'
import { RefreshButton } from './refresh-button'

/**
 * Command Center — static panels for an operational admin.
 *
 * Server Component. All panels fetch server-side. B1 is intentionally
 * static — no Realtime subscription. Refresh is a manual button. B2
 * swaps individual panels to live updates without changing the shape.
 *
 * Rendered only when the org is active. Provisioning/suspended orgs get
 * the state-routing experience from /admin/page.tsx instead.
 *
 * All reads are directly permitted by existing RLS policies:
 *   access_sessions       — no admin policy, but access_events and the
 *                           admin path both derive visibility from the org
 *                           membership check used by related tables
 *   access_events         — access_events_select_admin
 *   shift_sessions        — shift_sessions_select_admin_or_own
 *   gates                 — gates_select_member
 *
 * Panels in priority order:
 *   1. Attention banner   — only if stale sessions exist
 *   2. Currently inside   — count + up to 5 names
 *   3. Today at a glance  — entries, exits, guards on shift, gates active
 *   4. Gates              — per-gate active guard count vs capacity
 *   5. Live activity      — last 10 events
 *   6. Shifts in progress — active shift_sessions
 */

export async function CommandCenter({
  organizationId,
}: {
  organizationId: string
}) {
  const supabase = await createClient()

  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()
  const todayStartIso = new Date(
    Date.UTC(
      new Date(nowMs).getUTCFullYear(),
      new Date(nowMs).getUTCMonth(),
      new Date(nowMs).getUTCDate(),
    ),
  ).toISOString()
  const staleThresholdIso = new Date(
    nowMs - STALE_SESSION_HOURS * 60 * 60 * 1000,
  ).toISOString()

  // ---------------------------------------------------------------------
  // Parallel fetch — one round-trip wait for all panels
  // ---------------------------------------------------------------------

  const [
    staleRes,
    insideRes,
    entriesTodayRes,
    exitsTodayRes,
    activeGatesRes,
    recentEventsRes,
    activeShiftSessionsRes,
  ] = await Promise.all([
    supabase
      .from('access_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', 'open')
      .lt('entered_at', staleThresholdIso),

    supabase
      .from('access_sessions')
      .select(
        'id, entered_at, person:people!access_sessions_person_id_fkey(full_name)',
      )
      .eq('organization_id', organizationId)
      .eq('status', 'open')
      .order('entered_at', { ascending: false })
      .limit(5),

    supabase
      .from('access_events')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('direction', 'entry')
      .eq('result_code', 'GRANTED')
      .gte('recorded_at', todayStartIso),

    supabase
      .from('access_events')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('direction', 'exit')
      .eq('result_code', 'GRANTED')
      .gte('recorded_at', todayStartIso),

    supabase
      .from('gates')
      .select('id, name, max_active_guards, status')
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .order('name'),

    supabase
      .from('access_events')
      .select(
        'id, direction, result_code, reason, recorded_at, person:people!access_events_person_id_fkey(full_name), gate:gates!access_events_gate_id_fkey(name)',
      )
      .eq('organization_id', organizationId)
      .order('recorded_at', { ascending: false })
      .limit(10),

    // Active shift_sessions. RLS scopes to shifts this admin can see.
    supabase
      .from('shift_sessions')
      .select('id, shift_id, guard_profile_id, started_at')
      .eq('status', 'active')
      .order('started_at', { ascending: false }),
  ])

  const staleCount = staleRes.count ?? 0

  // ---- Currently inside ------------------------------------------------
  const insideRows = (insideRes.data ?? []) as unknown as Array<{
    id: string
    entered_at: string
    person: { full_name: string | null } | { full_name: string | null }[] | null
  }>

  const inside = insideRows.map((r) => ({
    id: r.id,
    entered_at: r.entered_at,
    person_name: unwrap(r.person)?.full_name ?? 'Unknown',
  }))

  // ---- Today counts ----------------------------------------------------
  const entriesToday = entriesTodayRes.count ?? 0
  const exitsToday = exitsTodayRes.count ?? 0

  // ---- Gates + per-gate guard count ------------------------------------
  const gates = ((activeGatesRes.data ?? []) as unknown as Array<{
    id: string
    name: string
    max_active_guards: number
    status: string
  }>).map((g) => ({
    id: g.id,
    name: g.name,
    max_active_guards: g.max_active_guards,
    active_guards: 0, // populated below
  }))

  // Resolve shift_id → gate_id so we can count active sessions per gate.
  const activeShiftSessions = (activeShiftSessionsRes.data ?? []) as unknown as Array<{
    id: string
    shift_id: string
    guard_profile_id: string
    started_at: string
  }>

  const shiftIds = Array.from(new Set(activeShiftSessions.map((s) => s.shift_id)))
  const guardProfileIds = Array.from(
    new Set(activeShiftSessions.map((s) => s.guard_profile_id)),
  )

  const [shiftsRes, guardProfilesRes] = await Promise.all([
    shiftIds.length
      ? supabase
          .from('shifts')
          .select('id, gate_id, shift_code')
          .in('id', shiftIds)
      : Promise.resolve({ data: [] as unknown[] }),
    guardProfileIds.length
      ? supabase
          .from('guard_profiles')
          .select('id, guard_code, person_id')
          .in('id', guardProfileIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ])

  const shiftById = new Map(
    ((shiftsRes.data ?? []) as unknown as Array<{
      id: string
      gate_id: string
      shift_code: string
    }>).map((s) => [s.id, s]),
  )

  const guardProfiles = (guardProfilesRes.data ?? []) as unknown as Array<{
    id: string
    guard_code: string
    person_id: string
  }>
  const guardById = new Map(guardProfiles.map((g) => [g.id, g]))

  // Resolve guard person names in one batch.
  const guardPersonIds = Array.from(new Set(guardProfiles.map((g) => g.person_id)))
  const personNameById = new Map<string, string>()
  if (guardPersonIds.length > 0) {
    const { data: peopleRows } = await supabase
      .from('people')
      .select('id, full_name')
      .in('id', guardPersonIds)
    for (const p of (peopleRows ?? []) as Array<{ id: string; full_name: string }>) {
      personNameById.set(p.id, p.full_name)
    }
  }

  // Populate active_guards per gate.
  const gateActiveCounts = new Map<string, number>()
  for (const s of activeShiftSessions) {
    const shift = shiftById.get(s.shift_id)
    if (!shift) continue
    gateActiveCounts.set(
      shift.gate_id,
      (gateActiveCounts.get(shift.gate_id) ?? 0) + 1,
    )
  }
  const gatesWithCounts = gates.map((g) => ({
    ...g,
    active_guards: gateActiveCounts.get(g.id) ?? 0,
  }))

  const guardsOnShift = activeShiftSessions.length

  // ---- Live activity ---------------------------------------------------
  const recentEvents = ((recentEventsRes.data ?? []) as unknown as Array<{
    id: string
    direction: string
    result_code: string
    reason: string | null
    recorded_at: string
    person: { full_name: string | null } | { full_name: string | null }[] | null
    gate: { name: string } | { name: string }[] | null
  }>).map((e) => ({
    id: e.id,
    direction: e.direction,
    result_code: e.result_code,
    reason: e.reason,
    recorded_at: e.recorded_at,
    person_name: unwrap(e.person)?.full_name ?? 'Unknown',
    gate_name: unwrap(e.gate)?.name ?? '—',
  }))

  // ---- Shifts in progress ----------------------------------------------
  const shiftsInProgress = activeShiftSessions.map((s) => {
    const shift = shiftById.get(s.shift_id)
    const gp = guardById.get(s.guard_profile_id)
    return {
      id: s.id,
      started_at: s.started_at,
      shift_code: shift?.shift_code ?? '—',
      gate_id: shift?.gate_id ?? '',
      gate_name:
        gatesWithCounts.find((g) => g.id === shift?.gate_id)?.name ?? '—',
      guard_code: gp?.guard_code ?? '—',
      guard_name: gp ? personNameById.get(gp.person_id) ?? '—' : '—',
    }
  })

  // ---------------------------------------------------------------------

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-4">
        <h2 className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Command Center
        </h2>
        <RefreshButton />
      </header>

      {staleCount > 0 ? <AttentionBanner staleCount={staleCount} /> : null}

      <CurrentlyInsidePanel inside={inside} nowIso={nowIso} />

      <TodayAtAGlance
        entries={entriesToday}
        exits={exitsToday}
        guards={guardsOnShift}
        gatesActive={gatesWithCounts.length}
      />

      <GatesPanel gates={gatesWithCounts} />

      <LiveActivityPanel events={recentEvents} nowIso={nowIso} />

      <ShiftsInProgressPanel shifts={shiftsInProgress} nowIso={nowIso} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function AttentionBanner({ staleCount }: { staleCount: number }) {
  return (
    <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
        {staleCount} session{staleCount === 1 ? '' : 's'} need attention
      </p>
      <p className="mt-0.5 text-xs text-amber-900/80 dark:text-amber-200/80">
        Visitors entered more than {STALE_SESSION_HOURS} hours ago and no exit
        was recorded.
      </p>
      <a
        href="/admin/activity?filter=attention"
        className="mt-2 inline-block text-xs font-medium text-amber-900 underline underline-offset-4 dark:text-amber-200"
      >
        Review →
      </a>
    </section>
  )
}

function Panel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="bg-muted/40 rounded-lg border p-5">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  )
}

function CurrentlyInsidePanel({
  inside,
  nowIso,
}: {
  inside: Array<{ id: string; entered_at: string; person_name: string }>
  nowIso: string
}) {
  return (
    <Panel title="Currently inside">
      {inside.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No visitors currently inside.
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="relative inline-flex h-2 w-2 shrink-0">
              <span className="bg-emerald-500 absolute inline-flex h-full w-full rounded-full opacity-75" />
            </span>
            <span className="text-2xl font-semibold tracking-tight">
              {inside.length}
            </span>
            <span className="text-muted-foreground text-sm">
              {inside.length === 1 ? 'person' : 'people'} inside
            </span>
          </div>
          <ul className="mt-3 flex flex-col gap-1">
            {inside.map((p) => (
              <li key={p.id} className="text-sm">
                <span className="font-medium">{p.person_name}</span>
                <span className="text-muted-foreground"> · since {formatAbsolute(new Date(p.entered_at), new Date(nowIso))}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}

function TodayAtAGlance({
  entries,
  exits,
  guards,
  gatesActive,
}: {
  entries: number
  exits: number
  guards: number
  gatesActive: number
}) {
  const counters = [
    { label: 'Entries', value: entries, icon: LogIn },
    { label: 'Exits', value: exits, icon: LogOut },
    { label: 'Guards on shift', value: guards, icon: ShieldCheck },
    { label: 'Gates active', value: gatesActive, icon: DoorOpen },
  ]
  return (
    <Panel title="Today at a glance">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counters.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="bg-background flex flex-col gap-1 rounded-md border px-3 py-3"
          >
            <Icon className="text-muted-foreground h-4 w-4" />
            <span className="text-2xl font-semibold tracking-tight">
              {value}
            </span>
            <span className="text-muted-foreground text-xs">{label}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

function GatesPanel({
  gates,
}: {
  gates: Array<{
    id: string
    name: string
    max_active_guards: number
    active_guards: number
  }>
}) {
  return (
    <Panel title="Gates">
      {gates.length === 0 ? (
        <p className="text-muted-foreground text-sm">No active gates.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {gates.map((g) => {
            const over = g.active_guards > g.max_active_guards
            return (
              <li
                key={g.id}
                className="bg-background flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <span className="truncate text-sm font-medium">{g.name}</span>
                <span
                  className={
                    'text-xs font-medium ' +
                    (over
                      ? 'text-destructive'
                      : g.active_guards === g.max_active_guards
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-muted-foreground')
                  }
                >
                  {g.active_guards} of {g.max_active_guards} guards
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function LiveActivityPanel({
  events,
  nowIso,
}: {
  events: Array<{
    id: string
    direction: string
    result_code: string
    reason: string | null
    recorded_at: string
    person_name: string
    gate_name: string
  }>
  nowIso: string
}) {
  return (
    <Panel title="Live activity">
      {events.length === 0 ? (
        <p className="text-muted-foreground text-sm">No recent activity.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {events.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="text-muted-foreground mr-2 text-xs uppercase">
                  {e.direction}
                </span>
                <span className="font-medium">{e.person_name}</span>
                <span className="text-muted-foreground"> · {e.gate_name}</span>
              </span>
              <span
                className={
                  'shrink-0 text-xs font-medium ' +
                  (e.result_code === 'GRANTED'
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-destructive')
                }
              >
                {e.result_code}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {formatAbsolute(new Date(e.recorded_at), new Date(nowIso))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function ShiftsInProgressPanel({
  shifts,
  nowIso,
}: {
  shifts: Array<{
    id: string
    started_at: string
    shift_code: string
    gate_name: string
    guard_code: string
    guard_name: string
  }>
  nowIso: string
}) {
  return (
    <Panel title="Shifts in progress">
      {shifts.length === 0 ? (
        <p className="text-muted-foreground text-sm">No active shifts.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shifts.map((s) => (
            <li
              key={s.id}
              className="bg-background flex flex-col gap-0.5 rounded-md border px-3 py-2"
            >
              <span className="text-sm font-medium">
                {s.guard_name} · {s.guard_code}
              </span>
              <span className="text-muted-foreground text-xs">
                {s.gate_name} · {s.shift_code}
              </span>
              <span className="text-muted-foreground text-xs">
                Started {formatAbsolute(new Date(s.started_at), new Date(nowIso))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

function formatAbsolute(d: Date, now: Date): string {
  const sameDay =
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()

  if (sameDay) return `today at ${formatTimeUTC(d)}`

  const yesterday = new Date(now)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const isYesterday =
    d.getUTCFullYear() === yesterday.getUTCFullYear() &&
    d.getUTCMonth() === yesterday.getUTCMonth() &&
    d.getUTCDate() === yesterday.getUTCDate()

  if (isYesterday) return `yesterday at ${formatTimeUTC(d)}`

  return `${formatDateUTC(d)} at ${formatTimeUTC(d)}`
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
