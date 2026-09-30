import type { Notification } from './types'

/**
 * Recent notifications for the signed-in resident. Server Component —
 * read-only, no client interaction, no mark-as-read, no dialogs.
 *
 * Reads directly from public.notifications via the RLS policy
 * notifications_select_self, which filters to
 * recipient_account_id = current_account_id(). No SECURITY DEFINER
 * wrapper is needed for the read path.
 *
 * Mark-as-read is deliberately out of scope. The existing policy
 * notifications_update_self_read is row-scoped, not column-scoped —
 * same shape as the authorizations policies dropped in 0053 and 0055.
 * A client-side UPDATE could rewrite title/body/category, not just
 * read_at. When mark-as-read lands, it goes through a SECURITY
 * DEFINER function (pattern from 0054). Logged as a known-issue.
 *
 * Content shape (per migration 0015):
 *   - title is required; body is optional
 *   - category drives visual class: access/security/operations/system/billing
 *   - priority drives sound class: information/attention/high
 *     (no sounds here — this is a static dashboard section)
 *   - high-priority items get a small visual emphasis; others plain
 *
 * Time formatting is local to this file, mirroring the pattern in
 * guest-pin-section.tsx and recent-visits-section.tsx. A shared
 * helper is a future refactor candidate, not this slice.
 */

const MAX_DISPLAYED = 10

export function NotificationsSection({
  notifications,
  nowIso,
}: {
  notifications: Notification[]
  nowIso: string
}) {
  const visible = notifications.slice(0, MAX_DISPLAYED)

  return (
    <section className="bg-muted/40 mt-6 rounded-lg border p-5">
      <header className="mb-4">
        <h2 className="text-base font-medium">Notifications</h2>
      </header>

      {visible.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No notifications yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((n) => (
            <NotificationRow key={n.id} notification={n} nowIso={nowIso} />
          ))}
        </ul>
      )}
    </section>
  )
}

function NotificationRow({
  notification,
  nowIso,
}: {
  notification: Notification
  nowIso: string
}) {
  const isUnread = notification.read_at === null
  const isHigh = notification.priority === 'high'
  const when = formatAbsolute(
    new Date(notification.created_at),
    new Date(nowIso),
  )

  return (
    <li className="bg-background flex gap-3 rounded-md border px-3 py-2">
      <span
        aria-hidden="true"
        className={
          'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ' +
          (isUnread ? 'bg-foreground' : 'bg-transparent')
        }
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={
              'truncate text-sm ' +
              (isUnread ? 'font-medium' : 'text-muted-foreground')
            }
          >
            {notification.title}
          </span>
          {isHigh ? (
            <span className="shrink-0 rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive">
              Important
            </span>
          ) : null}
        </div>
        {notification.body ? (
          <p className="text-muted-foreground line-clamp-2 text-xs">
            {notification.body}
          </p>
        ) : null}
        <p className="text-muted-foreground mt-0.5 text-[11px]">{when}</p>
      </div>
    </li>
  )
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
