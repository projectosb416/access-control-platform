import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Guard session middleware.
 *
 * Runs before every /api/guard/* request. Verifies the shift session cookie
 * against shift_sessions.session_token_hash, and on success attaches the
 * resolved session context to the downstream request as x-shift-* headers.
 *
 * On failure, returns 401 with the appropriate code from the error mapping
 * spec (docs/phase-7/error-http-mapping.md).
 *
 * Security note: any incoming x-shift-* headers are stripped before the
 * middleware does its work, so a caller cannot spoof session context by
 * sending headers directly.
 *
 * See docs/phase-7/guard-auth-model.md for the full model.
 */

const GUARD_COOKIE = 'shift_session'

// 43 chars for base64url(32 bytes). Allow up to 100 for future formats,
// but reject anything wildly larger — a caller sending a huge cookie is
// not a real guard.
const MAX_TOKEN_LENGTH = 100

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function unauthorized(code: string) {
  return NextResponse.json({ code }, { status: 401 })
}

export async function middleware(request: NextRequest) {
  // 1. Strip any spoofed x-shift-* headers from the incoming request.
  const headers = new Headers(request.headers)
  headers.delete('x-shift-session-id')
  headers.delete('x-guard-profile-id')
  headers.delete('x-gate-id')
  headers.delete('x-organization-id')

  // 2. Read and sanity-check the cookie.
  const token = request.cookies.get(GUARD_COOKIE)?.value
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return unauthorized('SHIFT_SESSION_REQUIRED')
  }

  // 3. Hash and resolve.
  const tokenHash = await sha256Hex(token)
  const supabase = createServiceClient()

  const { data, error } = await supabase.rpc('resolve_shift_session', {
    p_token_hash: tokenHash,
  })

  if (error) {
    // Genuine system failure — do not log the guard out because Postgres
    // had a hiccup. Return 503 so the device retries rather than forcing
    // a re-auth.
    return NextResponse.json({ code: 'SYSTEM_UNAVAILABLE' }, { status: 503 })
  }

  if (!data || data.length === 0) {
    // No matching session, or the session/shift is no longer active.
    return unauthorized('SHIFT_SESSION_INVALID')
  }

  // 4. Attach resolved context. Route handlers read these; they cannot be
  //    spoofed because we stripped the incoming versions above.
  const session = data[0] as {
    shift_session_id: string
    guard_profile_id: string
    gate_id: string
    organization_id: string
  }

  headers.set('x-shift-session-id', session.shift_session_id)
  headers.set('x-guard-profile-id', session.guard_profile_id)
  headers.set('x-gate-id', session.gate_id)
  headers.set('x-organization-id', session.organization_id)

  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: ['/api/guard/:path*'],
}
