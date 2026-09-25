// Custom Cloudflare Worker entry point.
//
// Wraps the OpenNext-generated worker (./.open-next/worker.js, produced by
// `npm run build:worker`) with Sentry instrumentation. Wrangler deploys
// this file instead of the OpenNext output directly — see wrangler.jsonc.
//
// Scrubbing policy — see beforeSend below. Two layers:
//   1. event.request.data is always replaced with "[REDACTED]". Route
//      handlers receive PINs in their request body; no scenario justifies
//      sending that to Sentry.
//   2. Every other field is deep-walked. Any key whose name matches a
//      secret-like pattern is redacted, at any nesting depth.
//
// The scrubbing policy is defensive: it applies regardless of whether our
// own code accidentally includes a secret in a captured context.

import * as Sentry from '@sentry/cloudflare'
import openNextWorker from './.open-next/worker.js'

interface Env {
  SENTRY_DSN?: string
}

// Case-insensitive patterns. If a key matches any pattern, its value is
// redacted before the event leaves the Worker.
const REDACT_PATTERNS: RegExp[] = [
  /pin/i,
  /password/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /secret/i,
  /credential/i,
  /pepper/i,
  /api[_-]?key/i,
]

function shouldRedactKey(key: string): boolean {
  return REDACT_PATTERNS.some((p) => p.test(key))
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 20) return '[TRUNCATED]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1))
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = shouldRedactKey(k) ? '[REDACTED]' : scrubValue(v, depth + 1)
    }
    return out
  }
  return value
}

function beforeSend(event: Sentry.Event): Sentry.Event {
  // Layer 1: strip the raw request body. This is where PINs live.
  if (event.request) {
    if (event.request.data !== undefined) {
      event.request.data = '[REDACTED]'
    }
    if (event.request.cookies !== undefined) {
      event.request.cookies = '[REDACTED]'
    }
    if (event.request.headers !== undefined) {
      event.request.headers = scrubValue(event.request.headers) as Record<
        string,
        string
      >
    }
  }

  // Layer 2: deep-walk the entire event. Redacts any nested key matching
  // the patterns above — including event.extra, event.contexts, breadcrumbs.
  return scrubValue(event) as Sentry.Event
}

export default Sentry.withSentry(
  (env: Env) => {
    if (!env.SENTRY_DSN) return undefined
    return {
      dsn: env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      // Belt-and-braces: disable Sentry's default PII capture. Our beforeSend
      // handles the specific cases, but this turns off a whole class of
      // default behaviors we don't want.
      sendDefaultPii: false,
      beforeSend,
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
