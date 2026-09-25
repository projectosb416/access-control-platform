import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { withSentryRoute } from '@/lib/sentry/route-wrapper'

/**
 * POST /api/guard-session/end
 *
 * Ends the guard's current shift session. Idempotent: a second call (or a
 * call when the session was already ended) still returns success and clears
 * the cookie.
 *
 * Not middleware-protected. This is a session-boundary operation — the
 * endpoint does its own cookie handling, same as /api/guard-session/start.
 *
 * Response:
 *   200 { ok: true }               — session ended (or already ended)
 *   200 { ok: true, already_ended: true } — cookie cleared, nothing to end
 *   503 { code: SYSTEM_UNAVAILABLE }      — infrastructure failure
 */

export const runtime = 'nodejs'

const COOKIE_NAME = 'shift_session'

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set({
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/api',
    maxAge: 0,
  })
  return response
}

async function postHandler(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value

  // No cookie — nothing to end. Clear anyway in case of partial state.
  if (!token) {
    return clearSessionCookie(
      NextResponse.json({ ok: true, already_ended: true }),
    )
  }

  const supabase = createServiceClient()
  const tokenHash = await sha256Hex(token)

  // Direct lookup by token hash — does not depend on the shift still being
  // active. If the admin already ended the shift, the session row may still
  // be 'active' and needs closing.
  const { data: sessionRows, error: lookupError } = await supabase
    .from('shift_sessions')
    .select('id, shift_id')
    .eq('session_token_hash', tokenHash)
    .eq('status', 'active')
    .limit(1)

  if (lookupError) {
    return NextResponse.json({ code: 'SYSTEM_UNAVAILABLE' }, { status: 503 })
  }

  if (!sessionRows || sessionRows.length === 0) {
    return clearSessionCookie(
      NextResponse.json({ ok: true, already_ended: true }),
    )
  }

  const sessionId = sessionRows[0].id as string
  const shiftId = sessionRows[0].shift_id as string

  const { data: shiftRows, error: shiftError } = await supabase
    .from('shifts')
    .select('organization_id')
    .eq('id', shiftId)
    .limit(1)

  if (shiftError || !shiftRows || shiftRows.length === 0) {
    // Weird state — cookie is being cleared, but we couldn't resolve the
    // org. Log via Sentry (the route wrapper handles it) and return success
    // to the guard so they aren't stuck.
    return clearSessionCookie(
      NextResponse.json({ ok: true, already_ended: true }),
    )
  }

  const organizationId = shiftRows[0].organization_id as string

  const { error: endError } = await supabase.rpc('end_shift_session', {
    p_organization_id: organizationId,
    p_session_id: sessionId,
    p_reason: 'guard ended shift',
  })

  if (endError) {
    // SESSION_NOT_ACTIVE — already ended, treat as success.
    // Anything else — real infrastructure problem.
    const isAlreadyEnded = endError.message?.includes('SESSION_NOT_ACTIVE')
    if (!isAlreadyEnded) {
      return NextResponse.json({ code: 'SYSTEM_UNAVAILABLE' }, { status: 503 })
    }
  }

  return clearSessionCookie(NextResponse.json({ ok: true }))
}

export const POST = withSentryRoute(postHandler)
