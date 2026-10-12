'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Audit filter bar for the platform drill-down.
 *
 * URL-driven. The action prefix is written to `?action=` on the
 * current path via router.push, which re-runs the Server Component
 * and re-fetches the filtered audit list.
 *
 * Same shape as the standalone /platform/audit filter bar, minus the
 * org dropdown — this page is already scoped to one org.
 *
 * usePathname() is required here (unlike the standalone page, which
 * can hardcode '/platform/audit') because the drill-down path is
 * dynamic: /platform/orgs/<uuid>.
 */

export function AuditFilter({
  currentActionFilter,
}: {
  currentActionFilter: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [actionDraft, setActionDraft] = useState(currentActionFilter)

  function applyFilter() {
    const params = new URLSearchParams()
    const trimmed = actionDraft.trim()
    if (trimmed) params.set('action', trimmed)
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  function clearFilter() {
    setActionDraft('')
    router.push(pathname)
  }

  return (
    <div className="bg-muted/40 mb-4 flex flex-wrap items-end gap-2 rounded-md border px-3 py-3">
      <div className="grid flex-1 gap-2 sm:max-w-xs">
        <Label htmlFor="action-filter" className="text-xs">
          Action prefix
        </Label>
        <Input
          id="action-filter"
          value={actionDraft}
          onChange={(e) => setActionDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyFilter()
          }}
          placeholder="e.g. payment."
          className="h-9"
        />
      </div>
      <Button type="button" size="sm" onClick={applyFilter}>
        Apply
      </Button>
      {currentActionFilter ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={clearFilter}
        >
          Clear
        </Button>
      ) : null}
    </div>
  )
}
