import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { GuardsClient } from './guards-client'

/**
 * /admin/guards — list, create, deactivate guards.
 *
 * Server Component. Fetches the admin's membership, org status, and the
 * org's guard profiles joined with their person rows.
 *
 * Guards without accounts — they log in with shift_code + guard_code via
 * /api/guard-session/start. No invitation, no password.
 */

export default async function GuardsPage() {
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

  // Guard profiles joined with person rows via the person_id FK. Supabase
  // exposes the joined row under the singular of the foreign table name.
  const { data: rows } = await supabase
    .from('guard_profiles')
    .select(
      'id, guard_code, status, created_at, people!inner(id, full_name, phone, email)',
    )
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true })

  const guards: GuardRow[] = (rows ?? []).map((r) => {
    // Supabase types the joined row as an array or object depending on
    // cardinality. Our FK is many-to-one so it is a single object.
    const person = Array.isArray(r.people) ? r.people[0] : r.people
    return {
      id: r.id as string,
      guard_code: r.guard_code as string,
      status: r.status as string,
      created_at: r.created_at as string,
      full_name: (person?.full_name as string) ?? '',
      phone: (person?.phone as string | null) ?? null,
      email: (person?.email as string | null) ?? null,
    }
  })

  return (
    <GuardsClient
      organizationId={organizationId}
      orgStatus={(org?.status as string) ?? 'unknown'}
      initialGuards={guards}
    />
  )
}

export interface GuardRow {
  id: string
  guard_code: string
  status: string
  created_at: string
  full_name: string
  phone: string | null
  email: string | null
}
