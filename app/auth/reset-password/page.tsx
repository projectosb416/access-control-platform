'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

/**
 * /auth/reset-password — set a new password after clicking the reset
 * email link.
 *
 * Supabase's recovery flow delivers a URL fragment (#access_token=...
 * &type=recovery). With detectSessionInUrl enabled (default),
 * createBrowserClient processes the fragment on load and establishes
 * a recovery session. We detect that session two ways:
 *
 *   1. onAuthStateChange fires PASSWORD_RECOVERY when the fragment is
 *      processed. Preferred path.
 *   2. Fallback getSession() check on mount. Handles the race where
 *      the fragment was processed before the listener attached, and
 *      also handles the case where an existing valid session means
 *      the user landed here directly (no fragment).
 *
 * If neither yields a session, the link is treated as expired or
 * malformed — show the "request a new link" state.
 *
 * Post-success: sign out and show inline success with both login
 * links. The user proves the new password works by logging in
 * explicitly. Auto-login via the recovery session would skip that.
 */

type Stage = 'checking' | 'ready' | 'expired' | 'success'

const MIN_PASSWORD_LENGTH = 8

export default function ResetPasswordPage() {
  const [stage, setStage] = useState<Stage>('checking')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    let settled = false

    function settle(next: Stage) {
      if (settled) return
      settled = true
      setStage(next)
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        settle('ready')
      }
    })

    // Fallback: give Supabase's initial processing a moment, then check.
    const timeout = setTimeout(async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (session) settle('ready')
      else settle('expired')
    }, 1200)

    return () => {
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      const supabase = createClient()
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      })

      if (updateError) {
        setError(
          updateError.message.toLowerCase().includes('expired')
            ? 'This reset link has expired. Please request a new one.'
            : 'Could not update your password. Please try again.'
        )
        return
      }

      // Sign out so the user proves the new password works.
      await supabase.auth.signOut()
      setStage('success')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Set a new password
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Choose a password you haven&apos;t used before.
        </p>
      </header>

      {stage === 'checking' ? (
        <p className="text-muted-foreground text-sm">
          Verifying your reset link…
        </p>
      ) : null}

      {stage === 'expired' ? (
        <section className="bg-muted/40 rounded-lg border p-5">
          <h2 className="text-base font-medium">
            This reset link is invalid or has expired
          </h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Reset links are valid for one hour and can only be used once.
            Request a new one to continue.
          </p>
          <Link
            href="/auth/forgot-password"
            className="text-foreground mt-4 inline-block text-sm underline underline-offset-4"
          >
            Request a new link
          </Link>
        </section>
      ) : null}

      {stage === 'ready' ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              autoComplete="new-password"
              required
              autoFocus
              className="h-11"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter the same password"
              autoComplete="new-password"
              required
              className="h-11"
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

          <Button
            type="submit"
            disabled={submitting}
            className="mt-2 h-11 w-full"
          >
            {submitting ? 'Updating…' : 'Update password'}
          </Button>
        </form>
      ) : null}

      {stage === 'success' ? (
        <section className="bg-muted/40 rounded-lg border p-5">
          <h2 className="text-base font-medium">Password updated</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            You can now log in with your new password.
          </p>
        </section>
      ) : null}

      <p className="text-muted-foreground mt-8 text-center text-xs">
        <Link href="/admin/login" className="underline underline-offset-4">
          Admin login
        </Link>
        {' · '}
        <Link href="/resident/login" className="underline underline-offset-4">
          Resident login
        </Link>
      </p>
    </main>
  )
}
