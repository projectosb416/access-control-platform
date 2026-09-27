import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { UnitsClient } from './units-client'
import type { OccupancyInfo, UnitRow } from './types'

/**
 * /admin/units — list, add, bulk-create, invite residents.
 *
 * Server Component. Fetches properties, units, and occupancy states in
 * the shape the client needs to render per-row actions:
 *   vacant   → Invite resident
 *   invited  → pending/expired state, Copy link (if code in session), Cancel
 *   occupied → resident name (eject flow is a later piece)
 */

interface UnitQueryRow {
  id: string
  label: string
  notes: string | null
  status: string
  property_id: string
  properties: { name: string } | { name: string }[] | null
}

interface OccupancyQueryRow {
  id: string
  unit_id: string
  status: string
  account_id: string | null
  invite_expires_at: string | null
  invited_at: string | null
}

function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export default async function UnitsPage() {
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
    .select('status')
    .eq('id', organizationId)
    .single()

  const { data: propertiesRaw } = await supabase
    .from('properties')
    .select('id, name')
    .eq('organization_id', organizationId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })

  const properties = (propertiesRaw ?? []) as { id: string; name: string }[]
  const propertyIds = properties.map((p) => p.id)

  let unitsRaw: unknown[] = []
  if (propertyIds.length > 0) {
    const { data } = await supabase
      .from('units')
      .select('id, label, notes, status, property_id, properties!inner(name)')
      .in('property_id', propertyIds)
      .order('label', { ascending: true })
    unitsRaw = data ?? []
  }

  const units: UnitRow[] = (unitsRaw as UnitQueryRow[]).map((u) => {
    const prop = unwrap(u.properties)
    return {
      id: u.id,
      label: u.label,
      notes: u.notes,
      status: u.status,
      property_id: u.property_id,
      property_name: prop?.name ?? '—',
    }
  })

  // Fetch relevant occupancies (active or invited) for these units.
  const unitIds = units.map((u) => u.id)
  let occRaw: unknown[] = []
  if (unitIds.length > 0) {
    const { data } = await supabase
      .from('occupancies')
      .select('id, unit_id, status, account_id, invite_expires_at, invited_at')
      .in('unit_id', unitIds)
      .in('status', ['active', 'invited'])
    occRaw = data ?? []
  }
  const occupancies = occRaw as OccupancyQueryRow[]

  // Look up resident names for occupied units.
  const accountIds = Array.from(
    new Set(
      occupancies
        .filter((o) => o.status === 'active' && o.account_id)
        .map((o) => o.account_id as string),
    ),
  )
  const nameByAccount = new Map<string, string>()
  if (accountIds.length > 0) {
    const { data: peopleRows } = await supabase
      .from('people')
      .select('account_id, full_name')
      .eq('organization_id', organizationId)
      .in('account_id', accountIds)

    for (const p of (peopleRows ?? []) as {
      account_id: string
      full_name: string
    }[]) {
      nameByAccount.set(p.account_id, p.full_name)
    }
  }

  // Build per-unit occupancy state.
  const occupancyByUnit: Record<string, OccupancyInfo> = {}
  for (const u of units) {
    occupancyByUnit[u.id] = { kind: 'vacant' }
  }
  for (const o of occupancies) {
    if (o.status === 'active') {
      occupancyByUnit[o.unit_id] = {
        kind: 'occupied',
        occupancy_id: o.id,
        resident_name: o.account_id ? nameByAccount.get(o.account_id) ?? null : null,
      }
    } else if (o.status === 'invited') {
      occupancyByUnit[o.unit_id] = {
        kind: 'invited',
        occupancy_id: o.id,
        expires_at: o.invite_expires_at,
        invited_at: o.invited_at,
      }
    }
  }

  return (
    <UnitsClient
      organizationId={organizationId}
      orgStatus={(org?.status as string) ?? 'unknown'}
      properties={properties}
      initialUnits={units}
      occupancyByUnit={occupancyByUnit}
    />
  )
}


