import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { withSentryRoute } from '@/lib/sentry/route-wrapper'

/**
 * POST /api/paystack/webhook
 *
 * Receives Paystack webhook events. No session auth — Paystack cannot
 * present a JWT. Authentication is HMAC-SHA512 signature verification
 * on the RAW request body against PAYSTACK_SECRET_KEY.
 *
 * Body shape (charge.success):
 *   {
 *     event: "charge.success" | "charge.failed" | ...,
 *     data: {
 *       reference: "PSK-XXXXXX",
 *       status: "success" | "failed",
 *       amount: <kobo>,
 *       currency: "NGN",
 *       ...
 *     }
 *   }
 *
 * Handled events:
 *   charge.success  -> confirm_paystack_payment(ref, 'succeeded', data)
 *   charge.failed   -> confirm_paystack_payment(ref, 'failed', data)
 *   everything else -> 200, ignored (Paystack retries non-2xx; we do
 *                      not want retry storms for event types we do not
 *                      handle).
 *
 * Return codes:
 *   200 — processed, or ignored, or unknown reference (logged)
 *   401 — missing or invalid signature
 *   500 — PAYSTACK_SECRET_KEY absent (fail loud, same posture as
 *         initiate endpoint)
 *   502 — Paystack body malformed (well-signed but not parseable)
 *
 * Signature: x-paystack-signature header, hex-encoded HMAC-SHA512 of
 * the raw body. Timing-safe comparison.
 *
 * DB writes are service-role. confirm_paystack_payment is SECURITY
 * DEFINER — auth inside is implicit (webhook cannot present a JWT).
 *
 * Idempotency: confirm_paystack_payment returns early on terminal
 * states. A replayed charge.success returns the same subscription id
 * and does not double-write.
 */

export const runtime = 'nodejs'

const SIGNATURE_HEADER = 'x-paystack-signature'

async function hmacSha512Hex(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

interface PaystackEvent {
  event?: unknown
  data?: {
    reference?: unknown
    status?: unknown
    [key: string]: unknown
  }
}

async function postHandler(request: NextRequest) {
  // -------------------------------------------------------------------------
  // 1. Read raw body before any parsing. HMAC is over the raw bytes.
  // -------------------------------------------------------------------------
  let rawBody: string
  try {
    rawBody = await request.text()
  } catch {
    return NextResponse.json({ code: 'INVALID_BODY' }, { status: 400 })
  }

  // -------------------------------------------------------------------------
  // 2. Signature verification.
  // -------------------------------------------------------------------------
  const secretKey = process.env.PAYSTACK_SECRET_KEY
  if (!secretKey) {
    return NextResponse.json({ code: 'SYSTEM_UNAVAILABLE' }, { status: 500 })
  }

  const providedSig = request.headers.get(SIGNATURE_HEADER)
  if (!providedSig) {
    return NextResponse.json({ code: 'SIGNATURE_MISSING' }, { status: 401 })
  }

  let expectedSig: string
  try {
    expectedSig = await hmacSha512Hex(secretKey, rawBody)
  } catch {
    return NextResponse.json({ code: 'SYSTEM_UNAVAILABLE' }, { status: 500 })
  }

  if (!timingSafeEqual(expectedSig, providedSig)) {
    return NextResponse.json({ code: 'SIGNATURE_INVALID' }, { status: 401 })
  }

  // -------------------------------------------------------------------------
  // 3. Parse body (now that signature is confirmed).
  // -------------------------------------------------------------------------
  let payload: PaystackEvent
  try {
    payload = JSON.parse(rawBody) as PaystackEvent
  } catch {
    return NextResponse.json({ code: 'INVALID_BODY' }, { status: 502 })
  }

  const eventName = typeof payload.event === 'string' ? payload.event : ''
  const reference =
    typeof payload.data?.reference === 'string' ? payload.data.reference : ''

  // -------------------------------------------------------------------------
  // 4. Only charge.success and charge.failed are actionable.
  // -------------------------------------------------------------------------
  if (eventName !== 'charge.success' && eventName !== 'charge.failed') {
    return NextResponse.json({ ok: true, ignored: eventName })
  }

  if (!reference) {
    return NextResponse.json({ code: 'REFERENCE_MISSING' }, { status: 502 })
  }

  // -------------------------------------------------------------------------
  // 5. Delegate to confirm_paystack_payment via service client.
  // -------------------------------------------------------------------------
  const statusForDb = eventName === 'charge.success' ? 'succeeded' : 'failed'

  const supabase = createServiceClient()

  const { data: subId, error: confirmError } = await supabase.rpc(
    'confirm_paystack_payment',
    {
      p_provider_reference: reference,
      p_status: statusForDb,
      p_provider_payload: payload.data ?? {},
    },
  )

  if (confirmError) {
    // Unknown reference is not a signature failure; it is a Paystack
    // event we have no local row for. Log-and-200 to avoid retry storms.
    // Everything else is treated as transient — return 500 so Paystack
    // retries.
    if (confirmError.message.includes('PAYMENT_NOT_FOUND')) {
      console.warn(
        '[paystack-webhook] unknown reference',
        JSON.stringify({ reference, event: eventName }),
      )
      return NextResponse.json({ ok: true, note: 'unknown reference' })
    }
    return NextResponse.json({ code: 'SYSTEM_UNAVAILABLE' }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    reference,
    subscription_id: subId ?? null,
  })
}

export const POST = withSentryRoute(postHandler)
