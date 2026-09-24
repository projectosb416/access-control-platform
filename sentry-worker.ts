// Custom Cloudflare Worker entry point.
//
// Wraps the OpenNext-generated worker (./.open-next/worker.js, produced by
// `npm run build:worker`) with Sentry instrumentation. Wrangler deploys
// this file instead of the OpenNext output directly — see wrangler.jsonc.
//
// Why this shape: @sentry/cloudflare wraps Workers at the handler level
// because Workers are stateless. There is no module-level init. The DSN
// comes from the per-request env object, not process.env.
//
// If SENTRY_DSN is not set (local dev, or a deploy without the secret),
// the options callback returns undefined and Sentry no-ops cleanly.

import * as Sentry from '@sentry/cloudflare'
import openNextWorker from './.open-next/worker.js'

interface Env {
  SENTRY_DSN?: string
}

export default Sentry.withSentry(
  (env: Env) => {
    if (!env.SENTRY_DSN) return undefined
    return {
      dsn: env.SENTRY_DSN,
      tracesSampleRate: 0.1,
    }
  },
  {
    async fetch(
      request: Request,
      env: Env,
      ctx: ExecutionContext,
    ): Promise<Response> {
      return (openNextWorker as { fetch: typeof fetch }).fetch(request, env, ctx)
    },
  },
)
