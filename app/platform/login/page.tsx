'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

/**
 * /platform/login — platform owner login.
 *
 * Email + password, same auth shape as /admin/login. On success, the
 * Supabase session cookie is set and the user is redirected to
 * /platform. The /platform/(app) layout enforces is_platform_admin()
 * server-side, so logging in here does not by itself grant platform
 * access — an org-only admin can complete this form and will be
 * redirected back here if the platform-admins check fails.
 *
 * No signup link. Platform admin grants are out-of-band (see migration
 * 0004 header). New platform admins are added via SQL, not self-signup.
 *
 * Error messages are deliberately uniform — "Incorrect email or
 * password" for both wrong credentials and unknown account — to prevent
 * email enumeration.
 */

export default function PlatformLoginPage() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const trimmedEmail = email.trim().toLowerCase()

    if (!trimmedEmail || !password) {
      setError('Please enter your email and password.')
      return
    }

    setSubmitting(true)
    try {
      const supabase = createClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      })

      if (signInError) {
        setError('Incorrect email or password.')
        return
      }

      router.replace('/platform')
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
          Platform owner
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Sign in to oversee organizations, payments, and subscriptions.
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
            placeholder="Your password"
            autoComplete="current-password"
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
          className="mt-2 h-11 w-full text-base font-medium"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  )
}
