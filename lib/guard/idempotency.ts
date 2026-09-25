/**
 * Idempotency key generation.
 *
 * Format — see docs/phase-7/idempotency-keys.md:
 *   {shift_session_id}:{direction}:{client_timestamp_ms}:{client_counter}
 *
 * The key identifies a single logical attempt. On a retry (network failure,
 * timeout), the SAME key must be resent — the server returns the original
 * result instead of double-processing. On a new attempt, the counter
 * increments and a fresh key is generated.
 *
 * The counter lives in memory, scoped per module instance. A page reload
 * resets it to 1. Collisions across reloads are prevented by the timestamp
 * component — two attempts one second apart have different ms values even
 * with the same counter.
 */

let counter = 0

/**
 * Next attempt key. Call once per logical ENTRY/EXIT attempt.
 * The counter increments each call, so two sequential attempts get
 * different keys even within the same millisecond.
 */
export function nextEntryKey(shiftSessionId: string, direction: 'entry' | 'exit'): string {
  counter += 1
  const ts = Date.now()
  return `${shiftSessionId}:${direction}:${ts}:${counter}`
}

/**
 * Reset the counter. Called on shift session change (login), so the first
 * attempt of a new shift gets a low counter value. Not strictly required —
 * timestamps already disambiguate — but cleaner for debugging.
 */
export function resetIdempotencyCounter(): void {
  counter = 0
}
