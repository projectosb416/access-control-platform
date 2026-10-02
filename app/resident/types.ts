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

/**
 * Mirrors the row shape returned by list_unit_visits (migration 0056).
 * Field names match the RPC exactly — no mapping needed when passing
 * data from the Server Component to the client.
 *
 * status is one of: 'open' | 'completed' | 'unresolved' (per
 * access_sessions_status_check). resolved_at is non-null only when an
 * unresolved session has since been resolved by admin.
 */
export type UnitVisit = {
  session_id: string
  visitor_name: string
  entered_at: string
  exited_at: string | null
  status: 'open' | 'completed' | 'unresolved'
  resolved_at: string | null
}

/**
 * Mirrors the row shape returned from public.notifications (migration
 * 0015). Only the fields the resident dashboard actually renders —
 * further columns exist (access_event_id, gate_id, group_key, etc.)
 * and can be added here when a feature needs them.
 *
 * read_at = null means unread. The table's RLS policy
 * notifications_select_self already filters to the current account,
 * so no SECURITY DEFINER wrapper is required for reads.
 *
 * category and priority are enum-constrained on the table:
 *   category:  access | security | operations | system | billing
 *   priority:  information | attention | high
 */
export type Notification = {
  id: string
  category: 'access' | 'security' | 'operations' | 'system' | 'billing'
  priority: 'information' | 'attention' | 'high'
  title: string
  body: string | null
  read_at: string | null
  created_at: string
}

/**
 * Mirrors the row shape returned by list_household_members (migration
 * 0057). Field names match the RPC exactly — no mapping needed when
 * passing data from the Server Component to the client.
 *
 * status is one of: 'invited' | 'active' | 'ended'
 * (per household_members_status_check).
 *
 * full_name is null for invited rows (no person_id yet).
 * ended_at and end_reason are populated only when status = 'ended'.
 */
export type HouseholdMember = {
  household_member_id: string
  full_name: string | null
  status: 'invited' | 'active' | 'ended'
  invited_at: string
  joined_at: string | null
  ended_at: string | null
  end_reason: string | null
  invite_expires_at: string | null
}
