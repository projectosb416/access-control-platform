'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

/**
 * /admin/signup
 *
 * Email + password signup for estate admins. On success, a Supabase auth
 * session is created and the user is redirected to /admin (placeholder
 * dashboard until the setup wizard exists).
 *
 * Email verification is intentionally OFF for v1 (see Phase 11 tracker).
 * If Supabase is configured to require verification, this page falls
 * through to a "check your inbox" state instead of redirecting — the code
 * handles both without depending on the dashboard setting.
 */

const MIN_PASSWORD_LENGTH = 8

export default function AdminSignupPage() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailSent, setEmailSent] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const trimmedEmail = email.trim().toLowerCase()

    // Client-side validation
    if (!trimmedEmail) {
      setError('Please enter your email address.')
      return
    }
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
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
      })

      if (signUpError) {
        setError(mapSignupError(signUpError.message))
        return
      }

      // If session exists, Supabase auto-confirmed. Redirect.
      // If not, verification is required — show the inbox page.
      if (data.session) {
        router.replace('/admin')
      } else {
        setEmailSent(true)
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (emailSent) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Check your inbox</h1>
        <p className="text-muted-foreground mt-3 text-sm">
          We sent a verification link to <strong>{email}</strong>. Open it to
          activate your account, then return here to log in.
        </p>
        <div className="mt-6">
          <Link
            href="/admin/login"
            className="text-foreground text-sm underline underline-offset-4"
          >
            Back to login
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Create admin account
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Set up access to your estate management dashboard.
        </p>
      </header>

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
            className="h-11"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            className="h-11"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter your password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
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
          className="mt-2 h-11 w-full text-base font-medium"
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>

        <p className="text-muted-foreground mt-4 text-center text-sm">
          Already have an account?{' '}
          <Link
            href="/admin/login"
            className="text-foreground underline underline-offset-4"
          >
            Log in
          </Link>
        </p>
      </form>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Error mapping. Supabase returns raw auth error strings; we translate the
// common ones into guard-facing plain copy and fall back to a generic
// message. Never surface a raw error to the user.
// ---------------------------------------------------------------------------

function mapSignupError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('already registered') || lower.includes('already exists')) {
    return 'An account with this email already exists. Try logging in instead.'
  }
  if (lower.includes('password')) {
    return `Password doesn't meet requirements. Use at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (lower.includes('invalid email') || lower.includes('email')) {
    return 'That email address doesn’t look right. Please check and try again.'
  }
  if (lower.includes('rate limit')) {
    return 'Too many attempts. Please wait a moment and try again.'
  }
  return 'Could not create your account. Please try again.'
}
