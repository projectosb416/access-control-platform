import type { NextConfig } from 'next'

/**
 * Security headers applied to every route.
 *
 * Rationale per header:
 *   X-Frame-Options: DENY
 *     Prevents the app from being embedded in an iframe — blocks
 *     clickjacking. Upgrades the previous SAMEORIGIN behavior, which
 *     still allowed same-origin embedding. We never legitimately embed
 *     ourselves, so DENY is correct.
 *   X-Content-Type-Options: nosniff
 *     Prevents browsers from MIME-sniffing a response away from the
 *     declared Content-Type. Cheap defense against a class of XSS.
 *   Referrer-Policy: strict-origin-when-cross-origin
 *     Full URL for same-origin requests, origin-only for cross-origin,
 *     nothing on downgrade. Matches current best practice.
 *   Strict-Transport-Security: max-age=31536000; includeSubDomains
 *     Once a browser sees this, it refuses plain HTTP to this host for
 *     a year. Protects first-visit users from SSL-strip MITM.
 *   Permissions-Policy
 *     Disables browser APIs the app does not use. Reduces attack
 *     surface for accidental exposure of camera, mic, geolocation,
 *     USB, and the payment API. If a feature later needs one of these,
 *     re-add it there.
 *   Cross-Origin-Opener-Policy: same-origin
 *     Isolates the browsing context from cross-origin popups. Prevents
 *     certain side-channel attacks against authenticated sessions.
 *
 * Content-Security-Policy is deliberately NOT set here yet.
 * It requires report-only mode first — a strict CSP can break inline
 * scripts, Supabase auth redirects, and third-party assets if rolled
 * out blind. That work is a separate commit.
 */

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), usb=(), payment=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
]

/**
 * Content-Security-Policy in report-only mode.
 *
 * Report-only means: browsers log violations to /api/csp-report but
 * do not block anything. We observe for a window, tune the policy
 * against real violations, then promote to enforcing CSP (A2c).
 *
 * Two directives carry deliberate looseness for observation:
 *   'unsafe-inline' on script-src — Next.js uses inline scripts for
 *     hydration bootstrap. The correct long-term fix is nonces, which
 *     require proxy/middleware changes. Observation first, nonces in
 *     a later step.
 *   'unsafe-inline' on style-src — Next.js inlines critical CSS.
 *
 * Everything else starts conservative so violations surface real
 * issues rather than noise we've pre-emptively silenced.
 */
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://*.ingest.sentry.io",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  'report-uri /api/csp-report',
].join('; ')

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply to all routes, including API and static.
        source: '/(.*)',
        headers: [
          ...securityHeaders,
          { key: 'Content-Security-Policy-Report-Only', value: cspReportOnly },
        ],
      },
    ]
  },
}

export default nextConfig
