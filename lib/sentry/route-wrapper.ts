import 'server-only'

import * as Sentry from '@sentry/cloudflare'

/**
 * Wrap a Next.js route handler so thrown exceptions reach Sentry.
 *
 * Route handlers that let exceptions propagate get an error page from
 * Next.js — the exception is swallowed before it reaches the Worker's
 * fetch wrapper, so withSentry never sees it. This wrapper captures the
 * exception first, then re-throws so Next.js still produces the 500.
 *
 * Usage:
 *   export const GET = withSentryRoute(async (request) => { ... })
 */
export function withSentryRoute<T extends (...args: never[]) => Promise<Response>>(
  handler: T,
): T {
  return (async (...args: Parameters<T>): Promise<Response> => {
    try {
      return await handler(...args)
    } catch (err) {
      Sentry.captureException(err)
      throw err
    }
  }) as T
}
