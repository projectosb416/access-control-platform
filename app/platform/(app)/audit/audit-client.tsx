'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Platform audit log — Client Component.
 *
 * Filter bar + list rendering. Filters are URL-driven (searchParams):
 * the Server Component reads them, queries accordingly, and passes
 * the resulting rows to this component. Filter changes navigate to a
 * new URL, which re-runs the Server Component.
 *
 * Row shape matches a subset of public.audit_events. Actor
 * (actor_account_id) and metadata are deliberately not rendered in
 * v1 — actor resolution needs a lookup the platform admin cannot do
 * under current RLS, and metadata is a per-event drill-down that
 * comes later.
 */

export type AuditEventRow = {
  id: string
  organization_id: string | null
  actor_account_id: string | null
  action: string
  target_type: string
  target_id: string | null
  reason: string | null
  metadata: Record<string, unknown>
  recorded_at: string
}

export type OrgOption = {
  id: string
  display_name: string
}

export function AuditClient({
  events,
  orgs,
  currentOrgFilter,
  currentActionFilter,
  nowIso,
}: {
  events: AuditEventRow[]
  orgs: OrgOption[]
  currentOrgFilter: string | null
  currentActionFilter: string | null
  nowIso: string
}) {
  const router = useRouter()

  const [orgDraft, setOrgDraft] = useState(currentOrgFilter ?? '')
  const [actionDraft, setActionDraft] = useState(currentActionFilter ?? '')

  const orgNameById = new Map(orgs.map((o) => [o.id, o.display_name]))

  function applyFilters() {
    const params = new URLSearchParams()
    if (orgDraft) params.set('org', orgDraft)
    if (actionDraft.trim()) params.set('action', actionDraft.trim())
    const qs = params.toString()
    router.push(qs ? `/platform/audit?${qs}` : '/platform/audit')
  }

  function clearFilters() {
    setOrgDraft('')
    setActionDraft('')
    router.push('/platform/audit')
  }

  const hasFilters = Boolean(currentOrgFilter || currentActionFilter)

  return (
    <div className="flex flex-col gap-4">
      <section className="bg-muted/40 rounded-lg border p-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div className="grid gap-2">
            <Label htmlFor="org-filter">Organization</Label>
            <select
              id="org-filter"
              value={orgDraft}
              onChange={(e) => setOrgDraft(e.target.value)}
              className="border-input bg-background h-10 rounded-md border px-3 text-sm"
            >
              <option value="">All organizations</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.display_name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="action-filter">Action prefix</Label>
            <Input
              id="action-filter"
              value={actionDraft}
              onChange={(e) => setActionDraft(e.target.value)}
              placeholder="e.g. authorization."
              className="h-10"
            />
          </div>

          <div className="flex items-end gap-2">
            <Button type="button" onClick={applyFilters}>
              Apply
            </Button>
            {hasFilters ? (
              <Button type="button" variant="outline" onClick={clearFilters}>
                Clear
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="bg-muted/40 rounded-lg border p-5">
        <h2 className="text-muted-foreground mb-3 text-xs font-medium uppercase tracking-wide">
          Events
        </h2>

        {events.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No audit events{hasFilters ? ' matching these filters' : ''}.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {events.map((e) => (
              <li
                key={e.id}
                className="bg-background flex flex-col gap-1 rounded-md border px-3 py-2"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-mono text-sm">
                    {e.action}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {formatAbsolute(new Date(e.recorded_at), new Date(nowIso))}
                  </span>
                </div>
                <div className="text-muted-foreground flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
                  <span>
                    <span className="font-medium">target</span>{' '}
                    {e.target_type}
                    {e.target_id ? ` · ${shortId(e.target_id)}` : ''}
                  </span>
                  <span>
                    <span className="font-medium">org</span>{' '}
                    {e.organization_id
                      ? orgNameById.get(e.organization_id) ?? shortId(e.organization_id)
                      : '—'}
                  </span>
                </div>
                {e.reason ? (
                  <p className="text-muted-foreground mt-0.5 truncate text-xs">
                    {e.reason}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
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
