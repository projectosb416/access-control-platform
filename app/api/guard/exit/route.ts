import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { computeLookupKey, verifyPinAgainstPhc } from '@/lib/pin/pin'
import { withSentryRoute } from '@/lib/sentry/route-wrapper'

/**
 * POST /api/guard/exit
 *
 * Guard processes an EXIT. Middleware has already validated the shift
 * session cookie and attached x-shift-* headers. Mirrors /api/guard/entry
 * except for two differences:
 *
 *   1. Calls evaluate_exit instead of evaluate_entry.
 *   2. Skips the credential rate-limit scope. A lockout on a credential
 *      must never trap a visitor inside the property. Gate and guard
 *      scopes still apply (protect against misuse of the guard device).
 *
 * Body: { pin: string, idempotency_key?: string }
 * Response: always 200 with a result_code on business outcomes.
 *   401 — session missing or expired (middleware)
 *   503 — infrastructure failure
 *
 * See docs/phase-7/guard-auth-model.md, docs/phase-8/operational-states.md.
 */

export const runtime = 'nodejs'

const PIN_REGEX = /^[0-9]{6}$/
const MAX_IDEMPOTENCY_KEY_LENGTH = 200

async function postHandler(request: NextRequest) {
  // ---------------------------------------------------------------------------
  // 1. Session context from middleware
  // ---------------------------------------------------------------------------
  const shiftSessionId = request.headers.get('x-shift-session-id')
  const guardProfileId = request.headers.get('x-guard-profile-id')
  const gateId          = request.headers.get('x-gate-id')
  const organizationId  = request.headers.get('x-organization-id')

  if (!shiftSessionId || !guardProfileId || !gateId || !organizationId) {
    return NextResponse.json({ code: 'SHIFT_SESSION_REQUIRED' }, { status: 401 })
  }

  // ---------------------------------------------------------------------------
  // 2. Parse and validate body
  // ---------------------------------------------------------------------------
  let body: { pin?: unknown; idempotency_key?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ code: 'INVALID_BODY' }, { status: 400 })
  }

  const pin = typeof body.pin === 'string' ? body.pin : ''
  const idemKey =
    typeof body.idempotency_key === 'string' ? body.idempotency_key : null

  if (!PIN_REGEX.test(pin)) {
    return NextResponse.json({ code: 'INVALID_PIN_FORMAT' }, { status: 400 })
  }

  if (idemKey !== null && idemKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return NextResponse.json(
      { code: 'INVALID_IDEMPOTENCY_KEY' },
      { status: 400 },
    )
  }

  const supabase = createServiceClient()

  // ---------------------------------------------------------------------------
  // 3. Idempotency — cheapest check, before any state change
  // ---------------------------------------------------------------------------
  if (idemKey) {
    const { data: prior, error } = await supabase.rpc(
      'find_event_by_idempotency',
      {
        p_organization_id: organizationId,
        p_idempotency_key: idemKey,
      },
    )

    if (error) {
      return NextResponse.json({ code: 'SYSTEM_UNAVAILABLE' }, { status: 503 })
    }

    if (prior && prior.length > 0) {
      const r = prior[0]
      return NextResponse.json({
        result_code: r.result_code,
        access_event_id: r.access_event_id,
        access_session_id: r.access_session_id,
        reason: r.reason,
        direction: 'exit',
        replayed: true,
      })
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Rate limits — gate and guard only. Credential scope is deliberately
  //    skipped so a credential lockout cannot trap a visitor inside.
  // ---------------------------------------------------------------------------
  const { data: gateLimit } = await supabase.rpc('rate_limit_attempt_for_org', {
    p_organization_id: organizationId,
    p_scope_type: 'gate',
    p_scope_id: gateId,
    p_bucket_seconds: 10,
  })

  if (gateLimit && !gateLimit[0].allowed) {
    return handleRateLimited(
      supabase,
      organizationId,
      gateId,
      guardProfileId,
      shiftSessionId,
      idemKey,
    )
  }

  const { data: guardLimit } = await supabase.rpc(
    'rate_limit_attempt_for_org',
    {
      p_organization_id: organizationId,
      p_scope_type: 'guard',
      p_scope_id: guardProfileId,
      p_bucket_seconds: 10,
    },
  )

  if (guardLimit && !guardLimit[0].allowed) {
    return handleRateLimited(
      supabase,
      organizationId,
      gateId,
      guardProfileId,
      shiftSessionId,
      idemKey,
    )
  }

  // ---------------------------------------------------------------------------
  // 5. PIN lookup
  // ---------------------------------------------------------------------------
  const pepper = process.env.PIN_PEPPER
  if (!pepper) {
    return NextResponse.json({ code: 'SYSTEM_UNAVAILABLE' }, { status: 503 })
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
    return NextResponse.json({ code: 'SYSTEM_UNAVAILABLE' }, { status: 503 })
  }

  if (!credentials || credentials.length === 0) {
    const eventId = await logAppEvent(
      supabase,
      organizationId,
      'exit',
      gateId,
      guardProfileId,
      shiftSessionId,
      idemKey,
      'INVALID_PIN',
      'credential not found',
    )
    return NextResponse.json({
      result_code: 'INVALID_PIN',
      access_event_id: eventId,
      access_session_id: null,
      reason: 'credential not found',
      direction: 'exit',
    })
  }

  const credential = credentials[0]

  // ---------------------------------------------------------------------------
  // 6. Verify PIN against the stored PHC
  // ---------------------------------------------------------------------------
  let pinMatches: boolean
  try {
    pinMatches = await verifyPinAgainstPhc(pin, credential.credential, pepper)
  } catch {
    return NextResponse.json({ code: 'SYSTEM_UNAVAILABLE' }, { status: 503 })
  }

  if (!pinMatches) {
    const eventId = await logAppEvent(
      supabase,
      organizationId,
      'exit',
      gateId,
      guardProfileId,
      shiftSessionId,
      idemKey,
      'INVALID_PIN',
      'pin mismatch',
    )
    return NextResponse.json({
      result_code: 'INVALID_PIN',
      access_event_id: eventId,
      access_session_id: null,
      reason: 'pin mismatch',
      direction: 'exit',
    })
  }

  // ---------------------------------------------------------------------------
  // 7. Decision — evaluate_exit handles all state validation
  // ---------------------------------------------------------------------------
  const { data: decision, error: decisionError } = await supabase.rpc(
    'evaluate_exit',
    {
      p_organization_id: organizationId,
      p_credential_id: credential.id,
      p_gate_id: gateId,
      p_guard_profile_id: guardProfileId,
      p_idempotency_key: idemKey,
    },
  )

  if (decisionError || !decision || decision.length === 0) {
    return NextResponse.json({ code: 'SYSTEM_UNAVAILABLE' }, { status: 503 })
  }

  const d = decision[0]

  return NextResponse.json({
    result_code: d.result_code,
    access_event_id: d.access_event_id,
    access_session_id: d.access_session_id,
    reason: d.reason,
    direction: 'exit',
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
    supabase,
    organizationId,
    'exit',
    gateId,
    guardProfileId,
    shiftSessionId,
    idemKey,
    'RATE_LIMITED',
    'too many attempts',
  )
  return NextResponse.json({
    result_code: 'RATE_LIMITED',
    access_event_id: eventId,
    access_session_id: null,
    reason: 'too many attempts',
    direction: 'exit',
  })
}

async function logAppEvent(
  supabase: ReturnType<typeof createServiceClient>,
  organizationId: string,
  direction: 'entry' | 'exit',
  gateId: string,
  guardProfileId: string,
  shiftSessionId: string,
  idemKey: string | null,
  resultCode: string,
  reason: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('log_access_event', {
    p_organization_id: organizationId,
    p_direction: direction,
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

export const POST = withSentryRoute(postHandler)
