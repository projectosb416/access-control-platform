'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { useLiveStatus } from './command-center-live'

/**
 * Refresh button for Command Center.
 *
 * Calls router.refresh() to re-run the Server Component and re-fetch
 * all panel data. Kept even with Realtime active — necessary fallback
 * for the case where the subscription is in an uncertain state (tab
 * backgrounded for hours, mobile network drop).
 *
 * The live-status dot to the left shows the Realtime subscription
 * state:
 *   live       — green, subscription healthy
 *   connecting — amber, initial connection or reconnecting
 *   error      — gray, subscription dropped (dismissed gracefully)
 *
 * On Nigerian mobile networks, WebSocket connections drop regularly.
 * A silently-stale dashboard that still looks live is worse than an
 * honest disconnected indicator — especially for an access-control
 * admin tool where "who's inside right now" carries safety weight.
 *
 * Must be rendered inside <CommandCenterLive>; the useLiveStatus hook
 * reads a context provider that wraps the tree.
 */
export function RefreshButton() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [spinKey, setSpinKey] = useState(0)
  const status = useLiveStatus()

  function handleRefresh() {
    setSpinKey((k) => k + 1)
    startTransition(() => {
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-3">
      <LiveStatusDot status={status} />
      <button
        type="button"
        onClick={handleRefresh}
        disabled={isPending}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium transition-colors disabled:opacity-50"
      >
        <RefreshCw
          key={spinKey}
          className={'h-3.5 w-3.5 ' + (isPending ? 'animate-spin' : '')}
        />
        {isPending ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  )
}

function LiveStatusDot({ status }: { status: 'connecting' | 'live' | 'error' }) {
  const config = {
    live: {
      label: 'Live',
      dotClass: 'bg-emerald-500',
      textClass: 'text-muted-foreground',
    },
    connecting: {
      label: 'Connecting',
      dotClass: 'bg-amber-500',
      textClass: 'text-muted-foreground',
    },
    error: {
      label: 'Offline',
      dotClass: 'bg-muted-foreground',
      textClass: 'text-muted-foreground',
    },
  }[status]

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide ${config.textClass}`}
      title={
        status === 'live'
          ? 'Live updates active'
          : status === 'connecting'
            ? 'Connecting to live updates…'
            : 'Live updates offline. Use Refresh.'
      }
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${config.dotClass}`}
      />
      {config.label}
    </span>
  )
}
