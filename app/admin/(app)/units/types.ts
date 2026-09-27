/**
 * Shared types for the units surface.
 *
 * Extracted from the original single units-client.tsx. `UnitRow` moved
 * here from page.tsx so both Server and Client modules import from one
 * place.
 */

export interface UnitRow {
  id: string
  label: string
  notes: string | null
  status: string
  property_id: string
  property_name: string
}

export type OccupancyInfo =
  | { kind: 'vacant' }
  | {
      kind: 'invited'
      occupancy_id: string
      expires_at: string | null
      invited_at: string | null
    }
  | {
      kind: 'occupied'
      occupancy_id: string
      resident_name: string | null
    }

export interface GeneratedInvite {
  occupancyId: string
  code: string
  link: string
  expiresAt: string
  propertyName: string
}

export interface PropertyOption {
  id: string
  name: string
}
