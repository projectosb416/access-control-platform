import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ShiftsClient } from './shifts-client'

/**
 * /admin/shifts — list, create, and cancel shifts.
 *
 * Server Component. Fetches gates (for the dropdown) and shifts joined
 * with gate names. Passes both to the client for interactive add and cancel.
 *
 * RLS on shifts_insert_admin enforces org membership and operational status.
 */

export default async function ShiftsPage() {
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
    .select('id, name, status')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  const { data: shiftRows } = await supabase
    .from('shifts')
    .select('id, shift_code, gate_id, scheduled_start, scheduled_end, status, gates!inner(name)')
    .eq('organization_id', organizationId)
    .order('scheduled_start', { ascending: false })
    .limit(50)

  const shifts: ShiftRow[] = (shiftRows ?? []).map((s) => {
    const g = Array.isArray(s.gates) ? s.gates[0] : s.gates
    return {
      id: s.id as string,
      shift_code: s.shift_code as string,
      gate_id: s.gate_id as string,
      gate_name: (g?.name as string) ?? 'Unknown gate',
      scheduled_start: s.scheduled_start as string,
      scheduled_end: s.scheduled_end as string,
      status: s.status as string,
    }
  })

  return (
    <ShiftsClient
      organizationId={organizationId}
      orgStatus={(org?.status as string) ?? 'unknown'}
      gates={(gates as { id: string; name: string }[] | null) ?? []}
      initialShifts={shifts}
    />
  )
}

export interface ShiftRow {
  id: string
  shift_code: string
  gate_id: string
  gate_name: string
  scheduled_start: string
  scheduled_end: string
  status: string
}
