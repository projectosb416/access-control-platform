// Temporary diagnostic — throws a deliberate error so we can confirm Sentry
// captures it in the deployed Worker. Deleted once verified.

export const runtime = 'nodejs'

export async function GET() {
  throw new Error('Sentinel test error — Phase 8.5 Sentry verification')
}
