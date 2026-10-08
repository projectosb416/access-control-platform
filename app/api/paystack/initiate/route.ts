import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { withSentryRoute } from '@/lib/sentry/route-wrapper'

/**
 * POST /api/paystack/initiate
 *
 * Org admin starts a Paystack payment for a plan. Shape B (local-first):
 *   1. Calls record_paystack_payment_intent — creates a local
 *      payment_transactions row, status='initiated', provider='paystack',
 *      reference PSK-XXXXXX.
 *   2. Calls Paystack /transaction/initialize with that reference,
 *      the org admin's email, the plan amount (kobo), and the callback
 *      URL.
 *   3. Returns the Paystack authorization_url; the client redirects the
 *      browser there.
 *
 * The webhook (Step 8) later finds the row by reference and flips it to
 * a terminal status. Payment is visible on the platform dashboard from
 * the moment this endpoint returns — no phantom state.
 *
 * Failure handling on the Paystack call: the local row stays
 * 'initiated'. Not marked failed. The customer may retry; the row
 * remains traceable on the dashboard. Follow-up hardening.
 *
 * Auth: session client (anon key + user JWT). The RPC calls
 * current_account_id() and is_org_admin(), both of which need the
 * caller's JWT.
 *
 * Env: PAYSTACK_SECRET_KEY — Worker secret set by CI workflow. Absent
 * on first deploy; the endpoint returns 502 until the secret is set.
 * That is intentional: fail loud.
 *
 * Request:  { organization_id, plan_id, purpose?: 'initial'|'renewal'|'upgrade' }
 * Response: 200 { authorization_url, reference }
 *           400 INVALID_BODY | MISSING_REQUIRED_FIELD
 *           401 NOT_AUTHENTICATED
 *           403 NOT_ORG_ADMIN
 *           404 PLAN_NOT_AVAILABLE
 *           400 INVALID_PURPOSE
 *           502 PAYSTACK_INIT_FAILED
 *           500 SYSTEM_UNAVAILABLE
 */

export const runtime = 'nodejs'

const PAYSTACK_INIT_URL = 'https://api.paystack.co/transaction/initialize'

type Body = {
  organization_id?: unknown
  plan_id?: unknown
  purpose?: unknown
}

function jsonError(code: string, status: number) {
  return NextResponse.json({ code }, { status })
}

async function postHandler(request: NextRequest) {
  // -------------------------------------------------------------------------
  // 1. Session — org admin must be authenticated
  // -------------------------------------------------------------------------
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return jsonError('NOT_AUTHENTICATED', 401)
  }

  if (!user.email) {
    // Users created via invite flows always have an email. Missing email
    // would mean a malformed auth record — treat as unavailable.
    return jsonError('SYSTEM_UNAVAILABLE', 500)
  }

  // -------------------------------------------------------------------------
  // 2. Body typecheck
  // -------------------------------------------------------------------------
  let body: Body
  try {
    body = await request.json()
  } catch {
    return jsonError('INVALID_BODY', 400)
  }

  const organizationId =
    typeof body.organization_id === 'string' ? body.organization_id.trim() : ''
  const planId =
    typeof body.plan_id === 'string' ? body.plan_id.trim() : ''
  const purpose =
    typeof body.purpose === 'string' && body.purpose.trim().length > 0
      ? body.purpose.trim()
      : 'initial'

  if (!organizationId || !planId) {
    return jsonError('MISSING_REQUIRED_FIELD', 400)
  }

  // -------------------------------------------------------------------------
  // 3. Create the local intent row via the RPC (migration 0070)
  // -------------------------------------------------------------------------
  const { data: intentData, error: intentError } = await supabase.rpc(
    'record_paystack_payment_intent',
    {
      p_organization_id: organizationId,
      p_plan_id: planId,
      p_purpose: purpose,
    },
  )

  if (intentError) {
    const code = extractDbErrorCode(intentError.message)
    return jsonError(code, statusForCode(code))
  }

  const row = Array.isArray(intentData) ? intentData[0] : intentData

  if (
    !row ||
    typeof row.payment_id !== 'string' ||
    typeof row.reference !== 'string' ||
    typeof row.amount_minor_units !== 'number' ||
    typeof row.currency !== 'string'
  ) {
    return jsonError('SYSTEM_UNAVAILABLE', 500)
  }

  // -------------------------------------------------------------------------
  // 4. Pepper-style secret read. Missing → fail loud, not silent.
  // -------------------------------------------------------------------------
  const secretKey = process.env.PAYSTACK_SECRET_KEY
  if (!secretKey) {
    return jsonError('SYSTEM_UNAVAILABLE', 500)
  }

  // -------------------------------------------------------------------------
  // 5. Build the callback URL. Cosmetic — webhook does the state transition.
  // -------------------------------------------------------------------------
  const origin = new URL(request.url).origin
  const callbackUrl = `${origin}/admin/billing?payment=processing&ref=${encodeURIComponent(row.reference)}`

  // -------------------------------------------------------------------------
  // 6. Call Paystack /transaction/initialize
  // -------------------------------------------------------------------------
  let paystackRes: Response
  try {
    paystackRes = await fetch(PAYSTACK_INIT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: user.email,
        amount: row.amount_minor_units, // already in kobo
        reference: row.reference,
        callback_url: callbackUrl,
        metadata: {
          payment_id: row.payment_id,
          organization_id: organizationId,
          plan_id: planId,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return jsonError('PAYSTACK_INIT_FAILED', 502)
  }

  if (!paystackRes.ok) {
    return jsonError('PAYSTACK_INIT_FAILED', 502)
  }

  let paystackBody: {
    status?: boolean
    message?: string
    data?: { authorization_url?: string; access_code?: string; reference?: string }
  }
  try {
    paystackBody = await paystackRes.json()
  } catch {
    return jsonError('PAYSTACK_INIT_FAILED', 502)
  }

  if (!paystackBody.status || !paystackBody.data?.authorization_url) {
    return jsonError('PAYSTACK_INIT_FAILED', 502)
  }

  // Reference echo check — the webhook matches our row by reference.
  // If Paystack echoed a different one, the flow would break silently
  // (local row stays 'initiated' forever, no webhook match).
  if (paystackBody.data.reference !== row.reference) {
    return jsonError('PAYSTACK_INIT_FAILED', 502)
  }

  // -------------------------------------------------------------------------
  // 7. Success
  // -------------------------------------------------------------------------
  return NextResponse.json({
    authorization_url: paystackBody.data.authorization_url,
    reference: row.reference,
  })
}

// ---------------------------------------------------------------------------
// Error mapping — codes reachable from record_paystack_payment_intent
// (migration 0070) plus the endpoint-specific PAYSTACK_INIT_FAILED.
// ---------------------------------------------------------------------------

const KNOWN_CODES = [
  'NOT_AUTHENTICATED',
  'NOT_ORG_ADMIN',
  'INVALID_PURPOSE',
  'PLAN_NOT_AVAILABLE',
  'PAYMENT_NOT_FOUND',
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
    case 'NOT_ORG_ADMIN':
      return 403
    case 'PLAN_NOT_AVAILABLE':
      return 404
    case 'INVALID_PURPOSE':
      return 400
    case 'PAYMENT_NOT_FOUND':
      return 404
    case 'PAYSTACK_INIT_FAILED':
      return 502
    default:
      return 500
  }
}

export const POST = withSentryRoute(postHandler)
