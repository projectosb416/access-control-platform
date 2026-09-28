import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { withSentryRoute } from '@/lib/sentry/route-wrapper'

/**
 * POST /api/resident/guest-pin/revoke
 *
 * Resident revokes a guest PIN they created. Thin wrapper over the
 * SECURITY DEFINER function revoke_guest_pin (migration 0054) — the
 * function owns all authorization and terminal-state logic. The endpoint
 * validates only that the request is well-formed.
 *
 * Auth: resident session client (anon key + user JWT), NOT service role.
 * The function calls current_account_id(), which resolves from the JWT.
 *
 * Body: { authorization_id: string (uuid) }
 * Response:
 *   200 { ok: true }           — revoked, or idempotent no-op on
 *                                already-revoked/cancelled
 *   401 NOT_AUTHENTICATED
 *   403 NOT_AUTHORIZED         — caller is not the owner or lacks
 *                                active occupancy on the unit
 *   404 AUTHORIZATION_NOT_FOUND
 *   409 NOT_REVOKABLE          — completed or expired; do not rewrite
 *                                history
 *   400 INVALID_BODY / MISSING_REQUIRED_FIELD
 *   500 SYSTEM_UNAVAILABLE
 *
 * See docs/phase-7/error-http-mapping.md.
 */

export const runtime = 'nodejs'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function jsonError(code: string, status: number) {
  return NextResponse.json({ code }, { status })
}

async function postHandler(request: NextRequest) {
  // -------------------------------------------------------------------------
  // 1. Session — resident must be authenticated
  // -------------------------------------------------------------------------
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return jsonError('NOT_AUTHENTICATED', 401)
  }

  // -------------------------------------------------------------------------
  // 2. Body typecheck — shape only, no business rules
  // -------------------------------------------------------------------------
  let body: { authorization_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonError('INVALID_BODY', 400)
  }

  const raw = typeof body.authorization_id === 'string'
    ? body.authorization_id.trim()
    : ''

  if (!raw) {
    return jsonError('MISSING_REQUIRED_FIELD', 400)
  }

  if (!UUID_REGEX.test(raw)) {
    return jsonError('MISSING_REQUIRED_FIELD', 400)
  }

  // -------------------------------------------------------------------------
  // 3. Delegate to the SECURITY DEFINER function
  // -------------------------------------------------------------------------
  const { error } = await supabase.rpc('revoke_guest_pin', {
    p_authorization_id: raw,
  })

  if (error) {
    const code = extractDbErrorCode(error.message)
    return jsonError(code, statusForCode(code))
  }

  // Idempotent: same response for fresh revoke and no-op re-revoke.
  return NextResponse.json({ ok: true }, { status: 200 })
}

// ---------------------------------------------------------------------------
// Error mapping (docs/phase-7/error-http-mapping.md)
// Codes reachable from revoke_guest_pin (migration 0054).
// ---------------------------------------------------------------------------

const KNOWN_CODES = [
  'NOT_AUTHENTICATED',
  'NOT_AUTHORIZED',
  'AUTHORIZATION_NOT_FOUND',
  'NOT_REVOKABLE',
] as const

function extractDbErrorCode(message: string): string {
  for (const code of KNOWN_CODES) {
    if (message.includes(code)) return code
  }
  return 'SYSTEM_UNAVAILABLE'
}

function statusForCode(code: string): number {
  switch (code) {
    case 'NOT_AUTHENTICATED':
      return 401
    case 'NOT_AUTHORIZED':
      return 403
    case 'AUTHORIZATION_NOT_FOUND':
      return 404
    case 'NOT_REVOKABLE':
      return 409
    default:
      return 500
  }
}

export const POST = withSentryRoute(postHandler)
