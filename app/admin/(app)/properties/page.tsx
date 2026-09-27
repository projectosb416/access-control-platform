import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PropertiesClient } from './properties-client'

/**
 * /admin/properties — list, add, edit, archive properties.
 *
 * Server Component. Fetches properties with unit counts. Passes to client
 * for interactive edit and archive.
 *
 * Properties are the top level of the physical geography:
 *   Organization → Property → Unit
 *
 * A single-building org has one property. A multi-site org has many.
 */

export default async function PropertiesPage() {
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
    .select('id, name, address, city, state, country, status, created_at')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true })

  const propertyIds = (propertiesRaw ?? []).map((p) => p.id as string)

  // Unit counts per property.
  const unitCounts = new Map<string, number>()
  if (propertyIds.length > 0) {
    const { data: unitRows } = await supabase
      .from('units')
      .select('property_id')
      .in('property_id', propertyIds)
      .eq('status', 'active')

    for (const u of (unitRows ?? []) as { property_id: string }[]) {
      unitCounts.set(u.property_id, (unitCounts.get(u.property_id) ?? 0) + 1)
    }
  }

  const properties: PropertyRow[] = (propertiesRaw ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    address: (p.address as string | null) ?? null,
    city: (p.city as string | null) ?? null,
    state: (p.state as string | null) ?? null,
    country: (p.country as string | null) ?? 'NG',
    status: p.status as string,
    unit_count: unitCounts.get(p.id as string) ?? 0,
  }))

  return (
    <PropertiesClient
      organizationId={organizationId}
      orgStatus={(org?.status as string) ?? 'unknown'}
      initialProperties={properties}
    />
  )
}

export interface PropertyRow {
  id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  country: string | null
  status: string
  unit_count: number
}
