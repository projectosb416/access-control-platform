// Dev utility: generate a PHC credential and lookup_key for testing.
//
// Usage:
//   PEPPER=<hex> node scripts/gen-test-credential.mjs <pin> <org-id>
//
// Prints JSON with { phc, lookup_key }. Neither value is a secret — both
// are stored in the database by design. The pepper is never printed.
//
// Not used in production. The real credential creation path is
// create_authorization_with_credential, called by the Worker with a
// pepper held in its own secrets.

const pepper = process.env.PEPPER
if (!pepper) {
  console.error('PEPPER env var not set')
  process.exit(1)
}

const [pin, orgId] = process.argv.slice(2)
if (!pin || !orgId) {
  console.error('Usage: PEPPER=<hex> node scripts/gen-test-credential.mjs <pin> <org-id>')
  process.exit(1)
}

if (!/^[0-9]{6}$/.test(pin)) {
  console.error('PIN must be exactly 6 digits')
  process.exit(1)
}

const ITERATIONS = 100000
const SALT_BYTES = 16
const DERIVED_KEY_BYTES = 32

function bytesToBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

async function derivePbkdf2(pin, salt, pepper, iterations, keyBytes) {
  const encoder = new TextEncoder()
  const combined = encoder.encode(pepper + pin)
  const keyMaterial = await crypto.subtle.importKey(
    'raw', combined, { name: 'PBKDF2' }, false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial, keyBytes * 8
  )
  return new Uint8Array(bits)
}

async function computeLookupKey(pin, orgId, pepper) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const message = encoder.encode(`org:${orgId}:pin:${pin}`)
  const sig = await crypto.subtle.sign('HMAC', key, message)
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function main() {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await derivePbkdf2(pin, salt, pepper, ITERATIONS, DERIVED_KEY_BYTES)
  const phc = `$pbkdf2-sha256$i=${ITERATIONS}$${bytesToBase64(salt)}$${bytesToBase64(hash)}`
  const lookupKey = await computeLookupKey(pin, orgId, pepper)

  console.log(JSON.stringify({ phc, lookup_key: lookupKey }, null, 2))
}

main().catch(err => { console.error(err); process.exit(1) })
