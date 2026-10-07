'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

/**
 * /auth/forgot-password — request a password reset email.
 *
 * Shared between the admin and resident surfaces. The success message
 * is uniform regardless of whether an account exists for the given
 * email — prevents email enumeration, same discipline as the login
 * pages' shared "Incorrect email or password" copy.
 *
 * The reset email link points at /auth/reset-password, which
 * Supabase's URL Configuration on the project must have on the
 * redirect allowlist. See docs/ops/known-issues.md — the allowlist
 * must be populated for this flow to function end-to-end.
 */

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const trimmedEmail = email.trim().toLowerCase()

    if (!trimmedEmail) {
      setError('Please enter your email address.')
      return
    }

    setSubmitting(true)
    try {
      const supabase = createClient()
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        trimmedEmail,
        {
          redirectTo: `${window.location.origin}/auth/reset-password`,
        },
      )

      // Only surface network/system errors. A "no such user" response is
      // not distinguished — the same success copy shows either way.
      // resetPasswordForEmail typically does not error for unknown
      // emails; this guard catches genuine failures (rate limit,
      // service unavailable).
      if (resetError && !resetError.message.toLowerCase().includes('not found')) {
        setError('Something went wrong. Please try again.')
        return
      }

      setSubmitted(true)
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
          Forgot your password?
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </header>

      {submitted ? (
        <section className="bg-muted/40 rounded-lg border p-5">
          <h2 className="text-base font-medium">Check your inbox</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            If an account exists for <strong>{email.trim().toLowerCase()}</strong>,
            a password reset link has been sent. The link expires in one
            hour.
          </p>
          <p className="text-muted-foreground mt-3 text-xs">
            Didn&apos;t receive it? Check your spam folder, or try again in a
            few minutes.
          </p>
        </section>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              autoFocus
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
            {submitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}

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
