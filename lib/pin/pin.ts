/**
 * PIN credential primitives.
 *
 * All functions here are pure — no I/O, no environment access, no database.
 * The pepper, iteration count, and PIN are passed in by the caller. This
 * makes them testable without a Worker runtime.
 *
 * PHC format used throughout: $pbkdf2-sha256$i=<iterations>$<salt_b64>$<hash_b64>
 * Derived bits = PBKDF2-HMAC-SHA256(pepper || pin, salt, iterations, 32 bytes)
 * Lookup key    = HMAC-SHA256(pepper, "org:<org_id>:pin:<pin>") as hex
 */

const PHC_ALGORITHM = 'pbkdf2-sha256'
const PHC_PREFIX = `$${PHC_ALGORITHM}$`
const DEFAULT_ITERATIONS = 100_000
const SALT_BYTES = 16
const DERIVED_KEY_BYTES = 32

export interface ParsedPhc {
  iterations: number
  salt: Uint8Array
  hash: Uint8Array
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function parsePhc(phc: string): ParsedPhc {
  // $pbkdf2-sha256$i=100000$<salt_b64>$<hash_b64>
  if (!phc.startsWith(PHC_PREFIX)) {
    throw new Error('PHC_ALGORITHM_NOT_SUPPORTED')
  }

  const parts = phc.split('$')
  // parts: ['', 'pbkdf2-sha256', 'i=100000', '<salt_b64>', '<hash_b64>']
  if (parts.length !== 5) {
    throw new Error('PHC_MALFORMED')
  }

  const paramsPart = parts[2]
  if (!paramsPart.startsWith('i=')) {
    throw new Error('PHC_MALFORMED')
  }

  const iterations = parseInt(paramsPart.slice(2), 10)
  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error('PHC_MALFORMED')
  }

  try {
    const salt = base64ToBytes(parts[3])
    const hash = base64ToBytes(parts[4])
    return { iterations, salt, hash }
  } catch {
    throw new Error('PHC_MALFORMED')
  }
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

async function derivePbkdf2(
  pin: string,
  salt: Uint8Array,
  pepper: string,
  iterations: number,
  keyBytes: number,
): Promise<Uint8Array> {
  const encoder = new TextEncoder()
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
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    keyBytes * 8,
  )

  return new Uint8Array(bits)
}

/**
 * Verify a PIN against a stored PHC string.
 * Returns true on match, false on mismatch. Throws on malformed PHC.
 */
export async function verifyPinAgainstPhc(
  pin: string,
  phc: string,
  pepper: string,
): Promise<boolean> {
  const parsed = parsePhc(phc)
  const derived = await derivePbkdf2(
    pin,
    parsed.salt,
    pepper,
    parsed.iterations,
    parsed.hash.length,
  )
  return constantTimeEqual(derived, parsed.hash)
}

/**
 * Compute the deterministic lookup key for a PIN within an org.
 * Used to find the credential row before PBKDF2 verification.
 * Output: 64-char lowercase hex.
 */
export async function computeLookupKey(
  pin: string,
  organizationId: string,
  pepper: string,
): Promise<string> {
  const encoder = new TextEncoder()

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const message = encoder.encode(`org:${organizationId}:pin:${pin}`)
  const signature = await crypto.subtle.sign('HMAC', key, message)

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate a fresh PHC string for a new PIN.
 * Uses a random 16-byte salt. Iterations default to the Workers platform cap.
 * Used by the authorization-creation path (Worker side, before the DB insert).
 */
export async function hashPin(
  pin: string,
  pepper: string,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<{ phc: string; salt: Uint8Array; hash: Uint8Array }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await derivePbkdf2(pin, salt, pepper, iterations, DERIVED_KEY_BYTES)

  const phc = `${PHC_PREFIX}i=${iterations}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`

  return { phc, salt, hash }
}
