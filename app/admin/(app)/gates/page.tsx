import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { GatesClient } from './gates-client'

/**
 * /admin/gates — list and create gates for the admin's organization.
 *
 * Server Component. Fetches the admin's membership, the org's current
 * status, and the existing gate list. Passes everything to the client
 * component for interactive add.
 *
 * RLS on gates_insert_admin enforces org membership AND operational
 * status. If the org is provisioning (no paid plan), inserts will be
 * rejected by the database. We surface that state up-front instead of
 * letting the user hit a permission error.
 */

export default async function GatesPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/admin/login')
  }

  const { data: membership } = await supabase
    .from('organization_memberships')
    .select('organization_id')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  if (!membership) {
    redirect('/admin/setup')
  }

  const organizationId = membership.organization_id as string

  const { data: org } = await supabase
    .from('organizations')
    .select('status, display_name')
    .eq('id', organizationId)
    .single()

  const { data: gates } = await supabase
    .from('gates')
    .select('id, name, description, max_active_guards, status, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true })

  return (
    <GatesClient
      organizationId={organizationId}
      orgStatus={(org?.status as string) ?? 'unknown'}
      initialGates={(gates as GateRow[] | null) ?? []}
    />
  )
}

export interface GateRow {
  id: string
  name: string
  description: string | null
  max_active_guards: number
  status: string
  created_at: string
}
