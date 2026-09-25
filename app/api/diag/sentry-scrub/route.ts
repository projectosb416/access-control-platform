import { withSentryRoute } from '@/lib/sentry/route-wrapper'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Temporary diagnostic. Accepts a POST with a body shaped like a real
// guard ENTRY request, then throws. Used to verify the sentry-worker.ts
// beforeSend scrub actually removes the PIN from the captured event.
//
// Deleted once verification is confirmed.

export const POST = withSentryRoute(async (request: Request) => {
  // Read the body so it lands in the request context Sentry would capture.
  const body = await request.json().catch(() => ({}))

  // Throw deliberately — this is what Sentry should capture.
  throw new Error(
    `Scrub verification — received body keys: ${Object.keys(body).join(',')}`,
  )
})

export const GET = withSentryRoute(async () => {
  return NextResponse.json({ status: 'scrub-test endpoint active' })
})
