'use client'

import type { UnitVisit } from './types'

interface RecentVisitsSectionProps {
  visits: UnitVisit[]
}

function formatTime(isoString: string | null): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  const now = new Date()
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()

  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  if (isToday) return time

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()

  if (isYesterday) return `yesterday ${time}`

  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${time}`
}

export function RecentVisitsSection({ visits }: RecentVisitsSectionProps) {
  return (
    <section className="mt-6 rounded-lg border bg-card">
      <div className="border-b px-5 py-4">
        <h2 className="text-base font-medium">Recent visits</h2>
      </div>

      {visits.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-muted-foreground text-sm">No visits yet.</p>
        </div>
      ) : (
        <ul className="divide-y">
          {visits.map((visit) => (
            <li
              key={visit.session_id}
              id={`visit-${visit.session_id}`}
              className="flex items-center justify-between gap-3 px-5 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {visit.visitor_name}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {visit.status === 'open' && (
                    <>in {formatTime(visit.entered_at)}</>
                  )}
                  {visit.status === 'completed' && (
                    <>
                      in {formatTime(visit.entered_at)} &rarr; out{' '}
                      {formatTime(visit.exited_at)}
                    </>
                  )}
                  {visit.status === 'unresolved' && (
                    <>in {formatTime(visit.entered_at)}</>
                  )}
                </p>
              </div>

              {visit.status === 'open' && (
                <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900 dark:text-green-200">
                  still inside
                </span>
              )}

              {visit.status === 'unresolved' && (
                <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
                  exit not recorded
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
