import { createClient as createUserClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { JoinClient } from './join-client'

/**
 * /resident/join/[code] — invite redemption entry point.
 *
 * Server Component. Validates the invite code, resolves the target unit
 * and property for display, and detects whether the caller already has a
 * session. Passes status + display context + hash to the client, which
 * handles the three-state UI (signup → login → confirm).
 *
 * Two invite types are supported, distinguished by which table the code
 * hash matches:
 *   unit       — occupancies.invite_code_hash. Creates an occupancy +
 *                primary_resident membership on redemption.
 *   household  — household_members.invite_code_hash. Links the redeemer
 *                to the unit as a co-occupant, no occupancy row.
 *
 * Lookup uses the service role client because unauthenticated visitors
 * (which is the majority here) cannot read occupancies or
 * household_members under RLS. The code itself is the secret; anyone
 * with the code can see the invite's display context, which is the
 * intended surface.
 */

const ALPHABET_REGEX = /[^23456789ABCDEFGHJKMNPQRSTUVWXYZ]/g

export type InviteStatus = 'valid' | 'expired' | 'not_found'
export type InviteType = 'unit' | 'household'

export interface InviteContext {
  status: InviteStatus
  inviteType: InviteType | null
  code: string
  hash: string
  propertyName: string | null
  unitLabel: string | null
  expiresAt: string | null
}

interface InviteLookupRow {
  invite_expires_at: string | null
  units:
    | { label: string; properties: { name: string } | { name: string }[] }
    | { label: string; properties: { name: string } | { name: string }[] }[]
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (v === null || v === undefined) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  const normalized = code.toUpperCase().replace(ALPHABET_REGEX, '')
  const hash = await sha256Hex(normalized)

  // Session check via user client (reads cookies).
  const userClient = await createUserClient()
  const {
    data: { user },
  } = await userClient.auth.getUser()

  // Look up the invite via service role — try unit invites first, then
  // household invites. Both use the same shape of query.
  const svc = createServiceClient()

  const { data: unitRows } = await svc
    .from('occupancies')
    .select(
      'invite_expires_at, units!inner(label, properties!inner(name))',
    )
    .eq('invite_code_hash', hash)
    .eq('status', 'invited')
    .limit(1)

  let inviteRow: InviteLookupRow | null = null
  let inviteType: InviteType | null = null

  if (unitRows && unitRows.length > 0) {
    inviteRow = unitRows[0] as unknown as InviteLookupRow
    inviteType = 'unit'
  } else {
    const { data: hmRows } = await svc
      .from('household_members')
      .select(
        'invite_expires_at, units!inner(label, properties!inner(name))',
      )
      .eq('invite_code_hash', hash)
      .eq('status', 'invited')
      .limit(1)

    if (hmRows && hmRows.length > 0) {
      inviteRow = hmRows[0] as unknown as InviteLookupRow
      inviteType = 'household'
    }
  }

  let context: InviteContext = {
    status: 'not_found',
    inviteType: null,
    code: normalized,
    hash,
    propertyName: null,
    unitLabel: null,
    expiresAt: null,
  }

  if (inviteRow) {
    const unit = unwrap(inviteRow.units)
    const property = unit ? unwrap(unit.properties) : null
    // Server Components are per-request. Date.now() here is not a
    // re-render hazard; the rule fires because it also catches Client
    // Components. Justified disable on the one line.
    // eslint-disable-next-line react-hooks/purity
    const nowMs = Date.now()
    const expired =
      inviteRow.invite_expires_at !== null &&
      new Date(inviteRow.invite_expires_at).getTime() <= nowMs

    context = {
      status: expired ? 'expired' : 'valid',
      inviteType,
      code: normalized,
      hash,
      propertyName: property?.name ?? null,
      unitLabel: unit?.label ?? null,
      expiresAt: inviteRow.invite_expires_at,
    }
  }

  return (
    <JoinClient
      context={context}
      initialSignedIn={Boolean(user)}
      initialSignedInEmail={user?.email ?? null}
    />
  )
}
