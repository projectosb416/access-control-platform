// @vitest-environment node

import { describe, it, expect } from 'vitest'
import {
  parsePhc,
  constantTimeEqual,
  verifyPinAgainstPhc,
  computeLookupKey,
  hashPin,
} from '@/lib/pin/pin'

// Test iterations are lower than production (100,000) to keep the suite fast.
// The algorithm is identical at any iteration count; the deployed pin-hash-test
// worker already proved 100k works on the real Cloudflare runtime.
const TEST_ITERATIONS = 5_000
const PEPPER = 'test-pepper-64-hex-chars-not-real-do-not-use-in-prod'
const ORG_A = '00000000-0000-0000-0000-000000000001'
const ORG_B = '00000000-0000-0000-0000-000000000002'

describe('parsePhc', () => {
  it('parses a valid PHC string', async () => {
    const { phc } = await hashPin('123456', PEPPER, TEST_ITERATIONS)
    const parsed = parsePhc(phc)
    expect(parsed.iterations).toBe(TEST_ITERATIONS)
    expect(parsed.salt.length).toBe(16)
    expect(parsed.hash.length).toBe(32)
  })

  it('throws PHC_ALGORITHM_NOT_SUPPORTED for unknown algorithm', () => {
    expect(() => parsePhc('$argon2id$i=1000$c2FsdA==$aGFzaA==')).toThrow(
      'PHC_ALGORITHM_NOT_SUPPORTED',
    )
  })

  it('throws PHC_MALFORMED for missing segments', () => {
    expect(() => parsePhc('$pbkdf2-sha256$i=100000$c2FsdA==')).toThrow('PHC_MALFORMED')
  })

  it('throws PHC_MALFORMED for non-numeric iteration count', () => {
    expect(() =>
      parsePhc('$pbkdf2-sha256$i=notanumber$c2FsdA==$aGFzaA=='),
    ).toThrow('PHC_MALFORMED')
  })

  it('throws PHC_MALFORMED for invalid base64 salt', () => {
    expect(() =>
      parsePhc('$pbkdf2-sha256$i=1000$not@base64$aGFzaA=='),
    ).toThrow('PHC_MALFORMED')
  })
})

describe('constantTimeEqual', () => {
  it('returns true for equal byte arrays', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3, 4]), new Uint8Array([1, 2, 3, 4]))).toBe(
      true,
    )
  })

  it('returns false for same-length arrays with a differing byte', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3, 4]), new Uint8Array([1, 2, 3, 5]))).toBe(
      false,
    )
  })

  it('returns false for different lengths', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3, 4]))).toBe(false)
  })
})

describe('verifyPinAgainstPhc', () => {
  it('round-trips: hashPin then verify succeeds with the same PIN and pepper', async () => {
    const { phc } = await hashPin('123456', PEPPER, TEST_ITERATIONS)
    const ok = await verifyPinAgainstPhc('123456', phc, PEPPER)
    expect(ok).toBe(true)
  })

  it('rejects the wrong PIN', async () => {
    const { phc } = await hashPin('123456', PEPPER, TEST_ITERATIONS)
    const ok = await verifyPinAgainstPhc('654321', phc, PEPPER)
    expect(ok).toBe(false)
  })

  it('rejects the wrong pepper', async () => {
    const { phc } = await hashPin('123456', PEPPER, TEST_ITERATIONS)
    const ok = await verifyPinAgainstPhc('123456', phc, 'a-different-pepper')
    expect(ok).toBe(false)
  })
})

describe('computeLookupKey', () => {
  it('is deterministic for the same PIN, org, and pepper', async () => {
    const k1 = await computeLookupKey('123456', ORG_A, PEPPER)
    const k2 = await computeLookupKey('123456', ORG_A, PEPPER)
    expect(k1).toBe(k2)
  })

  it('differs across organizations for the same PIN', async () => {
    const k1 = await computeLookupKey('123456', ORG_A, PEPPER)
    const k2 = await computeLookupKey('123456', ORG_B, PEPPER)
    expect(k1).not.toBe(k2)
  })

  it('differs across PINs for the same org', async () => {
    const k1 = await computeLookupKey('123456', ORG_A, PEPPER)
    const k2 = await computeLookupKey('654321', ORG_A, PEPPER)
    expect(k1).not.toBe(k2)
  })

  it('produces 64-character lowercase hex', async () => {
    const k = await computeLookupKey('123456', ORG_A, PEPPER)
    expect(k).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('hashPin', () => {
  it('produces unique salts across calls for the same PIN', async () => {
    const a = await hashPin('123456', PEPPER, TEST_ITERATIONS)
    const b = await hashPin('123456', PEPPER, TEST_ITERATIONS)
    expect(Array.from(a.salt)).not.toEqual(Array.from(b.salt))
    expect(a.phc).not.toBe(b.phc)
  })

  it('produces a PHC string with the correct prefix and iteration count', async () => {
    const { phc } = await hashPin('123456', PEPPER, TEST_ITERATIONS)
    expect(phc.startsWith('$pbkdf2-sha256$i=')).toBe(true)
    expect(phc).toContain(`i=${TEST_ITERATIONS}$`)
  })
})
