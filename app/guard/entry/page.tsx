'use client'

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { playTierSound } from '@/lib/guard/sound'
import { nextEntryKey } from '@/lib/guard/idempotency'

type ResultCode =
  | 'GRANTED'
  | 'DENIED'
  | 'INVALID_PIN'
  | 'EXPIRED_AUTHORIZATION'
  | 'REVOKED_AUTHORIZATION'
  | 'NO_ACTIVE_SESSION'
  | 'ONE_TIME_ALREADY_CONSUMED'
  | 'UNRESOLVED_VISIT'
  | 'RATE_LIMITED'
  | 'GATE_INACTIVE'
  | 'GUARD_NOT_ON_ACTIVE_SHIFT'
  | 'SUBSCRIPTION_INACTIVE'
  | 'SYSTEM_UNAVAILABLE'

type Tier = 'positive' | 'warning' | 'negative'

interface ResultPresentation {
  tier: Tier
  label: string
  subtext: (reason: string | null) => string
}

// Presentation rules — see docs/phase-8/operational-states.md.
// Guard-facing label is distinct per result code. Tier is shared.
const PRESENTATION: Record<ResultCode, ResultPresentation> = {
  GRANTED: {
    tier: 'positive',
    label: 'GRANTED',
    subtext: () => '',
  },
  EXPIRED_AUTHORIZATION: {
    tier: 'warning',
    label: 'EXPIRED',
    subtext: (r) => r ?? 'Validity window has passed',
  },
  UNRESOLVED_VISIT: {
    tier: 'warning',
    label: 'ALREADY INSIDE',
    subtext: (r) => r ?? 'Visitor has an open session',
  },
  NO_ACTIVE_SESSION: {
    tier: 'warning',
    label: 'NOT INSIDE',
    subtext: (r) => r ?? 'No open visit to close',
  },
  RATE_LIMITED: {
    tier: 'warning',
    label: 'LOCKED',
    subtext: (r) => r ?? 'Too many attempts. Try again shortly.',
  },
  DENIED: {
    tier: 'warning',
    label: 'DENIED',
    subtext: (r) => r ?? 'Entry not permitted',
  },
  INVALID_PIN: {
    tier: 'negative',
    label: 'INVALID PIN',
    subtext: () => 'PIN does not match any credential',
  },
  REVOKED_AUTHORIZATION: {
    tier: 'negative',
    label: 'REVOKED',
    subtext: (r) => r ?? 'Authorization has been revoked',
  },
  ONE_TIME_ALREADY_CONSUMED: {
    tier: 'negative',
    label: 'ALREADY USED',
    subtext: (r) => r ?? 'This one-time PIN has already been used',
  },
  GATE_INACTIVE: {
    tier: 'negative',
    label: 'GATE CLOSED',
    subtext: () => 'This gate is not currently active',
  },
  GUARD_NOT_ON_ACTIVE_SHIFT: {
    tier: 'negative',
    label: 'NOT ON SHIFT',
    subtext: () => 'Restart your shift to continue',
  },
  SUBSCRIPTION_INACTIVE: {
    tier: 'negative',
    label: 'SUBSCRIPTION INACTIVE',
    subtext: () => "This estate's subscription is inactive",
  },
  SYSTEM_UNAVAILABLE: {
    tier: 'negative',
    label: 'SYSTEM ERROR',
    subtext: () => 'Try again in a moment',
  },
}

const TIER_CLASS: Record<Tier, string> = {
  positive: 'bg-emerald-600 text-white',
  warning: 'bg-amber-500 text-black',
  negative: 'bg-red-600 text-white',
}

interface ApiResult {
  result_code: ResultCode
  reason: string | null
}

const PIN_LENGTH = 6
const SESSION_STORAGE_KEY = 'guard_shift_session_id'

// ---------------------------------------------------------------------------
// Real API call. Errors are normalised into result codes so the caller
// has a single shape to handle.
//
//   200 → result_code from body
//   401 → session expired; caller redirects to /guard
//   5xx / network → SYSTEM_UNAVAILABLE result
// ---------------------------------------------------------------------------

class SessionExpiredError extends Error {
  constructor() {
    super('SESSION_EXPIRED')
    this.name = 'SessionExpiredError'
  }
}

