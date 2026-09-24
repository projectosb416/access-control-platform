# Guard Auth Model — Shift-Scoped Session

**Locked:** Option B, shift-scoped session, with five hardening mechanisms.

## Why this model

Guards process hundreds of entries per shift. Requiring Shift ID + Guard ID
on every attempt adds ~1 hour of re-authentication per busy shift. A long-lived
session — one login valid for weeks — means a stolen phone carries a permanent
credential. The shift-scoped session is the middle: the shift is the natural
session boundary, the token dies when the shift ends, and re-auth happens only
on shift start.

## Session lifecycle

┌──────────────────────┐
│  Guard arrives at    │
│  the gate            │
└──────────┬───────────┘
           │
           │  enters: shift_code + guard_code
           ▼
┌──────────────────────┐
│  Worker validates    │
│  → start_shift_session
│  → returns session   │
│  → Worker generates  │
│    random 32-byte    │
│    token             │
│  → hashes SHA-256    │
│  → stores hash on    │
│    shift_session row │
│  → sets HttpOnly     │
│    cookie with token │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Guard processes     │
│  entries / exits     │
│  (cookie auto-sent)  │
└──────────┬───────────┘
           │
           │  shift ends (guard taps "End Shift"
           │  or admin ends from dashboard)
           ▼
┌──────────────────────┐
│  end_shift_session   │
│  → status='completed'│
│  → token dies        │
│    (hash still on    │
│    row, but status   │
│    check rejects)    │
└──────────────────────┘

## Token format

- **32 random bytes** from `crypto.getRandomValues(new Uint8Array(32))` in the Worker
- Encoded as **base64url** for cookie transport (43 chars, URL-safe)
- **Never** generated in Postgres — the Worker owns token generation and hashing
- Never stored raw anywhere — only the SHA-256 hash is persisted

## Storage

**On the guard's device:**

HttpOnly cookie, set by the Worker on successful shift start:

| Attribute | Value | Why |
|---|---|---|
| Name | `shift_session` | One name, one shift |
| HttpOnly | true | Prevents JS from reading it (XSS defense) |
| Secure | true | HTTPS only |
| SameSite | Strict | CSRF defense |
| Path | `/api` | Covers /api/guard-session/* and /api/guard/* |
| Max-Age | 86400 (24h) | Upper bound; the shift check is the real limit |

**In the database (new column on `shift_sessions`):**

- `session_token_hash text` — SHA-256 of the raw token, hex-encoded
- `session_token_issued_at timestamptz`

**Why SHA-256 and not PBKDF2:** the raw token is 32 bytes from
`crypto.getRandomValues` — 256 bits of entropy. Unlike a 6-digit PIN
(1,000,000 combinations), there is nothing to brute-force here. PBKDF2
exists to slow brute force of low-entropy inputs; with no low-entropy
input, it adds cost without defense. SHA-256 is the correct choice, and
any reviewer should not "fix" it to PBKDF2.

**Not stored:** the raw token, anywhere.

## Verification — middleware on every `/guard/*` request

1. Read `shift_session` cookie
2. If missing → 401 `SHIFT_SESSION_REQUIRED`
3. SHA-256 the cookie value
4. Query `shift_sessions` by `session_token_hash`, where `status = 'active'`
5. If no row → 401 `SHIFT_SESSION_INVALID`
6. Load the parent shift. If `shifts.status <> 'active'` → 401 `SHIFT_NOT_ACTIVE`
7. If the request targets a gate different from the shift's `gate_id` → 403 `GATE_MISMATCH`
8. Attach `{ shift_session_id, guard_profile_id, gate_id, organization_id }` to the request context

## The five hardening mechanisms

| # | Mechanism | Attack it stops |
|---|---|---|
| 1 | Token bound to a specific shift_session row | Token replay after shift end |
| 2 | Token bound to a specific gate | Cross-gate token reuse |
| 3 | 32 random bytes (256 bits entropy) | Brute force |
| 4 | Only the SHA-256 hash stored in DB | DB leak (raw tokens not recoverable) |
| 5 | Rate limit per guard scope runs before every attempt | Stolen phone brute-forcing PINs |

## Edge cases and how each is handled

| Situation | Behavior |
|---|---|
| Guard's device wiped mid-shift | Cookie gone. Guard re-enters shift_code + guard_code. `start_shift_session` detects an existing active session for the guard and returns a **new token** for the same session (idempotent re-auth). |
| Guard's phone stolen mid-shift | Admin ends the shift from dashboard → status becomes `completed` → token dies. All actions already taken remain logged against the guard's ID. |
| Guard leaves employment | Admin ends all their shifts; no new shifts scheduled for them. |
| Guard attempts to start two shifts (two devices) | `shift_sessions_one_active_per_guard` partial unique index rejects the second. |
| Guard starts a shift on a different device mid-shift | Same as device wiped — cookie on new device is absent, guard re-enters shift_code + guard_code, gets a token for the SAME session. Old token stays valid on the old device until that device's cookie expires. **v1 accepts this.** |
| Attacker forges a cookie | They'd need to guess 256 random bits. Mathematically infeasible. |
| Attacker replays the same cookie | Same token, same session, same guard — this is legitimate use, not an attack. The cookie grants exactly what the guard had. |
| Guard shares their device with another guard | Both act as the same guard in the audit log. v1 accepts this — the device is the credential holder. |

## What is deferred to Phase 11

- **Device binding.** Require the shift session to match a specific device fingerprint enrolled at hire time. Currently: any device holding a valid cookie can act.
- **Multi-device sessions.** Currently one session, one device effectively. Future: allow a guard to be on multiple devices (e.g., a tablet at the gate + a phone in the office) with independent tokens on the same shift.
- **Session revocation without ending the shift.** Currently you end the shift to revoke. Future: revoke a single device's token without ending the shift for others.

None of these are security regressions. They are conveniences and hardening that belong after v1 launches.

## Error codes the guard UI must handle

| Code | HTTP | Guard sees | Can retry? |
|---|---|---|---|
| `SHIFT_SESSION_REQUIRED` | 401 | "Session ended. Please start your shift again." | Yes — after re-entering shift+guard codes |
| `SHIFT_SESSION_INVALID` | 401 | Same as above | Yes |
| `SHIFT_NOT_ACTIVE` | 401 | "Your shift has ended." | No |
| `GATE_MISMATCH` | 403 | "You are not on shift at this gate." | No |
| `SUBSCRIPTION_INACTIVE` | 402 | "This estate's subscription is inactive. Contact the admin." | No — admin must pay |

## What is NOT specified here

- **Token rotation.** Not needed in v1. One token per shift session, issued once.
- **Refresh tokens.** Not needed — a shift is bounded (typically 4–12 hours).
- **Logout button.** The UI equivalent of "end shift." When the guard taps it, `end_shift_session` runs and the cookie is cleared. No separate logout flow.
