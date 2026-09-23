# Idempotency Keys

**Purpose:** a retried request must not double-process. When a guard's device
sends an ENTRY request and the network drops before the response arrives, the
device retries. Without idempotency, the second request creates a second event
and a second session. With idempotency, the retry returns the original result
and nothing new happens.

## Format

{shift_session_id}:{direction}:{client_timestamp_ms}:{client_counter}

- **shift_session_id** — UUID of the guard's current shift session
- **direction** — `entry` or `exit`
- **client_timestamp_ms** — Unix milliseconds at the moment the guard tapped
- **client_counter** — a per-shift, monotonically increasing integer that starts at 1

Example: `a1b2c3d4-...:entry:1727012345678:42`

## Who generates it

**The guard's device.** It is the only component that knows a retry is happening.

- On a fresh attempt: device increments its counter, builds the key, sends the request
- On a retry (network failure, timeout): device resends the **same** key — it does not increment
- On a new attempt after a successful one: counter increments again

## Where it is stored

`access_events.idempotency_key` — unique per organization via partial unique index:


## How replay works

`evaluate_entry` (and `evaluate_exit`) check the key first:

1. If idempotency_key is present and an access_event exists with that key:
   return the ORIGINAL event's result code, event id, and access_session_id.
   Do NOT create a new session, do NOT change credential state.
2. Otherwise proceed normally.

The Worker returns the same JSON response the original request produced. The
device cannot tell the difference between "first response arrived late" and
"retry response arrived now."

## Guarantees

- **At most one event** per (organization, idempotency_key). Enforced at the
  database by the partial unique index.
- **At most one session** created per successful ENTRY, even if the ENTRY
  request is retried.
- **Same response** for retries: result_code, event_id, session_id all match.

## What is NOT covered

- **Duplicate attempts with DIFFERENT keys.** If the device sends a fresh
  key for what should be the same attempt, the system treats it as a new
  attempt. This is correct behavior — the device must be careful to reuse
  the key on retries, not generate a new one.
- **Cross-device deduplication.** Two devices sending the same key would
  collide (unique index) and the second would get the first's response.
  This is correct — same key means "this is the same request."

## Counter lifecycle

The counter is **per shift_session** and reset only when a new shift session
begins. It is stored on the device in memory (not persisted). If the device
is wiped mid-shift, the counter restarts at 1 — but the timestamp_ms portion
of the key differs, so no collision with pre-wipe keys occurs.

## Clock skew

The device's clock may drift from the server's. That is fine — the key is
opaque to Postgres; it is only a string. The server does not validate the
timestamp inside it. The timestamp exists to disambiguate keys within the
same shift_session when the counter might collide (e.g., after a device wipe).

## Size limit

`idempotency_key` is `text` in the schema. No length constraint is enforced
at the database level. The Worker should reject keys longer than 200
characters with HTTP 400 to prevent abuse.

## When NOT to use idempotency keys

- **Reads.** GET requests need no idempotency.
- **User-initiated single actions** from a UI (create authorization, revoke,
  resolve session). These are not auto-retried by the client; the user
  retries manually, and a human retry of "create authorization" is expected
  to create a new authorization.
- **Payment webhooks.** These use `(provider, provider_reference)` as their
  own natural key — see migration 0020. They are idempotent by that
  constraint, not by the idempotency_key pattern.

Idempotency keys are specifically for **automatically retried machine-to-machine
calls** — which in practice means the guard's device calling ENTRY/EXIT.