async function callEntryApi(pin: string): Promise<ApiResult> {
  const sessionId =
    typeof window !== 'undefined'
      ? window.sessionStorage.getItem(SESSION_STORAGE_KEY)
      : null

  const body: { pin: string; idempotency_key?: string } = { pin }
  if (sessionId) {
    body.idempotency_key = nextEntryKey(sessionId, 'entry')
  }

  let res: Response
  try {
    res = await fetch('/api/guard/entry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    return { result_code: 'SYSTEM_UNAVAILABLE', reason: null }
  }

  if (res.status === 401) {
    throw new SessionExpiredError()
  }

  if (!res.ok) {
    return { result_code: 'SYSTEM_UNAVAILABLE', reason: null }
  }

  const data = (await res.json().catch(() => null)) as
    | { result_code?: string; reason?: string | null }
    | null

  if (!data || typeof data.result_code !== 'string') {
    return { result_code: 'SYSTEM_UNAVAILABLE', reason: null }
  }

  const code = (data.result_code in PRESENTATION
    ? data.result_code
    : 'DENIED') as ResultCode

  return {
    result_code: code,
    reason: typeof data.reason === 'string' ? data.reason : null,
  }
}

// ---------------------------------------------------------------------------

export default function GuardEntryPage() {
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<ApiResult | null>(null)
  const [endShiftOpen, setEndShiftOpen] = useState(false)

  const submitPin = useCallback(
    async (value: string) => {
      setSubmitting(true)
      try {
        const res = await callEntryApi(value)
        setResult(res)
      } catch (err) {
        if (err instanceof SessionExpiredError) {
          router.replace('/guard')
          return
        }
        setResult({ result_code: 'SYSTEM_UNAVAILABLE', reason: null })
      } finally {
        setSubmitting(false)
      }
    },
    [router],
  )

  const handleEndShift = useCallback(async () => {
    // Best-effort end. Never block the guard on a failing call — always
    // clear local state and return to login.
    try {
      await fetch('/api/guard-session/end', { method: 'POST' })
    } catch {
      // ignore
    }
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY)
    router.replace('/guard')
  }, [router])

  function pressDigit(d: string) {
    if (submitting || result) return
    if (pin.length >= PIN_LENGTH) return

    const next = pin + d
    setPin(next)

    if (next.length === PIN_LENGTH) {
      void submitPin(next)
    }
  }

  function pressBackspace() {
    if (submitting || result) return
    setPin(pin.slice(0, -1))
  }

  function pressClear() {
    setPin('')
  }

  function dismissResult() {
    setPin('')
    setResult(null)
  }

  // Play the tier sound when a result appears.
  useEffect(() => {
    if (!result) return
    playTierSound(PRESENTATION[result.result_code].tier)
  }, [result])

  // Auto-dismiss GRANTED after 3 seconds.
  useEffect(() => {
    if (result?.result_code !== 'GRANTED') return
    const t = setTimeout(() => {
      setPin('')
      setResult(null)
    }, 3000)
    return () => clearTimeout(t)
  }, [result])

  // ----- Result overlay -----
  if (result) {
    const p = PRESENTATION[result.result_code]
    const subtext = p.subtext(result.reason)
    return (
      <main
        className={`flex flex-1 flex-col px-6 pt-8 pb-6 ${TIER_CLASS[p.tier]}`}
        role="alert"
      >
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="text-4xl leading-tight font-bold tracking-tight">
            {p.label}
          </p>
          {subtext ? (
            <p className="mt-4 max-w-xs text-lg opacity-90">{subtext}</p>
          ) : null}
        </div>

        {result.result_code !== 'GRANTED' ? (
          <Button
            onClick={dismissResult}
            className="h-14 w-full bg-white/20 text-lg font-medium text-white backdrop-blur hover:bg-white/30"
          >
            Try again
          </Button>
        ) : null}
      </main>
    )
  }

  // ----- Input state -----
  return (
    <main className="flex flex-1 flex-col px-4 pt-6 pb-4">
      <header className="relative mb-4 flex items-center justify-center">
        <p className="text-muted-foreground text-xs tracking-wide uppercase">
          Enter visitor PIN
        </p>
        <button
          type="button"
          onClick={() => setEndShiftOpen(true)}
          className="text-muted-foreground absolute top-0 right-0 text-xs underline underline-offset-4"
        >
          End Shift
        </button>
      </header>

      <PinDots pin={pin} />

      <div className="mt-auto">
        <Keypad
          onDigit={pressDigit}
          onBackspace={pressBackspace}
          onClear={pressClear}
          disabled={submitting}
        />
      </div>

      <AlertDialog open={endShiftOpen} onOpenChange={setEndShiftOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End your shift?</AlertDialogTitle>
            <AlertDialogDescription>
              You&apos;ll need your shift code and guard ID to log back in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleEndShift}>
              End Shift
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

// ---------------------------------------------------------------------------

function PinDots({ pin }: { pin: string }) {
  return (
    <div className="mb-8 flex justify-center gap-3" aria-hidden>
      {Array.from({ length: PIN_LENGTH }).map((_, i) => (
        <div
          key={i}
          className={`h-4 w-4 rounded-full border-2 transition-colors ${
            i < pin.length
              ? 'border-foreground bg-foreground'
              : 'border-muted-foreground/40 bg-transparent'
          }`}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------

interface KeypadProps {
  onDigit: (d: string) => void
  onBackspace: () => void
  onClear: () => void
  disabled: boolean
}

function Keypad({ onDigit, onBackspace, onClear, disabled }: KeypadProps) {
  return (
    <div className="mx-auto grid w-full max-w-sm grid-cols-3 gap-2">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <KeypadKey key={d} onClick={() => onDigit(d)} disabled={disabled}>
          {d}
        </KeypadKey>
      ))}

      <KeypadKey onClick={onClear} disabled={disabled} variant="subtle">
        C
      </KeypadKey>
      <KeypadKey onClick={() => onDigit('0')} disabled={disabled}>
        0
      </KeypadKey>
      <KeypadKey onClick={onBackspace} disabled={disabled} variant="subtle">
        ⌫
      </KeypadKey>
    </div>
  )
}

function KeypadKey({
  children,
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: ReactNode
  onClick: () => void
  disabled: boolean
  variant?: 'primary' | 'subtle'
}) {
  const base =
    'flex h-16 items-center justify-center rounded-lg text-2xl font-medium transition-colors select-none active:scale-[0.98] disabled:opacity-40'
  const styles =
    variant === 'primary'
      ? 'bg-muted hover:bg-muted/80 text-foreground'
      : 'bg-transparent text-muted-foreground hover:bg-muted/50'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${styles}`}
    >
      {children}
    </button>
  )
}
