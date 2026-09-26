/**
 * Session staleness configuration.
 *
 * A session is "stale" when it's still open (no exit recorded) and the
 * visitor entered more than this many hours ago. Used by:
 *   - /admin dashboard — attention count
 *   - /admin/activity  — Attention filter + mark-unresolved action
 *
 * 24 hours matches the shift session cookie lifetime. A visit still open
 * past a full day is genuinely stale. Visits open less than 24h are
 * plausibly still in progress.
 */
export const STALE_SESSION_HOURS = 24
