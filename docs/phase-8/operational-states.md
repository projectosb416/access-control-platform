# Operational States

**Purpose:** one shared vocabulary for every state a person sees across
the platform. Every screen, sound, and color derives from this table.
If a screen needs a state that isn't here, we add it here first.

This document covers the states derived from `access_events.result_code`
(the outcomes of a gate attempt), plus session, credential, and
subscription states visible to residents and admins.

---

## Three tiers

Every state falls into one of three visual/sound tiers. The tier is what
the user perceives first; the specific state is the detail.

| Tier | Color | Sound | Meaning |
|---|---|---|---|
| **Positive** | Green | `success` | The action worked. |
| **Warning** | Amber | `warning` | Something is off, but recoverable. |
| **Negative** | Red | `error` | The action did not work. Cannot be fixed at the gate. |

Sounds are three short audio files — one per tier. Not one per state.
§32: "sound can supplement but not replace visual feedback."

---

## Code-to-state mapping — the collapsing decision

Every backend `access_events.result_code` (handoff §19) maps to exactly
one guard-facing state label. **No two result codes share a label.**

This is deliberate, not accidental:

- The **visual tier** is shared across states in the same tier. That's the
  fast, binary signal: "go / careful / no."

- The **state label** stays distinct per result code. The guard relays the
  label to the visitor; the visitor relays it to their host. **Each state
  has a different next step for the host:**

  | State | Host's next step |
  |---|---|
  | `EXPIRED` | Extend the validity window |
  | `REVOKED` | Reissue the authorization |
  | `INVALID PIN` | Check the PIN they sent — probably a typo |
  | `ALREADY USED` | Nothing — the visit is complete |
  | `ALREADY INSIDE` | Resolve the open session first |
  | `LOCKED` | Wait — retry after lockout expires |

Collapsing these to a generic "Denied" loses the host's action. The guard
would say "it didn't work," the visitor would call the host, and the host
would have to guess.

**The full mapping:**

| Result code | Tier | Guard label | Sub-text |
|---|---|---|---|
| `GRANTED` | Green | **GRANTED** | — |
| `EXPIRED_AUTHORIZATION` | Amber | **EXPIRED** | Valid until [time] |
| `UNRESOLVED_VISIT` | Amber | **ALREADY INSIDE** | Session opened [time] |
| `NO_ACTIVE_SESSION` | Amber | **NOT INSIDE** | No open visit to close |
| `RATE_LIMITED` | Amber | **LOCKED** | Try again in [n] seconds |
| `DENIED` | Amber | **DENIED** | [specific reason from event] |
| `INVALID_PIN` | Red | **INVALID PIN** | PIN does not match any credential |
| `REVOKED_AUTHORIZATION` | Red | **REVOKED** | Revoked by [admin], [time] |
| `ONE_TIME_ALREADY_CONSUMED` | Red | **ALREADY USED** | Used at [time] |
| `GATE_INACTIVE` | Red | **GATE CLOSED** | Gate status: inactive |
| `GUARD_NOT_ON_ACTIVE_SHIFT` | Red | **NOT ON SHIFT** | Restart your shift |
| `SUBSCRIPTION_INACTIVE` | Red | **SUBSCRIPTION INACTIVE** | Estate billing issue |
| `SYSTEM_UNAVAILABLE` | Red | **SYSTEM ERROR** | Try again in a moment |

**Two tier assignments worth explaining:**

- `GUARD_NOT_ON_ACTIVE_SHIFT` is **red, not amber** — the problem is the
  guard's own state, not the visitor's. Red communicates "stop and fix
  this." The guard cannot process anyone until their shift is active.

- `NO_ACTIVE_SESSION` is **amber, not red** — the visitor is trying to
  exit but has no open session. Usually means the entry was never
  recorded. An admin can investigate and resolve. Not a hard "no" — a
  "wait, something's off."

**When to collapse two codes into one label:** only when their meaning
and the host's next step are identical. We have no such pair today. If
we add one later, the merge is recorded here explicitly — never done
silently in the UI.

---

## Guard-facing presentation

The gate screen shows three elements, in this order:

1. **Color fill** — the whole screen tints to the tier color
2. **State label** — large, uppercase, one or two words
3. **Sub-text** — smaller, one line, the specific context

**Example — GRANTED:**

**Example — EXPIRED:**

**Example — INVALID PIN:**

The guard **never** sees the raw result code. They see the label and
sub-text. The code lives in logs and admin screens.

---

## Session states (visible to residents and admins)

| DB status | User label | Meaning |
|---|---|---|
| `open` | **Inside** | Visitor is currently on the property. |
| `completed` | **Completed** | Visitor entered and exited cleanly. |
| `unresolved` | **Unresolved** | Visitor entered but no exit was recorded. |

**Guards never see "unresolved" as such** — they see it only as the
`ALREADY INSIDE` state when a visitor with an open session tries to
enter again. Residents and admins see the state in the activity feed.

---

## Credential lifecycle states (admin-facing)

Referenced from the schema (§20). Appears on the Admin's credential
detail screen after a lookup.

| DB status | Admin label | Meaning |
|---|---|---|
| `created` | **Created** | Row exists but not yet activated. |
| `active` | **Active** | Ready for use. |
| `in_use` | **In Use** | Holder currently has an open session. |
| `consumed` | **Consumed** | One-time PIN used. Historical. |
| `expired` | **Expired** | Validity window passed. |
| `revoked` | **Revoked** | Deliberately disabled by an admin. |
| `cancelled` | **Cancelled** | Cancelled before use. |

---

## Subscription states (admin-facing)

Appears on the Admin's billing page. Drives the `SUBSCRIPTION_INACTIVE`
gate response.

| DB status | Admin label | Gate operational? |
|---|---|---|
| `trial` | **Trial** | Yes |
| `active` | **Active** | Yes |
| `past_due` | **Past Due** | Yes (soft grace window) |
| `grace_period` | **Grace Period** | Yes (explicit grace window) |
| `suspended` | **Suspended** | No |
| `cancelled` | **Cancelled** | No |
| `expired` | **Expired** | No |
| `superseded` | **Superseded** | No (historical) |

`is_org_operational()` returns true for `trial`, `active`, `past_due`,
and `grace_period`. False for the rest.

---

## What is NOT in this document

- **Internal error codes** (e.g., `PHC_MALFORMED`, `ALREADY_HOUSEHOLD_MEMBER`).
  Those map to HTTP statuses per `error-http-mapping.md`.
- **Hex color values.** Tiers are named (green / amber / red). Hex
  belongs to the design system, chosen in Phase 9.
- **Specific sound files.** Three tiers, one sound each, chosen in Phase 9.
- **Animation.** Phase 9 concern.

---

## The rule

If a new state is needed:

1. Add it here first.
2. Assign it a tier (positive / warning / negative).
3. Define the guard label and sub-text template.
4. Then build the screen.

Never the other way around.

If two existing states turn out to mean the same thing to the guard and
the host:

1. Document the merge in the code-to-state table.
2. Update all screens consistently in one commit.

Never merge silently in the UI.
