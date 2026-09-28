import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hashPin, computeLookupKey } from '@/lib/pin/pin'
import { withSentryRoute } from '@/lib/sentry/route-wrapper'

/**
 * POST /api/resident/guest-pin
 *
 * Primary resident generates a guest PIN scoped to their unit.
 *
 * Server-authoritative flow:
 *   1. Session check via Supabase auth cookie (anon client + user JWT)
 *   2. Body typecheck (no business-rule validation — the SQL function owns that)
 *   3. Per-resident rate check (H2: scope_unit_id + created_by, 1h window)
 *   4. Resolve org_id from unit_id via RLS-protected pre-query (B1a)
 *   5. Generate 6-digit PIN (E1 + rejection sampling — no modulo bias)
 *   6. Compute PHC + lookup_key using PIN_PEPPER in the Worker
 *   7. Call public.create_guest_pin_for_unit (SECURITY DEFINER)
 *   8. Return plaintext PIN once — with no-store headers — and never persist it
 *
 * The plaintext PIN appears in this response only. It is never logged, never
 * written to disk, never sent to Postgres. Callers who lose it revoke and
 * regenerate. See docs/phase-7/error-http-mapping.md for code → status.
 *
 * Rate-limit note: C4 — endpoint-level pre-check. When plan entitlements
 * mature (Phase 10/11), migrate this check into rate_limit_attempt as a
 * fourth scope with proper atomicity.
 */

export const runtime = 'nodejs'

const MAX_PINS_PER_HOUR = 20
const RATE_WINDOW_MS = 60 * 60 * 1000

type Body = {
  unit_id?: unknown
  visitor_full_name?: unknown
  visitor_phone?: unknown
  purpose?: unknown
  access_type?: unknown
  authorization_type?: unknown
  valid_from?: unknown
  valid_until?: unknown
  note?: unknown
}

function jsonError(code: string, status: number) {
  return NextResponse.json({ code }, { status })
}

/**
 * Generate a uniformly-distributed 6-digit PIN.
 * Rejection sampling over a 20-bit space (2^20 = 1,048,576) eliminates the
 * modulo bias that `x % 1_000_000` would introduce. Acceptance ~95.4%.
 */
function generateSixDigitPin(): string {
  const buf = new Uint8Array(3)
  while (true) {
    crypto.getRandomValues(buf)
    const v = ((buf[0]! << 16) | (buf[1]! << 8) | buf[2]!) & 0xfffff
    if (v < 1_000_000) return v.toString().padStart(6, '0')
  }
}

/**
 * Body field coercion. Returns:
 *   - the trimmed string when input is a non-empty string
 *   - null when input is null, undefined, or an empty/whitespace string
 *   - undefined when input is present but the wrong type
 */
