# Error → HTTP Status Mapping

**Rule:** every Postgres exception raised by an application function has a
concrete mapping here. Any exception NOT in this list is a bug and maps to
HTTP 500 with `SYSTEM_UNAVAILABLE`. The Worker must never expose a raw
Postgres error string to a client.

## 2xx

| Condition | HTTP | Notes |
|---|---|---|
| Success, resource created | 201 | POST with new resource |
| Success, read or update | 200 | |
| Success, no content | 204 | e.g., end_shift_session, resolve_session |

## 4xx — client errors

### Authentication and authorization

| Error code | HTTP | Meaning |
|---|---|---|
| `NOT_AUTHENTICATED` | 401 | No valid JWT/session |
| `SHIFT_SESSION_REQUIRED` | 401 | Guard route, no shift cookie |
| `SHIFT_SESSION_INVALID` | 401 | Shift cookie present but invalid or expired |
| `SHIFT_NOT_ACTIVE` | 401 | The shift behind the session is no longer active |
| `NOT_AUTHORIZED` | 403 | Authenticated but lacks permission for this action |
| `NOT_ORG_ADMIN` | 403 | Caller is not an org admin |
| `NOT_PLATFORM_ADMIN` | 403 | Caller is not a platform admin |
| `GATE_MISMATCH` | 403 | Guard's shift is at a different gate |

### Payment / subscription

| Error code | HTTP | Meaning |
|---|---|---|
| `SUBSCRIPTION_INACTIVE` | 402 | Org's subscription is not operational |

### Validation — inputs

| Error code | HTTP | Meaning |
|---|---|---|
| `INVALID_ACCESS_TYPE` | 400 | `access_type` not in the enum |
| `INVALID_AUTHORIZATION_TYPE` | 400 | Not `one_time` or `reusable` |
| `INVALID_VALIDITY_WINDOW` | 400 | `valid_until <= valid_from` |
| `INVALID_CREDENTIAL_FORMAT` | 400 | PHC string malformed |
| `INVALID_LOOKUP_KEY` | 400 | Empty or missing |
| `INVALID_SCOPE_TYPE` | 400 | rate_limit_attempt scope not recognized |
| `INVALID_WINDOW_SECONDS` | 400 | `<= 0` |
| `INVALID_MAX_ATTEMPTS` | 400 | `<= 0` |
| `INVALID_LOCKOUT_SECONDS` | 400 | `< 0` |
| `INVALID_BUCKET_SECONDS` | 400 | `<= 0` or `> window` |
| `PURPOSE_REQUIRED` | 400 | Blank purpose |
| `REASON_REQUIRED` | 400 | Blank reason for resolve/mark |
| `ORG_NAME_REQUIRED` | 400 | Blank org name in setup |
| `ADMIN_NAME_REQUIRED` | 400 | Blank admin name in setup |
| `PROPERTY_NAME_REQUIRED` | 400 | Blank property name in setup |
| `INVALID_ORG_TYPE` | 400 | Not residential / workplace / other |
| `INVALID_PURPOSE` | 400 | payment purpose not in enum |
| `LOCKOUT_SECONDS_MUST_BE_POSITIVE` | 400 | `<= 0` |

### Not found

| Error code | HTTP | Meaning |
|---|---|---|
| `SHIFT_NOT_FOUND` | 404 | |
| `GUARD_NOT_FOUND` | 404 | |
| `PAYMENT_NOT_FOUND` | 404 | |
| `SESSION_NOT_FOUND` | 404 | |
| `PLAN_NOT_FOUND` | 404 | |
| `PLAN_NOT_AVAILABLE` | 404 | Plan exists but is not active |

### Conflict — state prevents the action

| Error code | HTTP | Meaning |
|---|---|---|
| `GATE_CAPACITY_REACHED` | 409 | Gate is at max concurrent guards |
| `GUARD_ALREADY_ON_SHIFT` | 409 | Guard has another active shift session |
| `SHIFT_NOT_OPEN` | 409 | Shift is scheduled but not yet within the start window |
| `SHIFT_ENDED` | 410 | Shift's scheduled_end has passed |
| `SESSION_NOT_ACTIVE` | 409 | Already ended or interrupted |
| `SESSION_NOT_OPEN` | 409 | Session is not in the state required for this action |
| `SESSION_NOT_RESOLVABLE` | 409 | Session is not unresolved, or already resolved |
| `PAYMENT_NOT_PENDING` | 409 | Payment is not awaiting confirmation |
| `PAYMENT_NOT_SUCCEEDED` | 409 | Trying to create subscription from a non-succeeded payment |
| `PAYMENT_MISSING_PLAN` | 409 | Payment has no plan_id |
| `NOT_MANUAL_PAYMENT` | 409 | confirm_manual_payment called on a webhook row |
| `PIN_COLLISION` | 409 | Lookup key already live in this org |
| `PERSON_NOT_IN_ORG` | 409 | Cross-tenant person reference |
| `PERSON_NOT_ACTIVE` | 409 | |
| `UNIT_NOT_IN_ORG` | 409 | |
| `UNIT_NOT_ACTIVE` | 409 | |
| `APPOINTMENT_NOT_IN_ORG` | 409 | |
| `HOST_NOT_IN_ORG` | 409 | |

## 5xx — server errors

| Error code | HTTP | Meaning |
|---|---|---|
| `SYSTEM_UNAVAILABLE` | 500 | Unhandled exception, or database unavailable |
| (anything else) | 500 | Catch-all. Log full detail server-side. Return `SYSTEM_UNAVAILABLE` to client. |

## Access engine result codes (NOT HTTP errors)

These are outcomes from `evaluate_entry` / `evaluate_exit` returned in the
response body, not HTTP errors. The HTTP status for a processed attempt is
**always 200** — the guard needs the result either way.

- `GRANTED`
- `DENIED`
- `INVALID_PIN`
- `EXPIRED_AUTHORIZATION`
- `REVOKED_AUTHORIZATION`
- `NO_ACTIVE_SESSION`
- `ONE_TIME_ALREADY_CONSUMED`
- `UNRESOLVED_VISIT`
- `RATE_LIMITED`
- `GATE_INACTIVE`
- `GUARD_NOT_ON_ACTIVE_SHIFT`
- `SYSTEM_UNAVAILABLE`
- `SUBSCRIPTION_INACTIVE` (added in migration 0022)

The distinction: **a business-logic "no" is HTTP 200 with a result code**,
not HTTP 4xx. The guard's UI plays the sound, shows the color, logs the
attempt. 4xx is reserved for "the request itself was malformed or unauthorized."

## Worker-side rule

Every Worker endpoint has the same error handling shape:


- **Never** return the raw Postgres error string to the client.
- **Always** log the full error server-side for 5xx.
- **Never** log the token, PIN, or any credential material.

## Message wording

`safeMessage(code)` — short, non-technical, human-readable. Examples:

- `NOT_AUTHORIZED` → "You don't have permission to do this."
- `GATE_CAPACITY_REACHED` → "This gate is at capacity. Try again when a guard ends shift."
- `SUBSCRIPTION_INACTIVE` → "This estate's subscription is inactive."
- `PIN_COLLISION` → "This PIN is already in use. Generate a new one."

Full dictionary is a Phase 8 concern (UX copy). This document only fixes the code → status mapping.
