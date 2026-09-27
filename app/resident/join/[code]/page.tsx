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
 * Lookup uses the service role client because unauthenticated visitors
 * (which is the majority here) cannot read occupancies under RLS. The
 * code itself is the secret; anyone with the code can see the invite's
 * display context, which is the intended surface.
 */

const ALPHABET_REGEX = /[^23456789ABCDEFGHJKMNPQRSTUVWXYZ]/g

export type InviteStatus = 'valid' | 'expired' | 'not_found'

export interface InviteContext {
  status: InviteStatus
  code: string
  hash: string
  propertyName: string | null
  unitLabel: string | null
  expiresAt: string | null
}

interface OccupancyRow {
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

  // Look up the invite via service role.
  const svc = createServiceClient()
  const { data: rows } = await svc
    .from('occupancies')
    .select(
      'invite_expires_at, units!inner(label, properties!inner(name))',
    )
    .eq('invite_code_hash', hash)
    .eq('status', 'invited')
    .limit(1)

  let context: InviteContext = {
    status: 'not_found',
    code: normalized,
    hash,
    propertyName: null,
    unitLabel: null,
    expiresAt: null,
  }

  if (rows && rows.length > 0) {
    const row = rows[0] as unknown as OccupancyRow
    const unit = unwrap(row.units)
    const property = unit ? unwrap(unit.properties) : null
    // Server Components are per-request. Date.now() here is not a
    // re-render hazard; the rule fires because it also catches Client
    // Components. Justified disable on the one line.
    // eslint-disable-next-line react-hooks/purity
    const nowMs = Date.now()
    const expired =
      row.invite_expires_at !== null &&
      new Date(row.invite_expires_at).getTime() <= nowMs

    context = {
      status: expired ? 'expired' : 'valid',
      code: normalized,
      hash,
      propertyName: property?.name ?? null,
      unitLabel: unit?.label ?? null,
      expiresAt: row.invite_expires_at,
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