function asString(v: unknown): string | null | undefined {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : null
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
  // 2. Body typecheck — no business-rule validation here
  // -------------------------------------------------------------------------
  let body: Body
  try {
    body = await request.json()
  } catch {
    return jsonError('INVALID_BODY', 400)
  }

  const unitId            = asString(body.unit_id)
  const visitorFullName   = asString(body.visitor_full_name)
  const visitorPhone      = asString(body.visitor_phone)
  const purpose           = asString(body.purpose)
  const accessType        = asString(body.access_type)
  const authorizationType = asString(body.authorization_type)
  const validFromRaw      = asString(body.valid_from)
  const validUntilRaw     = asString(body.valid_until)
  const note              = asString(body.note)

  if (
    unitId === undefined || visitorFullName === undefined ||
    visitorPhone === undefined || purpose === undefined ||
    accessType === undefined || authorizationType === undefined ||
    validFromRaw === undefined || validUntilRaw === undefined ||
    note === undefined
  ) {
    return jsonError('INVALID_BODY', 400)
  }

  if (
    !unitId || !visitorFullName || !purpose ||
    !accessType || !authorizationType ||
    !validFromRaw || !validUntilRaw
  ) {
    return jsonError('MISSING_REQUIRED_FIELD', 400)
  }

  // Date parsing (type coercion, not validation)
  const validFrom  = new Date(validFromRaw)
  const validUntil = new Date(validUntilRaw)

  if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime())) {
    return jsonError('INVALID_VALIDITY_WINDOW', 400)
  }

  // F3 pre-flight: reject a PIN that is dead on arrival. Not a business rule
  // cap — just avoids creating a useless authorization + audit row.
  if (validUntil.getTime() <= Date.now()) {
    return jsonError('INVALID_VALIDITY_WINDOW', 400)
  }

  // -------------------------------------------------------------------------
  // 3. Resolve caller's accounts.id (rate-check filter + used by RPC internally)
  // -------------------------------------------------------------------------
  const { data: accountRow, error: accountError } = await supabase
    .from('accounts')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (accountError || !accountRow) {
    return jsonError('SYSTEM_UNAVAILABLE', 500)
  }

  const callerAccountId = (accountRow as { id: string }).id

  // -------------------------------------------------------------------------
  // 4. Per-resident rate check (H2)
  // -------------------------------------------------------------------------
  const windowStart = new Date(Date.now() - RATE_WINDOW_MS).toISOString()

  const { count, error: rateError } = await supabase
    .from('authorizations')
    .select('id', { count: 'exact', head: true })
    .eq('scope_unit_id', unitId)
    .eq('created_by', callerAccountId)
    .gt('created_at', windowStart)

  if (rateError) {
    return jsonError('SYSTEM_UNAVAILABLE', 500)
  }

  if ((count ?? 0) >= MAX_PINS_PER_HOUR) {
    return jsonError('RATE_LIMITED', 429)
  }

  // -------------------------------------------------------------------------
  // 5. Resolve org_id from unit_id (B1a)
  // Two simple selects instead of one join: avoids FK-name disambiguation
  // and the Supabase string-select GenericStringError typing gap (§11).
  // -------------------------------------------------------------------------
  const { data: unitRow, error: unitError } = await supabase
    .from('units')
    .select('property_id')
    .eq('id', unitId)
    .maybeSingle()

  if (unitError) {
    return jsonError('SYSTEM_UNAVAILABLE', 500)
  }

  if (!unitRow) {
    return jsonError('UNIT_NOT_FOUND', 404)
  }

  const propertyId = (unitRow as { property_id: string }).property_id

  const { data: propertyRow, error: propertyError } = await supabase
    .from('properties')
    .select('organization_id')
    .eq('id', propertyId)
    .maybeSingle()

  if (propertyError || !propertyRow) {
    return jsonError('SYSTEM_UNAVAILABLE', 500)
  }

  const organizationId = (propertyRow as { organization_id: string }).organization_id

  // -------------------------------------------------------------------------
  // 6. Pepper + PIN + hashing (Worker-side; plaintext never leaves the Worker)
  // -------------------------------------------------------------------------
  const pepper = process.env.PIN_PEPPER
  if (!pepper) {
    return jsonError('SYSTEM_UNAVAILABLE', 500)
  }

  const pin = generateSixDigitPin()

  const { phc } = await hashPin(pin, pepper)
  const lookupKey = await computeLookupKey(pin, organizationId, pepper)

  // -------------------------------------------------------------------------
  // 7. Atomic authorization creation via SECURITY DEFINER function
  // -------------------------------------------------------------------------
  const { data, error } = await supabase.rpc('create_guest_pin_for_unit', {
    p_unit_id:            unitId,
    p_visitor_full_name:  visitorFullName,
    p_visitor_phone:      visitorPhone,
    p_purpose:            purpose,
    p_authorization_type: authorizationType,
    p_valid_from:         validFrom.toISOString(),
    p_valid_until:        validUntil.toISOString(),
    p_credential:         phc,
    p_lookup_key:         lookupKey,
    p_access_type:        accessType,
    p_note:               note,
    // p_pepper_version defaults to 'v1'
  })

  if (error) {
    const code = extractDbErrorCode(error.message)
    return jsonError(code, statusForCode(code))
  }

  if (!data || data.length === 0) {
    return jsonError('SYSTEM_UNAVAILABLE', 500)
  }

  const result = data[0] as {
    authorization_id: string
    credential_id: string
    person_id: string
  }

  // -------------------------------------------------------------------------
  // 8. Success — plaintext PIN returned once. Cache-Control prevents any
  //    intermediary from holding it; Vary: Cookie prevents cross-account
  //    cache collisions on shared edge.
  //    DO NOT log the plaintext PIN anywhere in this or downstream code.
  // -------------------------------------------------------------------------
  return NextResponse.json(
    {
      authorization_id: result.authorization_id,
      credential_id:    result.credential_id,
      pin,
    },
    {
      status: 201,
      headers: {
        'Cache-Control': 'no-store, private',
        'Vary': 'Cookie',
      },
    },
  )
}

// ---------------------------------------------------------------------------
// Error mapping (docs/phase-7/error-http-mapping.md)
// Codes reachable from create_guest_pin_for_unit (0050) and the delegated
// create_authorization_with_credential (0027).
// ---------------------------------------------------------------------------

const KNOWN_CODES = [
  'NOT_AUTHENTICATED',
  'NOT_AUTHORIZED',
  'SUBSCRIPTION_INACTIVE',
  'UNIT_NOT_FOUND',
  'UNIT_NOT_ACTIVE',
  'FULL_NAME_REQUIRED',
  'PURPOSE_REQUIRED',
  'INVALID_ACCESS_TYPE',
  'INVALID_AUTHORIZATION_TYPE',
  'INVALID_VALIDITY_WINDOW',
  'PIN_COLLISION',
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
    case 'SUBSCRIPTION_INACTIVE':
      return 402
    case 'NOT_AUTHORIZED':
      return 403
    case 'UNIT_NOT_FOUND':
      return 404
    case 'UNIT_NOT_ACTIVE':
    case 'PIN_COLLISION':
      return 409
    case 'FULL_NAME_REQUIRED':
    case 'PURPOSE_REQUIRED':
    case 'INVALID_ACCESS_TYPE':
    case 'INVALID_AUTHORIZATION_TYPE':
    case 'INVALID_VALIDITY_WINDOW':
      return 400
    case 'RATE_LIMITED':
      return 429
    default:
      return 500
  }
}

export const POST = withSentryRoute(postHandler)
