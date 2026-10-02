'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'

/**
 * Refresh button for Command Center. Calls router.refresh() to re-run the
 * Server Component and re-fetch all panel data.
 *
 * B1 is static — no Realtime subscription yet. Refresh is manual. When B2
 * lands, panels will update live and this button becomes a fallback for
 * edge cases (stale after backgrounding, etc.).
 *
 * useTransition keeps the button in a "refreshing" state until the
 * Server Component re-render completes, so the admin sees feedback.
 */
export function RefreshButton() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [spinKey, setSpinKey] = useState(0)

  function handleRefresh() {
    setSpinKey((k) => k + 1)
    startTransition(() => {
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={handleRefresh}
      disabled={isPending}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium transition-colors disabled:opacity-50"
    >
      <RefreshCw
        key={spinKey}
        className={
          'h-3.5 w-3.5 ' + (isPending ? 'animate-spin' : '')
        }
      />
      {isPending ? 'Refreshing…' : 'Refresh'}
    </button>
  )
}
