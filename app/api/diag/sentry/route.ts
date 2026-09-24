import { withSentryRoute } from '@/lib/sentry/route-wrapper'

export const runtime = 'nodejs'

export const GET = withSentryRoute(async () => {
  throw new Error('Sentinel test error — Phase 8.5 Sentry verification')
})
