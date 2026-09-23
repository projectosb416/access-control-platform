import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * POST /api/guard-session/start
 *
 * Guard enters shift_code + guard_code, receives an HttpOnly session cookie.
 * Worker generates a 32-byte random token, SHA-256 hashes it, passes the
 * hash to start_shift_session, and sets the raw token as a cookie.
 *
 * Known limitation (documented for Phase 8): the guard device must know
 * which organization it belongs to. For v1, organization_id is accepted
 * in the request body. A future enrolment flow will bind the device to
 * its org at setup time.
 *
 * See docs/phase-7/guard-auth-model.md.
 */

export const runtime = 'nodejs'

const COOKIE_NAME = 'shift_session'
const COOKIE_MAX_AGE_SECONDS = 86400  // 24h — shift status is the real bound
const TOKEN_BYTES = 32

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function POST(request: NextRequest) {
  // -------------------------------------------------------------------------
  // 1. Parse body
  // -------------------------------------------------------------------------
  let body: {
    shift_code?: unknown
    guard_code?: unknown
    organization_id?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ code: 'INVALID_BODY' }, { status: 400 })
  }

  const shiftCode = typeof body.shift_code === 'string' ? body.shift_code : ''
  const guardCode = typeof body.guard_code === 'string' ? body.guard_code : ''
  const organizationId =
    typeof body.organization_id === 'string' ? body.organization_id : ''

  if (!shiftCode || !guardCode || !organizationId) {
    return NextResponse.json({ code: 'MISSING_REQUIRED_FIELD' }, { status: 400 })
  }

  // -------------------------------------------------------------------------
  // 2. Generate session token (raw + hash)
  // -------------------------------------------------------------------------
  const rawTokenBytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))
  const rawToken = base64UrlEncode(rawTokenBytes)
  const tokenHash = await sha256Hex(rawToken)

  // -------------------------------------------------------------------------
  // 3. Call start_shift_session
  // -------------------------------------------------------------------------
  const supabase = createServiceClient()

  const { data, error } = await supabase.rpc('start_shift_session', {
    p_organization_id: organizationId,
    p_shift_code: shiftCode,
    p_guard_code: guardCode,
    p_session_token_hash: tokenHash,
    p_early_minutes: 30,
  })

  if (error) {
    const code = extractDbErrorCode(error.message)
    return NextResponse.json({ code }, { status: statusForCode(code) })
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ code: 'SYSTEM_UNAVAILABLE' }, { status: 503 })
  }

  const session = data[0] as {
    session_id: string
    shift_id: string
    gate_id: string
  }

  // -------------------------------------------------------------------------
  // 4. Set the cookie and return the session context
  // -------------------------------------------------------------------------
  const response = NextResponse.json({
    shift_session_id: session.session_id,
    shift_id: session.shift_id,
    gate_id: session.gate_id,
    organization_id: organizationId,
  })

  response.cookies.set({
    name: COOKIE_NAME,
    value: rawToken,
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/api',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  })

  return response
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractDbErrorCode(message: string): string {
  // Postgres raises our exception with the code as the message (raised via
  // `raise exception 'CODE_NAME'` in the plpgsql functions). The Supabase
  // JS client wraps it in .message. Match on the known list.
  const known = [
    'SHIFT_NOT_FOUND',
    'SHIFT_NOT_OPEN',
    'SHIFT_ENDED',
    'GUARD_NOT_FOUND',
    'GUARD_NOT_ACTIVE',
    'GUARD_ALREADY_ON_SHIFT',
    'GATE_NOT_ACTIVE',
    'GATE_CAPACITY_REACHED',
    'INVALID_SESSION_TOKEN_HASH',
  ]
  for (const code of known) {
    if (message.includes(code)) return code
  }
  return 'SYSTEM_UNAVAILABLE'
}

function statusForCode(code: string): number {
  switch (code) {
    case 'SHIFT_NOT_FOUND':
    case 'GUARD_NOT_FOUND':
      return 404
    case 'SHIFT_NOT_OPEN':
    case 'SHIFT_ENDED':
    case 'GUARD_ALREADY_ON_SHIFT':
    case 'GATE_CAPACITY_REACHED':
      return 409
    case 'GUARD_NOT_ACTIVE':
    case 'GATE_NOT_ACTIVE':
      return 409
    case 'INVALID_SESSION_TOKEN_HASH':
      return 500
    default:
      return 500
  }
}
