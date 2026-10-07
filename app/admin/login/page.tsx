'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'

/**
 * /admin/login
 *
 * Email + password login for estate admins. On success, a Supabase auth
 * session cookie is set and the user is redirected to /admin.
 *
 * Error messages are mapped to plain copy — never a raw Supabase error
 * string. A failed login is one of the most-attacked surfaces; we don't
 * differentiate "wrong password" from "no such account" (both return the
 * same message) so an attacker can't enumerate valid emails.
 */

export default function AdminLoginPage() {
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
        // Deliberately identical message for wrong password and unknown
        // account — prevents email enumeration.
        setError('Incorrect email or password.')
        return
      }

      router.replace('/admin')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Access your estate management dashboard.
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
          {submitting ? 'Logging in…' : 'Log in'}
        </Button>

        <p className="text-muted-foreground mt-4 text-center text-sm">
          <Link
            href="/auth/forgot-password"
            className="underline underline-offset-4"
          >
            Forgot your password?
          </Link>
        </p>

        <p className="text-muted-foreground mt-4 text-center text-sm">
          Don&apos;t have an account?{' '}
          <Link
            href="/admin/signup"
            className="text-foreground underline underline-offset-4"
          >
            Sign up
          </Link>
        </p>
      </form>
    </main>
  )
}
