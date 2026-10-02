'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import type { InviteContext } from './page'

/**
 * Invite redemption UI.
 *
 * Three states, driven by a single `stage` value:
 *
 *   signup  — no session, no account yet. Collect full name, email, password,
 *             phone. On submit: Supabase signUp, then immediately signOut
 *             (no auto sign-in), advance to login.
 *   login   — no session, account exists. Email + password. On submit:
 *             signInWithPassword, advance to confirm.
 *   confirm — session active. One button. On submit: dispatch to the
 *             correct RPC based on context.inviteType — redeem_unit_invite
 *             (creates an occupancy + primary_resident membership) or
 *             redeem_household_invite (links the caller to the unit as a
 *             co-occupant; no occupancy row). Then redirect to /resident.
 *
 * If `context.status !== 'valid'`, the form is not shown at all — a status
 * panel replaces it.
 */

type Stage = 'signup' | 'login' | 'confirm'

const MIN_PASSWORD_LENGTH = 8

export function JoinClient({
  context,
  initialSignedIn,
  initialSignedInEmail,
}: {
  context: InviteContext
  initialSignedIn: boolean
  initialSignedInEmail: string | null
}) {
  const router = useRouter()

  const [stage, setStage] = useState<Stage>(
    initialSignedIn ? 'confirm' : 'signup',
  )
  const [signedInEmail, setSignedInEmail] = useState<string | null>(
    initialSignedInEmail,
  )

  // Form fields — signup
  const [fullName, setFullName] = useState('')
  const [signupEmail, setSignupEmail] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [phone, setPhone] = useState('')

  // Form fields — login
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function clearError() {
    setError(null)
  }

  // ---- Non-valid invite: status panel only ----
  if (context.status !== 'valid') {
    return <InviteStatusPanel context={context} />
  }

  // ---- Signup ----
  async function handleSignup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    clearError()

    const trimmedName = fullName.trim()
    const trimmedEmail = signupEmail.trim().toLowerCase()
    const trimmedPhone = phone.trim()

    if (!trimmedName) {
      setError('Please enter your full name.')
      return
    }
    if (!trimmedEmail) {
      setError('Please enter your email address.')
      return
    }
    if (signupPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }

    setSubmitting(true)
    try {
      const supabase = createClient()
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password: signupPassword,
        options: {
          data: {
            display_name: trimmedName,
            phone: trimmedPhone || null,
          },
        },
      })

      if (signUpError) {
        setError(mapSignupError(signUpError.message))
        return
      }

      if (data.session) {
        await supabase.auth.signOut()
      }

      setLoginEmail(trimmedEmail)
      setLoginPassword('')
      setStage('login')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ---- Login ----
  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    clearError()

    const trimmedEmail = loginEmail.trim().toLowerCase()
    if (!trimmedEmail || !loginPassword) {
      setError('Please enter your email and password.')
      return
    }

    setSubmitting(true)
    try {
      const supabase = createClient()
      const { data, error: signInError } =
        await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password: loginPassword,
        })

      if (signInError) {
        setError('Incorrect email or password.')
        return
      }

      setSignedInEmail(data.user?.email ?? trimmedEmail)
      setStage('confirm')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ---- Confirm ----
  async function handleConfirm() {
    clearError()
    setSubmitting(true)

    try {
      const supabase = createClient()

      // Dispatch by invite type.
      //   unit      — creates occupancy + primary_resident membership
      //   household — links account to unit as a household member
      const rpcName =
        context.inviteType === 'household'
          ? 'redeem_household_invite'
          : 'redeem_unit_invite'

      const { error: rpcError } = await supabase.rpc(rpcName, {
        p_code_hash: context.hash,
      })

      if (rpcError) {
        setError(mapRedeemError(rpcError.message))
        return
      }

      router.replace('/resident')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const propertyLabel = context.propertyName ?? 'the estate'
  const unitSuffix = context.unitLabel ? ` · Unit ${context.unitLabel}` : ''
  const isHousehold = context.inviteType === 'household'

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10">
      <header className="mb-8">
        <p className="text-muted-foreground text-xs uppercase tracking-wide">
          You&apos;re invited to join
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {propertyLabel}
        </h1>
        {unitSuffix ? (
          <p className="text-muted-foreground mt-1 text-sm">{unitSuffix}</p>
        ) : null}
      </header>

      {stage === 'signup' ? (
        <form onSubmit={handleSignup} className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            Create your account to accept this invite. You&apos;ll log in on the
            next step to confirm.
          </p>

          <div className="grid gap-2">
            <Label htmlFor="fullName">Full name</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Adebayo Ogundimu"
              autoFocus
              className="h-11"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="signupEmail">Email</Label>
            <Input
              id="signupEmail"
              type="email"
              value={signupEmail}
              onChange={(e) => setSignupEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-11"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="signupPassword">Password</Label>
            <Input
              id="signupPassword"
              type="password"
              value={signupPassword}
              onChange={(e) => setSignupPassword(e.target.value)}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              autoComplete="new-password"
              className="h-11"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="phone">
              Phone{' '}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. +2348012345678"
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
            {submitting ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      ) : null}

      {stage === 'login' ? (
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            Account created. Log in to continue and confirm your place.
          </p>

          <div className="grid gap-2">
            <Label htmlFor="loginEmail">Email</Label>
            <Input
              id="loginEmail"
              type="email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-11"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="loginPassword">Password</Label>
            <Input
              id="loginPassword"
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              autoComplete="current-password"
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
            {submitting ? 'Logging in…' : 'Log in'}
          </Button>
        </form>
      ) : null}

      {stage === 'confirm' ? (
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            You&apos;re signed in as <strong>{signedInEmail}</strong>. Tap
            below to confirm your place as{' '}
            {isHousehold ? 'a household member' : 'Primary Resident'} of{' '}
            {propertyLabel}
            {context.unitLabel ? ` · ${context.unitLabel}` : ''}.
          </p>

          {error ? (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm"
            >
              {error}
            </p>
          ) : null}

          <Button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={submitting}
            className="h-11 w-full"
          >
            {submitting ? 'Joining…' : `Join ${propertyLabel}`}
          </Button>
        </div>
      ) : null}

      <p className="text-muted-foreground mt-8 text-center text-xs">
        Not your invite?{' '}
        <Link href="/resident/join" className="underline underline-offset-4">
          Enter a code manually
        </Link>
      </p>
    </main>
  )
}

// ---------------------------------------------------------------------------

function InviteStatusPanel({ context }: { context: InviteContext }) {
  let title: string
  let body: string

  if (context.status === 'expired') {
    title = 'This invite has expired'
    body =
      'Invite links are valid for 24 hours. Ask whoever sent it to generate a new one.'
  } else {
    title = 'This invite is not valid'
    body =
      'The code may be wrong or already used. Ask for a new invite link.'
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </header>

      <p className="text-muted-foreground text-sm">{body}</p>

      <div className="mt-8 flex flex-col gap-3">
        <Link
          href="/resident/join"
          className="text-foreground text-sm underline underline-offset-4"
        >
          Enter a different code
        </Link>
        <Link
          href="/admin/login"
          className="text-muted-foreground text-xs underline underline-offset-4"
        >
          Admin login
        </Link>
      </div>
    </main>
  )
}

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

function mapRedeemError(message: string): string {
  if (message.includes('NOT_AUTHENTICATED')) {
    return 'Your session expired. Please log in again.'
  }
  if (message.includes('INVITE_INVALID_OR_EXPIRED')) {
    return 'This invite is no longer valid. Ask for a new link.'
  }
  if (message.includes('UNIT_ALREADY_OCCUPIED')) {
    return 'This unit already has a resident. Contact your admin.'
  }
  if (message.includes('ALREADY_PRIMARY_RESIDENT')) {
    return 'You’re already the Primary Resident of a unit in this estate.'
  }
  if (message.includes('ALREADY_HOUSEHOLD_MEMBER')) {
    return 'You are already a household member of this unit.'
  }
  if (message.includes('SUBSCRIPTION_INACTIVE')) {
    return 'This estate’s subscription is inactive. Contact your admin.'
  }
  return 'Could not complete the redemption. Please try again.'
}
