import { NextResponse } from 'next/server'
import type { createServiceClient } from '@/lib/supabase/service'

type SupabaseClient = ReturnType<typeof createServiceClient>

export type RateLimitScope = 'gate' | 'guard' | 'credential'

export type RateLimitVerdict =
  | { kind: 'allowed' }
  | { kind: 'limited' }
  | { kind: 'unavailable' }

interface RateLimitRow {
  allowed: boolean
}

/**
 * Fail-closed rate-limit check for guard endpoints.
 *
 * Wraps rate_limit_attempt_for_org with an explicit three-way verdict:
 *
 *   allowed      — the RPC returned a row with allowed = true.
 *   limited      — the RPC returned a row with allowed = false. The
 *                  caller should respond with RATE_LIMITED.
 *   unavailable  — the RPC errored, returned no data, or returned an
 *                  empty array. The caller MUST NOT proceed with PIN
 *                  verification. Respond 503.
 *
 * The "unavailable → deny" rule is the whole point of this helper. A
 * six-digit PIN has a small search space; rate limiting is the defense.
 * A silently-failing rate limiter is not a rate limiter — it is an
 * infinite-rate brute-force oracle. Any failure of the check denies
 * by default.
 *
 * Callers are still expected to place the "limited" branch before any
 * state change. The helper does not call handleRateLimited for them
 * because that path writes an audit event and needs caller context.
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  organizationId: string,
  scope: RateLimitScope,
  scopeId: string,
  bucketSeconds = 10,
): Promise<RateLimitVerdict> {
  const { data, error } = await supabase.rpc('rate_limit_attempt_for_org', {
    p_organization_id: organizationId,
    p_scope_type: scope,
    p_scope_id: scopeId,
    p_bucket_seconds: bucketSeconds,
  })

  if (error) return { kind: 'unavailable' }

  const rows = (data ?? []) as RateLimitRow[]
  if (rows.length === 0) return { kind: 'unavailable' }

  return rows[0].allowed ? { kind: 'allowed' } : { kind: 'limited' }
}

/**
 * Uniform 503 response for the "unavailable" verdict.
 *
 * Separate from the helper itself so callers can log or annotate
 * before responding, if needed.
 */
export function rateLimitUnavailableResponse() {
  return NextResponse.json({ code: 'SYSTEM_UNAVAILABLE' }, { status: 503 })
}
