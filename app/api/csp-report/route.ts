import { NextResponse, type NextRequest } from 'next/server'

/**
 * CSP violation report receiver.
 *
 * Browsers POST here when Content-Security-Policy-Report-Only (or the
 * enforcing variant) blocks a resource. During observation the policy
 * is report-only — nothing is blocked, we just collect signal.
 *
 * Two payload shapes are accepted:
 *
 *   Legacy (report-uri directive — still the widely supported one):
 *     { "csp-report": { "blocked-uri": "...", "violated-directive": "...", ... } }
 *
 *   Modern (report-to directive, Reporting API v1):
 *     [ { "type": "csp-violation", "body": { ... } } ]
 *
 * Reports are logged to Cloudflare Worker logs as structured JSON.
 * No DB persistence — this is observation only. The report log lives
 * for the retention window of Workers Logs (~3 days on free tier).
 *
 * Returns 204 always, even on malformed input. Report endpoints must
 * never surface errors to the browser — a failed report would trigger
 * the browser to retry, which multiplies noise.
 */

export const runtime = 'nodejs'

const MAX_BODY_BYTES = 10_000

export async function POST(request: NextRequest) {
  try {
    const text = await request.text()
    if (!text || text.length > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 204 })
    }

    const parsed = JSON.parse(text) as unknown
    const reports: unknown[] = Array.isArray(parsed) ? parsed : [parsed]

    for (const item of reports) {
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>

      // Legacy wraps in 'csp-report'; modern wraps in 'body'.
      const body =
        (obj['csp-report'] as Record<string, unknown> | undefined) ??
        (obj['body'] as Record<string, unknown> | undefined) ??
        obj

      // Extract just the path from document-uri, not the full URL —
      // keeps logs compact and avoids accidentally logging query strings.
      const docUrl = String(
        body['document-uri'] ?? body['documentURL'] ?? '',
      )
      let docPath = ''
      try {
        docPath = new URL(docUrl).pathname
      } catch {
        docPath = docUrl
      }

      const summary = {
        blocked: String(body['blocked-uri'] ?? body['blockedURL'] ?? ''),
        directive: String(
          body['violated-directive'] ?? body['effectiveDirective'] ?? '',
        ),
        document: docPath,
        source: String(body['source-file'] ?? body['sourceFile'] ?? ''),
        line: body['line-number'] ?? body['lineNumber'] ?? null,
      }

      console.warn('[CSP-VIOLATION]', JSON.stringify(summary))
    }
  } catch {
    // Malformed report — ignore silently. See endpoint header note.
  }

  return new NextResponse(null, { status: 204 })
}
