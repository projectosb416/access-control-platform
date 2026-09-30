import type { UnitVisit } from './types'

/**
 * Recent visits to the resident's unit. Server Component — no client
 * interaction, no dialogs, no state. Renders three presentations:
 *
 *   open        — live 'Inside' badge, exit info omitted
 *   completed   — entry and exit times, both shown
 *   unresolved  — entry time + honest 'Exit not recorded' marker;
 *                 '(resolved)' suffix when admin has since closed it
 *
 * The unresolved treatment is deliberate. Per §Locked Decisions
 * ('no fabricated exits'), a session with no recorded exit is not the
 * same as a completed visit — displaying it as past-tense history
 * would imply a confidence the data doesn't have.
 *
 * Time formatting is local to this file, mirroring the pattern already
 * used in guest-pin-section.tsx. A shared helper would be cleaner but
 * would touch more files than this slice warrants; noted as a future
 * refactor candidate.
 */

export function RecentVisitsSection({
  visits,
  nowIso,
}: {
  visits: UnitVisit[]
  nowIso: string
}) {
  return (
    <section className="bg-muted/40 mt-6 rounded-lg border p-5">
      <header className="mb-4">
        <h2 className="text-base font-medium">Recent visits</h2>
      </header>

      {visits.length === 0 ? (
        <p className="text-muted-foreground text-sm">No visits yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visits.map((v) => (
            <VisitRow key={v.session_id} visit={v} nowIso={nowIso} />
          ))}
        </ul>
      )}
    </section>
  )
}

function VisitRow({ visit, nowIso }: { visit: UnitVisit; nowIso: string }) {
  const entered = formatAbsolute(new Date(visit.entered_at), new Date(nowIso))

  return (
    <li className="bg-background flex flex-col gap-1 rounded-md border px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium">
          {visit.visitor_name}
        </span>
        {visit.status === 'open' ? (
          <span className="shrink-0 rounded border border-emerald-600/40 bg-emerald-600/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
            Inside
          </span>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">{describeTimes(visit, entered, nowIso)}</p>
    </li>
  )
}

function describeTimes(
  visit: UnitVisit,
  entered: string,
  nowIso: string,
): string {
  if (visit.status === 'open') {
    return `Entered ${entered}`
  }

  if (visit.status === 'completed' && visit.exited_at) {
    const exited = formatAbsolute(new Date(visit.exited_at), new Date(nowIso))
    return `Entered ${entered} · Exited ${exited}`
  }

  // unresolved
  const base = `Entered ${entered} · Exit not recorded`
  return visit.resolved_at ? `${base} (resolved)` : base
}

function formatAbsolute(d: Date, now: Date): string {
  const sameDay =
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()

  if (sameDay) {
    return `today at ${formatTimeUTC(d)}`
  }

  const yesterday = new Date(now)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const isYesterday =
    d.getUTCFullYear() === yesterday.getUTCFullYear() &&
    d.getUTCMonth() === yesterday.getUTCMonth() &&
    d.getUTCDate() === yesterday.getUTCDate()

  if (isYesterday) {
    return `yesterday at ${formatTimeUTC(d)}`
  }

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
