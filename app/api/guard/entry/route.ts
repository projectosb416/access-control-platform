import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { computeLookupKey, verifyPinAgainstPhc } from '@/lib/pin/pin'

/**
 * POST /api/guard/entry
 *
 * The guard processes an ENTRY. Middleware has already:
 *   - validated the shift session cookie
 *   - attached x-shift-session-id, x-guard-profile-id, x-gate-id, x-organization-id
 *
 * Body:
 *   { pin: string, idempotency_key?: string }
 *
 * Response: always 200 with a result_code, sound, visual, and optional
 * person_name. Real errors (malformed body, missing headers, DB failure)
 * return 4xx/5xx per docs/phase-7/error-http-mapping.md.
 *
 * See docs/phase-7/guard-auth-model.md and idempotency-keys.md.
 */

export const runtime = 'nodejs'

const PIN_LENGTH = 6
const PIN_REGEX = /^[0-9]{6}$/
const MAX_IDEMPOTENCY_KEY_LENGTH = 200

// Rate limit policy per scope (see docs/phase-7/guard-auth-model.md §5)
const GATE_LIMIT    = { window: 60, max: 50, lockout: 60 }
const GUARD_LIMIT   = { window: 60, max: 30, lockout: 60 }
const CRED_LIMIT    = { window: 60, max: 10, lockout: 300 }

type Sound = 'success' | 'error' | 'warning'
type Visual = 'green' | 'red' | 'amber'

interface ResultPresentation {
  sound: Sound
  visual: Visual
}

const PRESENTATION: Record<string, ResultPresentation> = {
  GRANTED:                  { sound: 'success', visual: 'green' },
  DENIED:                   { sound: 'error',   visual: 'red' },
  INVALID_PIN:              { sound: 'error',   visual: 'red' },
  EXPIRED_AUTHORIZATION:    { sound: 'error',   visual: 'amber' },
  REVOKED_AUTHORIZATION:    { sound: 'error',   visual: 'red' },
  NO_ACTIVE_SESSION:        { sound: 'warning', visual: 'amber' },
  ONE_TIME_ALREADY_CONSUMED:{ sound: 'error',   visual: 'red' },
  UNRESOLVED_VISIT:         { sound: 'warning', visual: 'amber' },
  RATE_LIMITED:             { sound: 'warning', visual: 'amber' },
  GATE_INACTIVE:            { sound: 'error',   visual: 'red' },
  GUARD_NOT_ON_ACTIVE_SHIFT:{ sound: 'error',   visual: 'red' },
  SYSTEM_UNAVAILABLE:       { sound: 'error',   visual: 'red' },
}

function presentation(code: string): ResultPresentation {
  return PRESENTATION[code] ?? { sound: 'error', visual: 'red' }
}

function jsonError(code: string, status: number) {
  return NextResponse.json({ code }, { status })
}

