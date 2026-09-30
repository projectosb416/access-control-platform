/**
 * Shared types for the resident dashboard.
 *
 * GuestPin mirrors the row shape returned by list_guest_pins_for_unit
 * (migration 0051). Field names match the RPC exactly, so no mapping is
 * required when passing data from the Server Component to the client.
 */

export type GuestPin = {
  authorization_id: string
  credential_id: string | null
  visitor_full_name: string | null
  visitor_phone: string | null
  purpose: string
  note: string | null
  access_type: string
  authorization_type: string
  status: string
  valid_from: string
  valid_until: string
  created_at: string
  updated_at: string
  entry_count: number
  is_active: boolean
}

export type GenerateGuestPinRequest = {
  unit_id: string
  visitor_full_name: string
  visitor_phone: string | null
  purpose: string
  access_type: string
  authorization_type: 'one_time' | 'reusable'
  valid_from: string
  valid_until: string
  note: string | null
}

export type GenerateGuestPinResponse = {
  authorization_id: string
  credential_id: string
  pin: string
}

export interface UnitVisit {
  session_id: string
  visitor_name: string
  entered_at: string
  exited_at: string | null
  status: 'open' | 'completed' | 'unresolved'
}
