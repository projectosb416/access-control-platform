import Link from 'next/link'
import {
  Activity,
  ArrowRight,
  Building2,
  Fingerprint,
  Home,
  Lock,
  ScrollText,
  Shield,
  UserCheck,
  Users,
  Wallet,
  Zap,
} from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Hero } from './_components/hero'

/**
 * Landing page — `/`.
 *
 * Server Component. Only the Hero is a Client Component (animated).
 * Everything below is server-rendered static content.
 *
 * Section order:
 *   1. Hero — animated, from _components/hero.tsx
 *   2. How it works — three-step product flow
 *   3. Role grid — Guard / Resident / Admin / Platform, with login links
 *   4. Features — six capability tiles
 *   5. Pricing teaser — single CTA into /admin/signup
 *
 * The Hero CTA "See how it works" anchors to #how-it-works. That id
 * lives on the section below.
 */

export default function LandingPage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <RoleGrid />
      <Features />
      <PricingTeaser />
    </>
  )
}

// ---------------------------------------------------------------------------
// How it works — three-step flow
// ---------------------------------------------------------------------------

const STEPS = [
  {
    icon: Fingerprint,
    title: 'Resident issues a PIN',
    body: 'A resident opens the app, generates a 6-digit guest PIN scoped to their unit. Time-limited, revocable, no account needed for the visitor.',
  },
  {
    icon: UserCheck,
    title: 'Guard verifies at the gate',
    body: 'The guard enters the PIN on their phone. The server validates the credential, checks authorization windows, and applies rate limits. Entry is granted or refused — never inferred.',
  },
  {
    icon: ScrollText,
    title: 'Every attempt is written',
    body: 'Every entry, every exit, every refusal is recorded in an append-only event log. Unresolved sessions stay visible. Nothing is quietly closed.',
  },
] as const

function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
        <header className="mx-auto max-w-2xl text-center">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            How it works
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Three steps. Every time.
          </h2>
          <p className="text-muted-foreground mt-4 text-base">
            The chain is short and server-authoritative. Person, authorization,
            credential, session, event — nothing skips a link.
          </p>
        </header>

        <ol className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li
              key={s.title}
              className="bg-muted/30 flex flex-col gap-4 rounded-lg border p-6"
            >
              <div className="flex items-center gap-3">
                <span className="bg-background border-border flex h-10 w-10 items-center justify-center rounded-md border">
                  <s.icon className="h-5 w-5" strokeWidth={1.75} />
                </span>
                <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                  Step {i + 1}
                </span>
              </div>
              <h3 className="text-lg font-semibold tracking-tight">{s.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {s.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Role grid — four product surfaces
// ---------------------------------------------------------------------------

const ROLES = [
  {
    icon: Shield,
    title: 'Guards',
    body: 'Phone-first PIN entry at the gate. Entry, exit, shift end.',
    href: '/guard',
    linkLabel: 'Sign in',
  },
  {
    icon: Home,
    title: 'Residents',
    body: 'Issue guest PINs, manage household, track visits.',
    href: '/resident/login',
    linkLabel: 'Sign in',
  },
  {
    icon: Users,
    title: 'Estate admins',
    body: 'Properties, units, gates, guards, shifts, billing, live activity.',
    href: '/admin/login',
    linkLabel: 'Sign in',
  },
  {
    icon: Building2,
    title: 'Platform owners',
    body: 'Cross-tenant visibility. Subscriptions, revenue, audit.',
    href: '/platform/login',
    linkLabel: 'Sign in',
  },
] as const

function RoleGrid() {
  return (
    <section className="border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
        <header className="mx-auto max-w-2xl text-center">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Surfaces
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Four surfaces. One platform.
          </h2>
          <p className="text-muted-foreground mt-4 text-base">
            Each role gets a purpose-built experience. All four write to the
            same append-only ledger.
          </p>
        </header>

        <ul className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((r) => (
            <li
              key={r.title}
              className="bg-background flex flex-col gap-4 rounded-lg border p-5"
            >
              <span className="bg-muted/50 flex h-10 w-10 items-center justify-center rounded-md">
                <r.icon className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-semibold tracking-tight">
                  {r.title}
                </h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {r.body}
                </p>
              </div>
              <Link
                href={r.href}
                className="text-muted-foreground hover:text-foreground mt-auto inline-flex items-center gap-1 text-sm underline-offset-4 transition-colors hover:underline"
              >
                {r.linkLabel}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Features — six capability tiles
// ---------------------------------------------------------------------------

const FEATURES = [
  {
    icon: Shield,
    title: 'Server-authoritative',
    body: 'Every gate action is verified server-side before it is written. No client-side inference, no optimistic success.',
  },
  {
    icon: ScrollText,
    title: 'Append-only audit',
    body: 'Every gate action, credential issue, refund, and subscription change. Immutable history by schema.',
  },
  {
    icon: Fingerprint,
    title: 'PIN-based credentials',
    body: '6-digit, PBKDF2-hashed, lookup-key scoped to the org. Visitors never need an account.',
  },
  {
    icon: Lock,
    title: 'Scoped rate limiting',
    body: 'Per-credential, per-gate, per-guard. Lockouts can never trap a visitor inside the property.',
  },
  {
    icon: Activity,
    title: 'Realtime command center',
    body: 'Admins see gate activity as it happens — live, not on a delay.',
  },
  {
    icon: Wallet,
    title: 'Built-in payments',
    body: 'Bank transfer and card (Paystack). Manual and webhook-confirmed, both on the same ledger.',
  },
] as const

function Features() {
  return (
    <section className="border-t">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:py-24">
        <header className="mx-auto max-w-2xl text-center">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
            Platform
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Built for the gate, not around it.
          </h2>
          <p className="text-muted-foreground mt-4 text-base">
            Access control is a record-keeping problem as much as a security
            one. Everything here starts from that premise.
          </p>
        </header>

        <ul className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li
              key={f.title}
              className="bg-muted/30 flex flex-col gap-3 rounded-lg border p-5"
            >
              <span className="bg-background border-border flex h-9 w-9 items-center justify-center rounded-md border">
                <f.icon className="h-4 w-4" strokeWidth={1.75} />
              </span>
              <h3 className="text-base font-semibold tracking-tight">
                {f.title}
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {f.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Pricing teaser
// ---------------------------------------------------------------------------

function PricingTeaser() {
  return (
    <section className="border-t">
      <div className="mx-auto w-full max-w-4xl px-6 py-20 text-center sm:py-24">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Pricing
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Tiered. Annual. VAT-exclusive.
        </h2>
        <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-base">
          Plans scale with gates, guards, units, and properties. Start with a
          trial, upgrade when you are ready. Cancel any time — your existing
          shifts and valid PINs keep working.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/admin/signup"
            className={cn(buttonVariants({ size: 'lg' }), 'h-11 px-6 text-base')}
          >
            Create your estate
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
          <Link
            href="/admin/login"
            className={cn(
              buttonVariants({ size: 'lg', variant: 'outline' }),
              'h-11 px-6 text-base',
            )}
          >
            Sign in to admin
          </Link>
        </div>

        <p className="text-muted-foreground mt-6 text-xs">
          <Zap className="mr-1 inline h-3 w-3 align-text-top" strokeWidth={2} />
          Live on staging today. Production onboarding opens shortly.
        </p>
      </div>
    </section>
  )
}
