import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { UnitsClient } from './units-client'

/**
 * /admin/units — list, add, and bulk-create units for the org's properties.
 *
 * Server Component. Fetches properties (for the selector), units joined to
 * their property name, and active occupancies so each unit row can show
 * Vacant/Occupied.
 *
 * No new migration — units table (migration 0006) and units_insert_admin
 * RLS policy (migration 0022) already exist.
 *
 * Handoff §9: unit labels are free text, case-insensitively unique per
 * property. Bulk creation is the primary path — "House 1-200" pattern.
 */

interface UnitQueryRow {
  id: string
  label: string
  notes: string | null
  status: string
  property_id: string
  properties: { name: string } | { name: string }[] | null
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

  // Active occupancies — used to badge Vacant vs Occupied.
  const unitIds = units.map((u) => u.id)
  const occupiedUnitIds = new Set<string>()
  if (unitIds.length > 0) {
    const { data: occRows } = await supabase
      .from('occupancies')
      .select('unit_id')
      .in('unit_id', unitIds)
      .eq('status', 'active')
    for (const o of (occRows ?? []) as { unit_id: string }[]) {
      occupiedUnitIds.add(o.unit_id)
    }
  }

  const occupiedIdsArray = Array.from(occupiedUnitIds)

  return (
    <UnitsClient
      orgStatus={(org?.status as string) ?? 'unknown'}
      properties={properties}
      initialUnits={units}
      occupiedUnitIds={occupiedIdsArray}
    />
  )
}

export interface UnitRow {
  id: string
  label: string
  notes: string | null
  status: string
  property_id: string
  property_name: string
}
