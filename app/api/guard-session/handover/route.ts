import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { withSentryRoute } from '@/lib/sentry/route-wrapper'

/**
 * GET /api/guard-session/handover
 *
 * Returns the most recent handover note left by a guard ending a shift
 * at the same gate as the caller's active session. Used by the guard
 * entry page on mount to surface the note from the previous shift.
 *
 * Best-effort. Any failure (no cookie, session already ended, lookup
 * error, RPC error) returns 200 with handover: null. The guard is
 * never blocked by this call.
 *
 * Response:
 *   200 { ok: true, handover: null }
 *   200 { ok: true, handover: { note, ended_at, ended_by_name } }
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

async function getHandler(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ ok: true, handover: null })
  }

  const supabase = createServiceClient()
  const tokenHash = await sha256Hex(token)

  const { data: sessionRows, error: lookupError } = await supabase
    .from('shift_sessions')
    .select('id, shift_id')
    .eq('session_token_hash', tokenHash)
    .eq('status', 'active')
    .limit(1)

  if (lookupError || !sessionRows || sessionRows.length === 0) {
    return NextResponse.json({ ok: true, handover: null })
  }

  const sessionId = sessionRows[0].id as string
  const shiftId = sessionRows[0].shift_id as string

  const { data: shiftRows, error: shiftError } = await supabase
    .from('shifts')
    .select('organization_id')
    .eq('id', shiftId)
    .limit(1)

  if (shiftError || !shiftRows || shiftRows.length === 0) {
    return NextResponse.json({ ok: true, handover: null })
  }

  const organizationId = shiftRows[0].organization_id as string

  const { data: handoverRows, error: handoverError } = await supabase.rpc(
    'latest_gate_handover',
    {
      p_organization_id: organizationId,
      p_session_id: sessionId,
    },
  )

  if (handoverError || !handoverRows || handoverRows.length === 0) {
    return NextResponse.json({ ok: true, handover: null })
  }

  const row = handoverRows[0] as {
    handover_note: string | null
    ended_at: string | null
    ended_by_name: string | null
  }

  if (!row.handover_note) {
    return NextResponse.json({ ok: true, handover: null })
  }

  return NextResponse.json({
    ok: true,
    handover: {
      note: row.handover_note,
      ended_at: row.ended_at,
      ended_by_name: row.ended_by_name,
    },
  })
}

export const GET = withSentryRoute(getHandler)
