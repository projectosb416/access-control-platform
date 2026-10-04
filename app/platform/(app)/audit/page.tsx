import { createClient } from '@/lib/supabase/server'
import { AuditClient } from './audit-client'
import type { AuditEventRow, OrgOption } from './audit-client'

/**
 * /platform/audit — platform audit log.
 *
 * Server Component. Reads audit_events directly via RLS — the
 * audit_events_select_platform_admin policy permits a platform admin
 * to read every row (verified in STEP 1 B1).
 *
 * Filters come from searchParams and are applied server-side. Filter
 * changes are URL-driven — the client component pushes a new URL,
 * which re-runs this component with the new params.
 *
 * Limit: 100 events, newest first. Pagination is out of scope for v1.
 * The action filter is a prefix match (`authorization.` matches
 * `authorization.created`, `authorization.revoked`, etc.).
 *
 * Org dropdown reads organizations — permitted by
 * organizations_select_platform_admin (migration 0063).
 */

const MAX_EVENTS = 100

export default async function PlatformAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const orgFilter =
    typeof params.org === 'string' ? params.org.trim() : ''
  const actionFilter =
    typeof params.action === 'string' ? params.action.trim() : ''

  const supabase = await createClient()

  // Build the events query with optional filters.
  // Note: chained filter methods return the same builder type, so
  // reassignment via `let` is safe. If a future Supabase client version
  // changes this, cast through unknown or compose differently.
  let eventsQuery = supabase
    .from('audit_events')
    .select(
      'id, organization_id, actor_account_id, action, target_type, target_id, reason, metadata, recorded_at',
    )
    .order('recorded_at', { ascending: false })
    .limit(MAX_EVENTS)

  if (orgFilter) {
    eventsQuery = eventsQuery.eq('organization_id', orgFilter)
  }
  if (actionFilter) {
    eventsQuery = eventsQuery.like('action', `${actionFilter}%`)
  }

  const [eventsRes, orgsRes] = await Promise.all([
    eventsQuery,
    supabase
      .from('organizations')
      .select('id, display_name')
      .order('display_name', { ascending: true }),
  ])

  const events = (eventsRes.data ?? []) as unknown as AuditEventRow[]
  const orgs = (orgsRes.data ?? []) as unknown as OrgOption[]

  // Timestamp is computed once per request and passed to the client so
  // server and client render identical relative labels. eslint-disable
  // for React 19 purity rule (HANDOFF §11).
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Every state-changing action across all organizations. Showing the
          most recent {events.length === MAX_EVENTS ? MAX_EVENTS : events.length}{' '}
          {events.length === 1 ? 'event' : 'events'}
          {events.length === MAX_EVENTS ? ' (capped)' : ''}.
        </p>
      </header>

      <AuditClient
        events={events}
        orgs={orgs}
        currentOrgFilter={orgFilter || null}
        currentActionFilter={actionFilter || null}
        nowIso={nowIso}
      />
    </div>
  )
}
