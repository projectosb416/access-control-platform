import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from './logout-button'

/**
 * /resident — placeholder dashboard.
 *
 * Reads the Supabase session, resolves the caller's person row and their
 * active occupancy (if any), and renders a minimal welcome. Real content
 * (household management, guest PINs, activity feed) is Phase 9 piece 4.
 *
 * If no session → redirect to /resident/login.
 * If session but no occupancy → the resident hasn't completed redemption
 * yet. Show a prompt pointing to /resident/join.
 */

export default async function ResidentHomePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/resident/login')
  }

  const { data: person } = await supabase
    .from('people')
    .select('id, full_name, organization_id')
    .eq('account_id', user.id)
    .limit(1)
    .maybeSingle()

  // No person row → no completed redemption yet.
  if (!person) {
    return (
      <main className="flex flex-1 flex-col px-6 py-10">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">
              Welcome
            </h1>
            <p className="text-muted-foreground mt-1 truncate text-sm">
              Signed in as {user.email}
            </p>
          </div>
          <LogoutButton />
        </header>

        <section className="bg-muted/40 rounded-lg border p-5">
          <h2 className="text-base font-medium">No unit yet</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            You don&apos;t have an assigned unit. Ask your estate admin for an
            invite link, or paste a code you already received.
          </p>
          <Link
            href="/resident/join"
            className="text-foreground mt-4 inline-block text-sm underline underline-offset-4"
          >
            Enter an invite code
          </Link>
        </section>
      </main>
    )
  }

  const { data: occupancy } = await supabase
    .from('occupancies')
    .select(
      'id, units!inner(label, properties!inner(name))',
    )
    .eq('account_id', user.id)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  function unwrap<T>(v: T | T[] | null | undefined): T | null {
    if (v === null || v === undefined) return null
    return Array.isArray(v) ? (v[0] ?? null) : v
  }

  const occ = occupancy as unknown as {
    units:
      | { label: string; properties: { name: string } | { name: string }[] }
      | { label: string; properties: { name: string } | { name: string }[] }[]
  } | null

  const unit = occ ? unwrap(occ.units) : null
  const property = unit ? unwrap(unit.properties) : null

  return (
    <main className="flex flex-1 flex-col px-6 py-10">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            {property?.name ?? 'Your estate'}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            {person.full_name}
          </h1>
          {unit ? (
            <p className="text-muted-foreground mt-1 text-sm">
              Unit {unit.label}
            </p>
          ) : null}
        </div>
        <LogoutButton />
      </header>

      <section className="bg-muted/40 rounded-lg border p-5">
        <h2 className="text-base font-medium">Dashboard coming soon</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Household management, guest access, and unit activity will appear
          here.
        </p>
      </section>
    </main>
  )
}
