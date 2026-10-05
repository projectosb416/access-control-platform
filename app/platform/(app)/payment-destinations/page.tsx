import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { DestinationsClient } from './destinations-client'
import type { DestinationRow } from './destinations-client'

/**
 * /platform/payment-destinations — manage bank transfer destinations.
 *
 * Server Component. Reads all rows (active + inactive) — the platform
 * admin RLS policy has no is_active predicate, and the platform layout
 * already gates on is_platform_admin(). No client filter needed.
 *
 * Ordered is_active desc, then created_at desc: the active row appears
 * first, then most-recently-created inactive rows.
 *
 * No pagination — expected destination count is single digits. If that
 * changes, add a limit.
 */

export default async function PaymentDestinationsPage() {
  const supabase = await createClient()

  const { data: rows } = await supabase
    .from('payment_destinations')
    .select(
      'id, label, business_name, bank_account_name, bank_name, bank_account_number, bank_transfer_note, is_active',
    )
    .order('is_active', { ascending: false })
    .order('created_at', { ascending: false })

  const destinations = (rows ?? []) as DestinationRow[]

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-8">
      <nav className="mb-6">
        <Link
          href="/platform"
          className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
        >
          ← Back to overview
        </Link>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Payment destinations
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Bank accounts the platform accepts transfers into. Org admins
          see only the active destination when they choose to pay by
          bank transfer.
        </p>
      </header>

      <DestinationsClient destinations={destinations} />
    </div>
  )
}
