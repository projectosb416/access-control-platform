import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { LogoutButton } from './logout-button'
import { GuestPinSection } from './guest-pin-section'
import { RecentVisitsSection } from './recent-visits-section'
import { NotificationsSection } from './notifications-section'
import type { GuestPin, UnitVisit, Notification } from './types'

/**
 * /resident — resident dashboard.
 *
 * auth.users.id (Supabase user.id) is NOT accounts.id. Every query here
 * resolves through accounts.auth_user_id explicitly. This was the original
 * bug: filtering people/occupancies by user.id returned zero rows because
 * those tables reference accounts.id, not the auth id.
 *
 * The guest PIN section below the header is the daily action. It reads
 * from list_guest_pins_for_unit (migration 0051), which is SECURITY
 * DEFINER because people RLS hides visitor rows (account_id NULL) from
 * residents.
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

  // Step 3: active occupancy for this account. At most one
  // (occupancies_one_active_per_account). Includes units.id because the
  // guest PIN RPC needs the unit UUID.
  const { data: occupancy } = accountId
    ? await supabase
        .from('occupancies')
        .select('id, units!inner(id, label, properties!inner(name))')
        .eq('account_id', accountId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle()
    : { data: null }

  const occ = occupancy as unknown as {
    units:
      | { id: string; label: string; properties: { name: string } | { name: string }[] }
      | { id: string; label: string; properties: { name: string } | { name: string }[] }[]
  } | null

  const unit = occ ? unwrap(occ.units) : null
  const property = unit ? unwrap(unit.properties) : null

  // Step 4: guest PINs for this unit. Server fetch through the RPC because
  // visitor person rows are not visible to residents under people RLS.
  let guestPins: GuestPin[] = []
  if (unit?.id) {
    const { data: pins } = await supabase.rpc('list_guest_pins_for_unit', {
      p_unit_id: unit.id,
    })
    guestPins = (pins ?? []) as GuestPin[]
  }

  // Step 5: recent visits to this unit. Same residency check inside the
  // RPC — non-residents get NOT_AUTHORIZED, unknown units get
  // UNIT_NOT_FOUND. Errors here are non-fatal: an empty list is the
  // graceful fallback so a backend hiccup doesn't blank the whole page.
  let visits: UnitVisit[] = []
  if (unit?.id) {
    const { data: rows } = await supabase.rpc('list_unit_visits', {
      p_unit_id: unit.id,
    })
    visits = (rows ?? []) as UnitVisit[]
  }

  // Step 6: notifications for this account. Direct table read — RLS
  // policy notifications_select_self scopes to the caller. Newest
  // first, capped at 10 by the component. Non-fatal on error.
  let notifications: Notification[] = []
  {
    const { data: rows } = await supabase
      .from('notifications')
      .select('id, category, priority, title, body, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(10)
    notifications = (rows ?? []) as Notification[]
  }

  // Timestamp is computed once per request and passed to the client so
  // server and client render identical expiry labels.
  const nowIso = new Date().toISOString()

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

      {unit?.id ? (
        <>
          <GuestPinSection
            unitId={unit.id}
            estateName={property?.name ?? 'Your estate'}
            unitLabel={unit.label}
            residentName={person.full_name}
            initialPins={guestPins}
            nowIso={nowIso}
          />
          <RecentVisitsSection visits={visits} nowIso={nowIso} />
          <NotificationsSection
            notifications={notifications}
            nowIso={nowIso}
          />
        </>
      ) : (
        <section className="bg-muted/40 rounded-lg border p-5">
          <h2 className="text-base font-medium">No unit yet</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Ask your estate admin for an invite link, or paste a code you
            already received.
          </p>
        </section>
      )}
    </main>
  )
}
