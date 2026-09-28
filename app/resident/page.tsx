import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from './logout-button'

/**
 * /resident — placeholder dashboard.
 *
 * auth.users.id (Supabase user.id) is NOT accounts.id. Every query here
 * resolves through accounts.auth_user_id explicitly. This was the original
 * bug: filtering people/occupancies by user.id returned zero rows because
 * those tables reference accounts.id, not the auth id.
 *
 * Real dashboard content (household, guest PINs, activity) is piece 4.
 */

function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export default async function ResidentHomePage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/resident/login')
  }

  // Step 1: resolve our internal accounts.id from the Supabase auth id.
  const { data: account } = await supabase
    .from('accounts')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  const accountId = account?.id ?? null

  // Step 2: person row for this account.
  const { data: person } = accountId
    ? await supabase
        .from('people')
        .select('id, full_name, organization_id')
        .eq('account_id', accountId)
        .limit(1)
        .maybeSingle()
    : { data: null }

  if (!person) {
    return (
      <main className="flex flex-1 flex-col px-6 py-10">
        <header className="mb-8 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
            <p className="text-muted-foreground mt-1 truncate text-sm">
              Signed in as {user.email}
            </p>
          </div>
          <LogoutButton />
        </header>

        <section className="bg-muted/40 rounded-lg border p-5">
          <h2 className="text-base font-medium">No unit yet</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            You don&apos;t have an assigned unit. Ask your estate admin for
            an invite link, or paste a code you already received.
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

  // Step 3: active occupancy for this account. At most one (partial unique
  // index occupancies_one_active_per_account).
  const { data: occupancy } = accountId
    ? await supabase
        .from('occupancies')
        .select('id, units!inner(label, properties!inner(name))')
        .eq('account_id', accountId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle()
    : { data: null }

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
