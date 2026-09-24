# Subscription Lock — Enforcement Reference

**Purpose:** one-page index of every place the subscription status is
enforced. Anyone changing a policy or function on this list must preserve
the `is_org_operational` check.

The rule: when an org is not operational (provisioning before first
payment, expired, cancelled), **no INSERT on tenant tables**. Reads,
updates, and payments always work.

See `docs/ops/subscription-cron.md` for the daily expiry job.

---

## The check itself

`public.is_org_operational(p_organization_id uuid) returns boolean`

Defined in migration 0019. Returns true when BOTH:
- `organizations.status = 'active'`
- an operational subscription exists (`trial`, `active`, `past_due`, or `grace_period`)

Returns false otherwise.

---

## Policies that enforce the lock — direct reference

These INSERT policies call `is_org_operational(organization_id)` in their
`with check` clause. All are in migration 0022 unless noted.

| Table | Policy | Migration |
|---|---|---|
| `organization_memberships` | `memberships_insert_admin` | 0022 |
| `people` | `people_insert_admin` | 0022, rewritten 0031 |
| `properties` | `properties_insert_admin` | 0022 |
| `units` | `units_insert_admin` | 0022 |
| `occupancies` | `occupancies_insert_admin` | 0022 |
| `gates` | `gates_insert_admin` | 0022 |
| `guard_profiles` | `guard_profiles_insert_admin` | 0022 |
| `shifts` | `shifts_insert_admin` | 0022 |
| `appointments` | `appointments_insert_admin` | 0022 |
| `authorizations` | `authorizations_insert_admin` | 0022 |
| `authorizations` | `authorizations_insert_primary_resident` | 0022 |
| `household_members` | `household_members_insert_primary_resident` | 0031 |
| `people` | `people_insert_household_member` | 0031 |

---

## Policies that enforce the lock — via helper

These policies call a helper function which itself calls
`is_org_operational`. The indirection exists because RLS recursion between
`shifts` and `shift_sessions` required wrapping the cross-table lookups in
SECURITY DEFINER helpers (migration 0025).

| Table | Policy | Helper | Migration |
|---|---|---|---|
| `shift_sessions` | `shift_sessions_insert_admin` | `shift_org_operational(shift_id)` | rewritten in 0025 |

The helper `shift_org_operational(p_shift_id uuid)` returns true when the
shift's org is operational. Defined in migration 0025.

---

## Functions that self-enforce the lock

These are SECURITY DEFINER — they bypass RLS by design, so they must call
`is_org_operational` themselves.

| Function | Migration | Purpose |
|---|---|---|
| `create_authorization_with_credential` | 0027 | Checks before creating the authorization. Raises `SUBSCRIPTION_INACTIVE`. |
| `redeem_household_invite` | 0031, fixed 0032 | Checks before linking the household member. Raises `SUBSCRIPTION_INACTIVE`. |

Any future SECURITY DEFINER function that creates new tenant-scoped data
must do the same. Adding a SECURITY DEFINER function that inserts without
this check is a regression.

---

## What is NOT locked

These operations always work, regardless of subscription status:

- **SELECT** — all reads. Dashboards, history, reports, activity feeds.
- **UPDATE** — ending a shift, deactivating a guard, revoking a PIN, marking
  a notification read, resolving a session.
- **Payments** — `record_manual_payment_intent`, `confirm_manual_payment`,
  `record_payment_webhook` all work without a subscription. Customers must
  be able to pay to renew.
- **`evaluate_exit`** — exit is always allowed for an active visitor
  (handoff §23: "must not blindly block safe exit of an already-active
  visitor").
- **`evaluate_entry`** — does NOT check subscription. The lock fires at the
  point of authorization creation, not at the gate. An authorization created
  while the org was operational continues to work until its validity ends.
- **`start_shift_session`** — does NOT check subscription directly. The
  cascade works because a lapsed subscription means no new shifts can be
  created, so no Shift IDs exist to start sessions against.

---

## Why this specific enforcement shape

The lock is on INSERT, not on the access engine. Reasoning:

1. `evaluate_entry` and `evaluate_exit` must stay fast and free of
   subscription lookups. Gate operations are on the critical path.
2. The cascade from "no new authorizations" to "gates naturally wind down"
   is gradual and clean. Visitors with valid PINs aren't turned away
   abruptly.
3. Exit is never blocked — critical for safety (§23).

Documented here so future contributors understand **why** the lock is
where it is, not just where.

---

## How to verify the lock still works

Supabase SQL Editor test (staging):

1. Set an org's subscription status to `expired`.
2. As that org's admin, attempt `INSERT INTO gates`.
3. Expect a permission denied error (RLS blocks it).

Any policy listed above that stops rejecting the INSERT is a regression.
