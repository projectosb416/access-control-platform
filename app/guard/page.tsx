'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const ORG_STORAGE_KEY = 'guard_org_id'

// Error codes → guard-facing copy. Source of truth for codes:
// docs/phase-7/error-http-mapping.md. Any unmapped code falls through to
// a generic message so we never display a raw code to a guard.
const ERROR_MESSAGES: Record<string, string> = {
  INVALID_BODY: 'Please fill in all fields.',
  MISSING_REQUIRED_FIELD: 'Please fill in all fields.',
  SHIFT_NOT_FOUND: 'Shift code not found. Check with your admin.',
  GUARD_NOT_FOUND: 'Guard ID not recognized for this estate.',
  SHIFT_NOT_OPEN: "This shift hasn't started yet. Try again later.",
  SHIFT_ENDED: 'This shift has ended.',
  GUARD_ALREADY_ON_SHIFT: 'You already have an active shift. End it first.',
  GATE_CAPACITY_REACHED: 'This gate is at capacity. Try again when a guard ends their shift.',
  GUARD_NOT_ACTIVE: 'Your guard account is not active. Contact your admin.',
  GATE_NOT_ACTIVE: 'This gate is not currently active.',
  SYSTEM_UNAVAILABLE: 'Something went wrong. Please try again.',
}

export default function GuardLoginPage() {
  const router = useRouter()

  const [savedOrgId, setSavedOrgId] = useState<string | null>(null)
  const [showOrgField, setShowOrgField] = useState(true)
  const [orgId, setOrgId] = useState('')
  const [shiftCode, setShiftCode] = useState('')
  const [guardCode, setGuardCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // On mount, if this device has been used before, load the estate ID.
  useEffect(() => {
    const stored = window.localStorage.getItem(ORG_STORAGE_KEY)
    if (stored) {
      setSavedOrgId(stored)
      setShowOrgField(false)
    }
  }, [])

  function changeEstate() {
    window.localStorage.removeItem(ORG_STORAGE_KEY)
    setSavedOrgId(null)
    setShowOrgField(true)
    setOrgId('')
    setError(null)
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const org = (savedOrgId ?? orgId).trim()
    const shift = shiftCode.trim().toUpperCase()
    const guard = guardCode.trim().toUpperCase()

    if (!org || !shift || !guard) {
      setError('Please fill in all fields.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/guard-session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: org,
          shift_code: shift,
          guard_code: guard,
        }),
      })

      const data = (await res.json().catch(() => ({}))) as { code?: string }

      if (!res.ok) {
        setError(
          ERROR_MESSAGES[data.code ?? ''] ??
            'Could not start shift. Please try again.',
        )
        return
      }

      // Persist the estate so future visits skip this field.
      window.localStorage.setItem(ORG_STORAGE_KEY, org)
      router.push('/guard/entry')
    } catch {
      setError('Network error. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex flex-1 flex-col px-6 pt-8 pb-6">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Start shift</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Enter your shift and guard codes to begin.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4">
        {showOrgField ? (
          <div className="grid gap-2">
            <Label htmlFor="org">Estate ID</Label>
            <Input
              id="org"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className="h-12 font-mono text-sm"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
        ) : (
          <div className="bg-muted flex items-center justify-between gap-3 rounded-md px-3 py-3">
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs">Estate</p>
              <p className="truncate font-mono text-sm">{savedOrgId}</p>
            </div>
            <button
              type="button"
              onClick={changeEstate}
              className="text-foreground shrink-0 text-sm underline underline-offset-4"
            >
              Change
            </button>
          </div>
        )}

        <div className="grid gap-2">
          <Label htmlFor="shift">Shift code</Label>
          <Input
            id="shift"
            value={shiftCode}
            onChange={(e) => setShiftCode(e.target.value.toUpperCase())}
            placeholder="SH-XXXXXX"
            className="h-12 font-mono text-base tracking-wider"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={12}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="guard">Guard ID</Label>
          <Input
            id="guard"
            value={guardCode}
            onChange={(e) => setGuardCode(e.target.value.toUpperCase())}
            placeholder="GU-XXXXXX"
            className="h-12 font-mono text-base tracking-wider"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={12}
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-auto pt-6">
          <Button
            type="submit"
            disabled={submitting}
            className="h-12 w-full text-base font-medium"
            size="lg"
          >
            {submitting ? 'Starting…' : 'Start shift'}
          </Button>
        </div>
      </form>
    </main>
  )
}
