'use client'

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Realtime subscription wrapper for Command Center.
 *
 * Client Component. Wraps <CommandCenter> (which stays a Server
 * Component) and provides a live connection to three source tables:
 *
 *   access_events     — Live activity panel
 *   access_sessions   — Currently inside + attention banner
 *   shift_sessions    — Shifts in progress + Gates guard counts
 *
 * On any change, schedules a debounced router.refresh(). The Server
 * Component re-runs its fetches and re-renders. Panels do not change
 * shape; only their data updates.
 *
 * Debounce is 1000ms — a burst of ten events in a second produces one
 * refresh, not ten. Tuned by judgment; can be adjusted if usage shows
 * otherwise.
 *
 * Connection status is exposed via context so the Refresh button (or
 * any client child) can render a subtle indicator. On networks that
 * drop WebSocket connections regularly (mobile), a silently-stale
 * dashboard that still looks live is worse than an honest "offline"
 * indicator.
 *
 * RLS: Realtime respects RLS on the publishing side. The subscriber
 * only receives rows they could SELECT. No additional policy or
 * SECURITY DEFINER wrapper is needed for this path.
 *
 * shift_sessions has no organization_id column — filter not applied.
 * The eventual read via router.refresh() is RLS-scoped to the admin's
 * org, so the "notify broadly, filter on read" tradeoff is safe here.
 */

export type LiveStatus = 'connecting' | 'live' | 'error'

const LiveStatusContext = createContext<LiveStatus>('connecting')

/** Read the current Realtime connection status. Must be used inside <CommandCenterLive>. */
export function useLiveStatus(): LiveStatus {
  return useContext(LiveStatusContext)
}

const DEBOUNCE_MS = 1000

export function CommandCenterLive({
  children,
  organizationId,
}: {
  children: React.ReactNode
  organizationId: string
}) {
  const router = useRouter()
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const supabase = createClient()

    function scheduleRefresh() {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        router.refresh()
      }, DEBOUNCE_MS)
    }

    const channel = supabase
      .channel('command-center-live')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'access_events',
          filter: `organization_id=eq.${organizationId}`,
        },
        () => scheduleRefresh(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'access_sessions',
          filter: `organization_id=eq.${organizationId}`,
        },
        () => scheduleRefresh(),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'shift_sessions',
        },
        () => scheduleRefresh(),
      )
      .subscribe((channelStatus) => {
        if (channelStatus === 'SUBSCRIBED') {
          setStatus('live')
        } else if (
          channelStatus === 'CHANNEL_ERROR' ||
          channelStatus === 'TIMED_OUT' ||
          channelStatus === 'CLOSED'
        ) {
          setStatus('error')
        } else {
          setStatus('connecting')
        }
      })

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      void supabase.removeChannel(channel)
    }
  }, [organizationId, router])

  return (
    <LiveStatusContext.Provider value={status}>
      {children}
    </LiveStatusContext.Provider>
  )
}
