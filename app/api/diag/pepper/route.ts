// Temporary diagnostic — reports the LENGTH and SHA-256 HASH of the
// PIN_PEPPER the Worker sees. Never returns the pepper itself.
// Deleted once the environment check is confirmed.

export const runtime = 'nodejs'

export async function GET() {
  const pepper = process.env.PIN_PEPPER ?? ''
  const data = new TextEncoder().encode(pepper)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return Response.json({ length: pepper.length, sha256: hex })
}
