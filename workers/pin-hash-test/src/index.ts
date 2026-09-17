/**
 * PIN hashing test worker.
 *
 * Purpose: verify that PBKDF2-SHA256 hashing works end-to-end under the
 * actual Cloudflare Workers runtime, and measure its cost.
 *
 * Not used by the main application. Kept permanently as a canary — if
 * Cloudflare changes Web Crypto behavior in a way that breaks PBKDF2, CI
 * catches it here before it hits production credential code.
 *
 * Endpoints:
 *   GET /hash?pin=<digits>                         -> { salt, hash, iterations, ms }
 *   GET /verify?pin=<digits>&salt=<b64>&hash=<b64> -> { match, iterations, ms }
 */

const ITERATIONS = 600_000
const SALT_BYTES = 16
const DERIVED_KEY_BYTES = 32

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function pbkdf2(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    DERIVED_KEY_BYTES * 8,
  )
  return new Uint8Array(bits)
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/') {
      return json({
        service: 'pin-hash-test',
        iterations: ITERATIONS,
        saltBytes: SALT_BYTES,
        derivedKeyBytes: DERIVED_KEY_BYTES,
        endpoints: ['/hash?pin=<digits>', '/verify?pin=<digits>&salt=<b64>&hash=<b64>'],
      })
    }

    if (url.pathname === '/hash') {
      const pin = url.searchParams.get('pin')
      if (!pin) return json({ error: 'missing pin' }, 400)

      const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
      const start = Date.now()
      const derived = await pbkdf2(pin, salt)
      const ms = Date.now() - start

      return json({
        salt: toBase64(salt),
        hash: toBase64(derived),
        iterations: ITERATIONS,
        ms,
      })
    }

    if (url.pathname === '/verify') {
      const pin = url.searchParams.get('pin')
      const saltB64 = url.searchParams.get('salt')
      const hashB64 = url.searchParams.get('hash')
      if (!pin || !saltB64 || !hashB64) {
        return json({ error: 'missing pin, salt, or hash' }, 400)
      }

      const salt = fromBase64(saltB64)
      const expected = fromBase64(hashB64)
      const start = Date.now()
      const derived = await pbkdf2(pin, salt)
      const ms = Date.now() - start

      return json({
        match: constantTimeEqual(derived, expected),
        iterations: ITERATIONS,
        ms,
      })
    }

    return json({ error: 'not found' }, 404)
  },
}