export async function POST(request: NextRequest) {
  // -------------------------------------------------------------------------
  // 1. Session context from middleware
  // -------------------------------------------------------------------------
  const shiftSessionId = request.headers.get('x-shift-session-id')
  const guardProfileId = request.headers.get('x-guard-profile-id')
  const gateId         = request.headers.get('x-gate-id')
  const organizationId = request.headers.get('x-organization-id')

  if (!shiftSessionId || !guardProfileId || !gateId || !organizationId) {
    return jsonError('SHIFT_SESSION_REQUIRED', 401)
  }

  // -------------------------------------------------------------------------
  // 2. Parse and validate body
  // -------------------------------------------------------------------------
  let body: { pin?: unknown; idempotency_key?: unknown }
  try {
    body = await request.json()
  } catch {
    return jsonError('INVALID_BODY', 400)
  }

  const pin = typeof body.pin === 'string' ? body.pin : ''
  const idemKey =
    typeof body.idempotency_key === 'string' ? body.idempotency_key : null

  if (!PIN_REGEX.test(pin)) {
    return jsonError('INVALID_PIN_FORMAT', 400)
  }

  if (idemKey !== null && idemKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return jsonError('INVALID_IDEMPOTENCY_KEY', 400)
  }

  const supabase = createServiceClient()

  // -------------------------------------------------------------------------
  // 3. Idempotency — cheapest check, before any state change
  // -------------------------------------------------------------------------
  if (idemKey) {
    const { data: prior, error } = await supabase.rpc('find_event_by_idempotency', {
      p_organization_id: organizationId,
      p_idempotency_key: idemKey,
    })

    if (error) {
      return jsonError('SYSTEM_UNAVAILABLE', 503)
    }

    if (prior && prior.length > 0) {
      const r = prior[0]
      const p = presentation(r.result_code)
      return NextResponse.json({
        result_code: r.result_code,
        access_event_id: r.access_event_id,
        access_session_id: r.access_session_id,
        reason: r.reason,
        direction: 'entry',
        sound: p.sound,
        visual: p.visual,
        replayed: true,
      })
    }
  }

  // -------------------------------------------------------------------------
  // 4. Rate limits — gate, then guard (both known from session context)
  // -------------------------------------------------------------------------
  const { data: gateLimit } = await supabase.rpc('rate_limit_attempt', {
    p_scope_type: 'gate',
    p_scope_id: gateId,
    p_window_seconds: GATE_LIMIT.window,
    p_max_attempts: GATE_LIMIT.max,
    p_lockout_seconds: GATE_LIMIT.lockout,
    p_bucket_seconds: 10,
  })

  if (gateLimit && !gateLimit[0].allowed) {
    return handleRateLimited(
      supabase, organizationId, gateId, guardProfileId, shiftSessionId, idemKey,
    )
  }

  const { data: guardLimit } = await supabase.rpc('rate_limit_attempt', {
    p_scope_type: 'guard',
    p_scope_id: guardProfileId,
    p_window_seconds: GUARD_LIMIT.window,
    p_max_attempts: GUARD_LIMIT.max,
    p_lockout_seconds: GUARD_LIMIT.lockout,
    p_bucket_seconds: 10,
  })

  if (guardLimit && !guardLimit[0].allowed) {
    return handleRateLimited(
      supabase, organizationId, gateId, guardProfileId, shiftSessionId, idemKey,
    )
  }

  // -------------------------------------------------------------------------
  // 5. PIN lookup
  // -------------------------------------------------------------------------
  const pepper = process.env.PIN_PEPPER
  if (!pepper) {
    return jsonError('SYSTEM_UNAVAILABLE', 503)
  }

  const lookupKey = await computeLookupKey(pin, organizationId, pepper)

  const { data: credentials, error: credError } = await supabase
    .from('access_credentials')
    .select('id, credential, status')
    .eq('organization_id', organizationId)
    .eq('lookup_key', lookupKey)
    .in('status', ['created', 'active', 'in_use'])
    .limit(1)

  if (credError) {
    return jsonError('SYSTEM_UNAVAILABLE', 503)
  }

  if (!credentials || credentials.length === 0) {
    // No credential matches this PIN in this org.
    const eventId = await logAppEvent(
      supabase, organizationId, gateId, guardProfileId, shiftSessionId, idemKey,
      'INVALID_PIN', 'credential not found',
    )
    const p = presentation('INVALID_PIN')
    return NextResponse.json({
      result_code: 'INVALID_PIN',
      access_event_id: eventId,
      access_session_id: null,
      reason: 'credential not found',
      direction: 'entry',
      sound: p.sound,
      visual: p.visual,
    })
  }

  const credential = credentials[0]

  // -------------------------------------------------------------------------
  // 6. Credential-scope rate limit (only now that we have the credential id)
  // -------------------------------------------------------------------------
  const { data: credLimit } = await supabase.rpc('rate_limit_attempt', {
    p_scope_type: 'credential',
    p_scope_id: credential.id,
    p_window_seconds: CRED_LIMIT.window,
    p_max_attempts: CRED_LIMIT.max,
    p_lockout_seconds: CRED_LIMIT.lockout,
    p_bucket_seconds: 10,
  })

  if (credLimit && !credLimit[0].allowed) {
    return handleRateLimited(
      supabase, organizationId, gateId, guardProfileId, shiftSessionId, idemKey,
    )
  }

  // -------------------------------------------------------------------------
  // 7. Verify PIN against the stored PHC
  // -------------------------------------------------------------------------
  let pinMatches: boolean
  try {
    pinMatches = await verifyPinAgainstPhc(pin, credential.credential, pepper)
  } catch {
    return jsonError('SYSTEM_UNAVAILABLE', 503)
  }

  if (!pinMatches) {
    // credential exists (lookup_key matched) but the PBKDF2 hash did not.
    // Possible only if the PIN was rotated between lookup and verify — rare.
    const eventId = await logAppEvent(
      supabase, organizationId, gateId, guardProfileId, shiftSessionId, idemKey,
      'INVALID_PIN', 'pin mismatch',
    )
    const p = presentation('INVALID_PIN')
    return NextResponse.json({
      result_code: 'INVALID_PIN',
      access_event_id: eventId,
      access_session_id: null,
      reason: 'pin mismatch',
      direction: 'entry',
      sound: p.sound,
      visual: p.visual,
    })
  }

  // -------------------------------------------------------------------------
  // 8. Decision — evaluate_entry does all state validation
  // -------------------------------------------------------------------------
  const { data: decision, error: decisionError } = await supabase.rpc('evaluate_entry', {
    p_organization_id: organizationId,
    p_credential_id: credential.id,
    p_gate_id: gateId,
    p_guard_profile_id: guardProfileId,
    p_idempotency_key: idemKey,
  })

  if (decisionError || !decision || decision.length === 0) {
    return jsonError('SYSTEM_UNAVAILABLE', 503)
  }

  const d = decision[0]
  const p = presentation(d.result_code)

  return NextResponse.json({
    result_code: d.result_code,
    access_event_id: d.access_event_id,
    access_session_id: d.access_session_id,
    reason: d.reason,
    direction: 'entry',
    sound: p.sound,
    visual: p.visual,
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function handleRateLimited(
  supabase: ReturnType<typeof createServiceClient>,
  organizationId: string,
  gateId: string,
  guardProfileId: string,
  shiftSessionId: string,
  idemKey: string | null,
) {
  const eventId = await logAppEvent(
    supabase, organizationId, gateId, guardProfileId, shiftSessionId, idemKey,
    'RATE_LIMITED', 'too many attempts',
  )
  const p = presentation('RATE_LIMITED')
  return NextResponse.json({
    result_code: 'RATE_LIMITED',
    access_event_id: eventId,
    access_session_id: null,
    reason: 'too many attempts',
    direction: 'entry',
    sound: p.sound,
    visual: p.visual,
  })
}

async function logAppEvent(
  supabase: ReturnType<typeof createServiceClient>,
  organizationId: string,
  gateId: string,
  guardProfileId: string,
  shiftSessionId: string,
  idemKey: string | null,
  resultCode: string,
  reason: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('log_access_event', {
    p_organization_id: organizationId,
    p_direction: 'entry',
    p_result_code: resultCode,
    p_reason: reason,
    p_authorization_id: null,
    p_credential_id: null,
    p_person_id: null,
    p_gate_id: gateId,
    p_guard_profile_id: guardProfileId,
    p_shift_session_id: shiftSessionId,
    p_access_session_id: null,
    p_idempotency_key: idemKey,
    p_metadata: {},
  })
  if (error || !data) return null
  return data as string
}
