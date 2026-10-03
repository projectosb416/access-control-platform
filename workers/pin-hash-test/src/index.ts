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
 * Secured: all action endpoints require `Authorization: Bearer <TEST_AUTH_TOKEN>`.
 * The root endpoint is public (service metadata only).
 *
 * Pepper: a 32-byte secret stored as the Worker secret PIN_PEPPER is
 * concatenated with the PIN before PBKDF2 input. Losing the pepper makes
 * every stored hash unrecoverable — that is intentional and by design.
 *
 * Endpoints:
 *   GET /                                              -> service metadata (public)
 *   GET /hash?pin=<digits>                             -> { salt, hash, iterations, ms }
 *   GET /verify?pin=<digits>&salt=<b64>&hash=<b64>     -> { match, iterations, ms }
 */

const ITERATIONS = 100_000
const SALT_BYTES = 16
const DERIVED_KEY_BYTES = 32

interface Env {
  TEST_AUTH_TOKEN: string
  PIN_PEPPER: string
}

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

async function pbkdf2(pin: string, salt: Uint8Array, pepper: string): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  // pepper || pin — pepper mixed in before PBKDF2 key derivation
  const combined = encoder.encode(pepper + pin)
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    combined,
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

function isAuthorized(request: Request, env: Env): boolean {
  const expected = env.TEST_AUTH_TOKEN
  if (!expected) return false
  const header = request.headers.get('authorization') ?? ''
  const prefix = 'Bearer '
  if (!header.startsWith(prefix)) return false
  const provided = header.slice(prefix.length)
  // Constant-time comparison of equal-length tokens
  if (provided.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/') {
    return json({
      service: 'pin-hash-test',
      iterations: ITERATIONS,
      saltBytes: SALT_BYTES,
      derivedKeyBytes: DERIVED_KEY_BYTES,
      pepperEnabled: Boolean(env.PIN_PEPPER),
      endpoints: ['/hash?pin=<digits>', '/verify?pin=<digits>&salt=<b64>&hash=<b64>'],
    })
  }

  if (!env.PIN_PEPPER) {
    return json({ error: 'server misconfigured: PIN_PEPPER missing' }, 500)
  }

  if (!isAuthorized(request, env)) {
    return json({ error: 'unauthorized' }, 401)
  }

  if (url.pathname === '/hash') {
    const pin = url.searchParams.get('pin')
    if (!pin) return json({ error: 'missing pin' }, 400)

    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
    const start = Date.now()
    const derived = await pbkdf2(pin, salt, env.PIN_PEPPER)
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
    const derived = await pbkdf2(pin, salt, env.PIN_PEPPER)
    const ms = Date.now() - start

    return json({
      match: constantTimeEqual(derived, expected),
      iterations: ITERATIONS,
      ms,
    })
  }

  return json({ error: 'not found' }, 404)
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env)
    } catch (err) {
      const e = err as Error
      return json(
        {
          error: 'uncaught exception',
          name: e?.name ?? 'Unknown',
          message: e?.message ?? String(err),
          stack: e?.stack ?? null,
        },
        500,
      )
    }
  },
}
export default worker
