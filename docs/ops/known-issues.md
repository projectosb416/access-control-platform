# Known Issues

**Purpose:** operational and engineering gaps that are known, documented,
and not yet fixed. Each entry carries severity, impact, current workaround,
and target phase. This file is the tracker — GitHub Issues are not used.

**Severity legend:**
- **Critical** — blocks launch. Do not ship without fixing.
- **High** — real operational risk. Fix before first paying customer.
- **Medium** — degrades quality or increases manual work. Fix in the
  normal course of building the affected feature.
- **Low** — cosmetic or minor. Fix when convenient.

---

## Issue 1 — Unresolved sessions require manual SQL

**Severity:** High
**Area:** Operations
**Found:** 2026-09-25 during the Phase 9 Guard ENTRY browser test

**Addressed by:** Admin-lite attention view (`app/admin/(app)/activity/activity-client.tsx`) — calls `mark_session_unresolved()` for stale sessions and `resolve_session()` for unresolved ones. See migration 0014.

**Symptom:** When a visitor enters but never scans out, the access_session
remains `open`. A second entry attempt by the same person returns
`UNRESOLVED_VISIT` (correct — the concurrency rule is enforced). But the
only way to clear the stale session today is a manual SQL `UPDATE` against
`access_sessions` on the correct environment.

**Why it matters:** Real estates will accumulate stale open sessions as a
matter of routine — visitors leave without scanning out, guards go off
shift without an exit scan, network failures happen mid-visit. Each one
needs manual SQL to resolve. At scale, that's operational debt accumulating
daily.

**Current workaround:** Use the sanctioned RPC:

    select public.resolve_session(
      p_organization_id := '<org>',
      p_session_id      := '<session>',
      p_reason          := 'manually resolved — session resumed via sanctioned path',
      p_notes           := null
    );

The direct-UPDATE workaround (removed from this doc 2026-10-08) wrote
`status='completed'`, hiding the session from unresolved-session
surfaces. The sanctioned `resolve_session()` writes `status='unresolved'`
+ metadata, matching the intended semantics.

**Permanent fix:** Admin-facing "Unresolved sessions" view. The Postgres
function `resolve_session()` already exists (migration 0014) and enforces
the correct semantics — status stays `unresolved`, resolution metadata is
added. What's missing is the UI and an endpoint to invoke it.

**Target phase:** Phase 9 (Admin slice) or Phase 10.

**Impact if not fixed:** Operating the platform requires SQL access for
routine resolution. Blocks scaling past the first couple of customers.

---

## Issue 2 — Middleware convention deprecated in Next 16

**Severity:** Low
**Area:** Framework
**Found:** 2026-09-25 during a build

**Symptom:** Next.js 16 deprecation warning during every build:

    ⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.

**Why it matters:** It's currently a warning, not an error. A future Next.js
major version will make it an error. Not urgent, but loses value the longer
it sits unaddressed.

**Current workaround:** None needed. Warning is ignored.

**Permanent fix:** Run the official codemod:

    npx @next/codemod@canary middleware-to-proxy .

Renames `middleware.ts` → `proxy.ts`, function name `middleware` → `proxy`.
Mechanical change, low risk. Should be followed by a smoke test against the
deployed Worker to confirm no behavioral change.

**Target phase:** Any upcoming cleanup block. Can be done in isolation.

**Impact if not fixed:** Eventually blocks Next.js upgrades.

---

## Issue 3 — Lint warnings in older files

**Severity:** Low
**Area:** Code quality
**Found:** 2026-09-25 during routine lint runs

**Symptom:** Two lint warnings on every CI run:

1. `app/api/guard/entry/route.ts:25` — `PIN_LENGTH` assigned but never used
2. `workers/pin-hash-test/src/index.ts:163` — anonymous default export

**Why it matters:** Noise. Lint warnings hide real issues when they become
too common to notice. Neither is currently a bug.

**Current workaround:** None. Warnings are tolerated.

**Permanent fix:**
1. Delete the unused `PIN_LENGTH` constant.
2. Extract the anonymous default export in the test worker into a named
   const, then export.

**Target phase:** Any upcoming cleanup block. Small.

**Impact if not fixed:** Erodes signal-to-noise in lint output.

---

## Issue 4 — Sentry alert thresholds use defaults

**Severity:** Medium
**Area:** Observability
**Found:** 2026-09-25 during Sentry verification

**Symptom:** Sentry fires an email on every new issue. No grouping, no
threshold, no severity routing.

**Why it matters:** Once real traffic exists, this becomes alert fatigue —
the classic "we stopped reading Sentry emails weeks ago" failure mode.

**Current workaround:** Accept the noise during pre-launch.

**Permanent fix:** Configure Sentry alert rules:
- Group similar errors by fingerprint
- Only alert when an issue repeats N times in M minutes
- Route by severity — high-priority errors to email, low to daily digest

**Target phase:** Phase 11, before launch.

**Impact if not fixed:** Alerts become noise and get ignored by the time
they matter most.

---

## Issue 5 — `eu-west-1` may be a latency compromise

**Severity:** Low
**Area:** Infrastructure
**Found:** 2026-09-25 during production Supabase setup

**Symptom:** Production Supabase project is in `eu-west-1` (Ireland).
Supabase has no African region. First market is Nigeria. Latency from
Lagos is approximately 90ms round-trip.

**Why it matters:** 90ms is acceptable for most operations but noticeable
on the guard's PIN-entry feedback loop. Not blocking, but worth revisiting
when real usage data exists.

**Current workaround:** None. Choice documented in this file.

**Permanent fix:** Evaluate Cloudflare's African edge presence, or a
Supabase read replica in a closer region, once real usage exists and
latency is measurable. Multi-region is a Phase 11 concern already.

**Target phase:** Phase 11.

**Impact if not fixed:** Higher latency for the primary market. Acceptable
for v1, not for v2 at scale.

---

## Issue 6 — Tablet and Wall device-class ports not built

**Severity:** Low
**Area:** Product
**Found:** 2026-09-25 during Phase 9 first slice closure

**Symptom:** Guard ENTRY is proven on Handheld only. Tablet port deferred
because its composition requires a second data column that doesn't exist
yet. Wall port is invalid — Wall is read-only ambient per
`docs/phase-8/device-classes.md`, and Guard ENTRY is interactive by
definition. Wall's actual need is a status display, not an input surface.

**Why it matters:** The device-class abstraction is documented but not yet
exercised beyond one class. Porting would prove the abstraction holds
before more journeys depend on it.

**Current workaround:** Phone layout centred on wider screens.

**Permanent fix:**
- **Tablet:** port ENTRY once the "recent activity for this gate" data
  feed exists. That feed is a Phase 9 or 10 build (activity feed slice).
- **Wall:** build a separate read-only Gate Status display — different
  surface, not a port of ENTRY.

**Target phase:** Phase 9 or 10, depends on activity-feed work.

**Impact if not fixed:** The device-class doc remains theoretical beyond
Handheld. Low operational impact.

---

## How to add an issue

1. Copy the format above.
2. Severity must be one of: Critical, High, Medium, Low.
3. Current workaround must be concrete — "run this SQL" or "accept the risk"
   or "no workaround". Not "TBD".
4. Target phase must be a specific phase, not "later".

If the workaround is "run SQL against production", severity is at least High.

---

## Issue 7 — Endpoint filter hid terminal-state credentials

**Severity:** High
**Area:** API correctness
**Found:** 2026-09-26 during Guard ENTRY/EXIT browser testing
**Fixed:** 2026-09-26 (commit — "fix(api): include terminal-state credentials in lookup")

**Symptom:** Both `/api/guard/entry` and `/api/guard/exit` filtered the
credential lookup to live statuses only (`.in('status', ['created','active',
'in_use'])`). When a visitor's credential was `consumed` or `revoked`, the
lookup returned zero rows and the guard saw `INVALID_PIN` — a wrong and
misleading result code. The correct code (`ONE_TIME_ALREADY_CONSUMED`,
`REVOKED_AUTHORIZATION`, `EXPIRED_AUTHORIZATION`) was being returned by
the database function; the endpoint was hiding it before the function ran.

**Why it matters:** the guard relays the label to the visitor, who relays
it to their host. `INVALID PIN` says "check the PIN you sent." `ALREADY
USED` says "that visit is complete." Different next steps. A guard
sending the wrong signal wastes everyone's time.

**Fix applied:** removed the `.in('status', ...)` filter from both
endpoints and added `.order('created_at', { ascending: false })` so the
newest credential wins when a live and terminal one share a lookup_key.

**Class of bug to watch:** endpoint-level filtering around a
SECURITY DEFINER function that already handles the same condition
correctly. The database was right; the wrapping code was wrong. Any
future endpoint that pre-filters before calling a decision function
should be reviewed for the same pattern.

---

## Issue 8 — Fixture validity windows expire mid-testing

**Severity:** Low
**Area:** Testing infrastructure
**Found:** 2026-09-26 during repeated ENTRY/EXIT testing

**Symptom:** The e2e fixture's authorization is set to `valid_until =
now() + 3 hours` at revival. Long testing sessions exceed that window
and begin returning `EXPIRED_AUTHORIZATION`, blocking further test cycles
until the fixture is refreshed.

**Why it matters:** friction, not a bug. Real authorizations have
admin-set windows of realistic durations; the fixture uses short windows
by accident of when it was created.

**Current workaround:** Run the fixture revival SQL again to extend the
window.

**Permanent fix:** Change the fixture revival SQL to set a 30-day
validity window so multi-day testing sessions do not expire mid-test.

**Target phase:** Next time the fixture SQL is touched.

---

## Issue 9 — Endpoint-level integration test coverage is thin

**Severity:** Medium
**Area:** Testing
**Found:** 2026-09-26 as a consequence of Issue 7

**Symptom:** Our 7 pgTAP test files cover the database functions
thoroughly (~65 assertions). They do not cover the Worker endpoints
that wrap those functions. Issue 7 was exactly this gap: the DB
function was correct, the endpoint filtered out the data before
calling it, and no test caught the mismatch.

**Why it matters:** a class of bug exists at the seam between endpoint
and database — the endpoint's input shaping, its filter choices, the
order it calls things in. Unit tests on either side don't see it.

**Current workaround:** Manual browser testing on each endpoint change.

**Permanent fix:** Add integration tests that hit the deployed Worker
with real requests and assert the response codes. Likely a Vitest suite
running against a preview deployment, or a `test-e2e` CI job. Design
belongs in Phase 10.

**Target phase:** Phase 10 (Testing).

---

## Issue 10 — Guard device enrolment uses raw UUID input

**Severity:** Low
**Area:** Product / UX
**Found:** 2026-09-26 during Journey 1 completion

**Symptom:** The guard login screen asks for the estate UUID as free
text. Real guards cannot be expected to type or remember a UUID. The
correct flow is a short admin-generated code (e.g. `EST-2847`) that the
guard enters once; the device stores the resolved org id from then on.

**Why it matters:** the current input works for testing, not for
onboarding a real guard. But it is not blocking anything else — the
login screen has been proven to work when the code is known.

**Current workaround:** guard device is pre-seeded with the estate UUID
by whoever sets up the device.

**Permanent fix:** Admin generates short-lived enrolment codes from
the admin dashboard. Guard redeems on first visit. Design is already
captured in `docs/phase-7/guard-auth-model.md`.

**Target phase:** When the Admin journey is built. The enrolment flow
is two-sided (admin generates, guard redeems) and cannot be properly
built without the admin side.

**Decision on record:** Journey 1 (Guard) is closed with this as an
explicit deferral, not a forgotten piece.

---

## Issue 11 — /admin/setup allows creating a second organization

**Severity:** Medium
**Area:** Product / UX
**Found:** 2026-09-26 during Admin-lite item 2 testing

**Symptom:** `/admin/setup` checks only for an authenticated session, not
for an existing organization membership. An admin who already has an
organization can navigate to `/admin/setup` directly and successfully run
`setup_organization()`, creating a second organization under the same
account.

**Why it matters:** not a security bug — RLS and the database function
both behave correctly. It is a UX bug: a confused admin could accidentally
create multiple orgs and be unsure which is theirs. Also clutters the
`organizations` table with ghost entries.

**Current workaround:** none. Requires discipline on the admin's part.

**Permanent fix:** the `/admin/setup` Server Component adds a membership
check before rendering the wizard. If the account already has an active
membership, redirect to `/admin`. This mirrors what `/admin` already does
for the no-membership case — closing the loop in both directions.

**Target phase:** Admin-lite item 3 or a small cleanup commit.

**Test to add when fixed:** Sign up → complete setup → navigate directly
to `/admin/setup` → expect redirect to `/admin`, no second org created.

---

## Issue 12 — Expired guest PINs remain status='active' until a manual status-flip

**Severity:** Low
**Area:** Data integrity / display
**Found:** 2026-09-28 during 4a.iii (guest PIN list) design

**Symptom:** When a guest PIN's `valid_until` passes, nothing flips
`status` from `'active'` to `'expired'`. The DB correctly rejects the
PIN at the gate (`evaluate_entry` returns `EXPIRED_AUTHORIZATION`), but
the row's status column remains stale at `'active'`.

**Why it matters:** the resident-facing list filters by
`valid_until > now()`, so an expired PIN does not falsely show as live
(see `list_guest_pins_for_unit`, migration 0051). But any future report
that counts `status = 'active'` rows would include expired entries.

**Current workaround:** every query that needs "currently usable" must
also filter `valid_until > now()`. The list RPC does this via branch A
of its filter.

**Permanent fix:** a scheduled job (pg_cron or a Cloudflare Cron Trigger
hitting a maintenance endpoint) that runs:

    update public.authorizations
       set status = 'expired'
     where status = 'active'
       and valid_until <= now();

    update public.access_credentials
       set status = 'expired'
     where status = 'active'
       and authorization_id in (
         select id from public.authorizations where status = 'expired'
       );

Order matters: flip the authorization first, then the credentials via
join, so the credential update is scoped to the same transaction.

**Target phase:** Phase 11, alongside subscription-expiry cron work.

**Impact if not fixed:** discipline burden — every "is it live" check
must remember both predicates. Not a data bug.

---

## Issue 13 — Guest PIN endpoint rate limit is 20/hour; product intends 10/day

**Severity:** Medium
**Area:** Product / abuse prevention
**Found:** 2026-09-28 after `POST /api/resident/guest-pin` shipped (bb4bc4a)
**Step 1 fixed:** 2026-09-29 (commit `5e0dcf5`) — constant changed from `MAX_PINS_PER_HOUR = 20` with a 60-minute window to `MAX_PINS_PER_DAY = 10` with a 24-hour window. Step 2 (entitlement-based threshold from `plan_entitlements`) remains deferred.

**Symptom:** the endpoint uses `MAX_PINS_PER_HOUR = 20` with a 60-minute
window. Product intent (confirmed 2026-09-28) is 10 per day per resident,
scaleable by the org's subscription plan. 20/hour = 480/day worst case —
roughly 48x the intended limit.

**Why it matters:** a compromised resident account could generate 480
live credentials per day. Every one is a permanent row in
`authorizations` and `audit_events` (both append-only per Locked
Decisions). Cost: DB growth, plus pressure on the credential lookup
space.

**Current workaround:** none. The endpoint is more permissive than the
product intends.

**Permanent fix — two steps:**

1. **Correct the constant now.** Change `MAX_PINS_PER_HOUR = 20` to
   `MAX_PINS_PER_DAY = 10`, window = 24 hours. One file, small commit.
2. **Migrate to entitlements.** Move the check into `rate_limit_attempt`
   as a fourth scope (`resident_pin_creation`), reading the threshold
   from the org's plan via `rate_limit_attempt_for_org`. Same pattern
   the guard endpoints use. Requires a plan entitlement key
   (`max_guest_pins_per_day`).

**Target phase:** step 1 next session; step 2 Phase 10/11 (with
entitlements). Do not bundle step 2 with step 1 — the entitlement key
may not exist yet.

**Impact if not fixed:** abuse surface larger than designed. Not a
privilege escalation — resource exhaustion only.

---

## Issue 14 — Supabase CLI pinned at 2.34.3; upstream is 2.118.0

**Severity:** Low
**Area:** Tooling
**Found:** 2026-09-28 during CI runs

**Symptom:** every CI run logs:

    A new version of Supabase CLI is available: v2.118.0 (currently installed v2.34.3)

**Why it matters:** the pinned version works, but the gap is 84 minor
releases. Each release can add flags, fix bugs, or change defaults. A
surprise forced upgrade during a critical schema migration is worse than
a planned one.

**Current workaround:** none needed. Pinned version applies migrations
cleanly and runs `test db` green.

**Permanent fix:** review the CLI changelog between 2.34.3 and 2.118.0
for behavioral changes affecting `supabase db push` and `supabase test
db`. Upgrade in an isolated commit — no other code changes — so any
regression is attributable. Verify with a full CI run before continuing
any feature work.

**Target phase:** Phase 10 or 11, ideally before a schema-heavy phase.

**Impact if not fixed:** technical debt accumulating silently. Risk of
a forced upgrade at an inconvenient moment.

---

## Issue 15 — Error-to-HTTP mapping duplicated across route handlers

**Severity:** Low
**Area:** Code quality
**Found:** 2026-09-28 after the resident guest PIN endpoints were added

**Symptom:** every API route that calls a Postgres function contains its
own copy of two helpers, `extractDbErrorCode(message)` and
`statusForCode(code)`. Currently duplicated in:

- `app/api/guard/entry/route.ts`
- `app/api/guard/exit/route.ts`
- `app/api/guard-session/start/route.ts`
- `app/api/resident/guest-pin/route.ts`
- `app/api/resident/guest-pin/revoke/route.ts`

Each copy has a different `KNOWN_CODES` list, scoped to the errors its
function can raise.

**Why it matters:** the canonical source of truth is
`docs/phase-7/error-http-mapping.md`, and the mapping is deterministic.
Five copies means five drift opportunities. Adding a new code requires
updating every route whose function can raise it — a discipline the next
developer has to know about.

**Current workaround:** manual review — each file's list is checked
against its function's `raise exception` statements at write time.

**Permanent fix:** extract to `lib/api/error-mapping.ts` with a single
`mapErrCodeToStatus(code)` covering the full doc. Each route imports
it. The trade-off — a route "knows" about codes its function cannot
raise — is acceptable because unknown codes default to
`500 SYSTEM_UNAVAILABLE` and `extractDbErrorCode` matches on substrings
anyway.

**Target phase:** Phase 10.

**Impact if not fixed:** a code added to a function but forgotten in
its route's list silently maps to 500 instead of the correct 4xx.

---

## Issue 16 — authorizations_insert_primary_resident uses the same row-scoped shape as the dropped UPDATE policy

**Severity:** Medium
**Area:** Security / RLS
**Found:** 2026-09-28 during migration 0053 (drop of authorizations_update_primary_resident)
**Fixed:** 2026-09-29 (commit `0d0935e`) — policy dropped via migration 0055. Verified safe before drop (no TS writes; only SQL insert path is SECURITY DEFINER; pgTAP fixtures run as DB owner; no other policy consumers).

**Symptom:** the INSERT policy `authorizations_insert_primary_resident`
has the same structural shape as the UPDATE policy dropped in 0053. It
scopes by row — `scope_unit_id = current_occupied_unit_id(organization_id)`
— but not by column. A resident could INSERT an authorization with
arbitrary values, provided it names a unit they occupy.

**Why it matters:** the exploit surface is narrower than the UPDATE
case. A client cannot create a matching credential because
`access_credentials` has zero RLS policies — it is service-role-only
by design. So a resident could pollute the `authorizations` table with
fake rows, but could not produce anything the gate would accept.

That is data-integrity pollution, not privilege escalation. Still worth
fixing because audit queries and future reports assume `authorizations`
reflects reality.

**Current workaround:** none. The pollution is possible but has no
operational effect visible to a guard or a resident today.

**Permanent fix:** same pattern as the 0053 UPDATE fix — drop the policy
and route resident-side inserts through the existing SECURITY DEFINER
function `create_guest_pin_for_unit` (0050), which validates every field
and enforces the subscription lock. Before dropping, verify with grep
that no code path relies on client-side INSERT to `authorizations`.

**Target phase:** Phase 10, alongside the endpoint integration test gap
(Issue 9).

**Impact if not fixed:** theoretically pollutable table. Practically,
only a malicious client or an accidentally buggy one triggers it.

---

## Issue 17 — Pre-push checklist omits the test gate

**Severity:** Low
**Area:** Process / documentation
**Found:** 2026-09-28 during the 4a resident-journey work

**Symptom:** HANDOFF.md §2 rule 10 reads "Nothing stages until lint +
typecheck + build pass locally." The CI `verify` job runs lint +
typecheck + test + build. Locally, the test step
(`npm test` = vitest, 18 tests under `tests/unit/`) was repeatedly
skipped — local runs proved only 3 of the 4 gates.

**Why it matters:** a local test failure would not be caught pre-commit;
it would surface in CI. The gap is invisible while tests pass, but
"passed locally" was not the full claim it appeared to be.

**Current workaround:** commits still go through CI, so nothing broken
shipped. The gap is in local verification completeness, not correctness.

**Permanent fix:** update HANDOFF.md §2 rule 10 to read "lint +
typecheck + test + build." Add the note that `npm test` runs vitest in
watch mode on an interactive terminal and must be invoked as
`npm test -- --run` (or `npm run test:run`) to exit after one pass.

**Target phase:** any upcoming cleanup. Small doc-only change.

**Impact if not fixed:** local verification remains incomplete relative
to CI. A local-only test regression still gates at CI, but consumes a
CI cycle that could have been avoided.

---

## Issue 18 — notifications_update_self_read policy shape

**Severity:** Medium
**Area:** RLS / policy
**Found:** 2026-09 (see continuity §8 for the class precedent)
**Status:** Open. Detail pending — see below.

**Symptom:** The `notifications_update_self_read` policy uses the same
row-scoped shape that was already dropped for two other tables:

- `authorizations_update_primary_resident` — dropped in migration 0053
- `authorizations_insert_primary_resident` — dropped in migration 0055

Row-scoped policies on tenant tables that allow any client-side write
are a bug: an RLS policy cannot restrict which columns an UPDATE
changes. A "self read" flag on notifications, if updatable by the
resident through this policy, could be paired with other column writes
that the policy does not intend to permit.

**Why it matters:** Same class as the two policies already removed. If
left in place, the pattern persists and future contributors may treat
it as precedent.

**Permanent fix:** Drop `notifications_update_self_read` and route the
write through a SECURITY DEFINER function, matching the shape of the
0053/0055 replacements.

**Detail pending:** The specific write path (which columns are updated,
under what conditions, by which client surface) is not yet documented
in this entry. Full details to be captured in the Phase 10 slice that
drops the policy, mirroring the 0053/0055 handling.

**Target phase:** Phase 10.

**Impact if not fixed:** Resident-side UPDATE on `notifications`
remains row-scoped without column restrictions, contrary to the
established RLS shape lesson (continuity §6).

---

## Issue 19 — Household members get NOT_AUTHORIZED on read RPCs

**Severity:** Low
**Area:** Product / UX
**Found:** 2026-10-02 during 4c (household section) close-out

**Symptom:** A household member who redeems an invite and logs in
reaches the resident dashboard, but three read RPCs reject them:

- `list_guest_pins_for_unit` (0051)
- `list_unit_visits` (0056)
- `list_household_members` (0057)

All three check `is_primary_resident_of_unit` via an active
occupancy row. Household members have no occupancy — their membership
lives in `household_members`. Result: each RPC raises NOT_AUTHORIZED;
the page catches non-fatally and renders empty sections.

**Why it matters:** household members are authenticated principals
(they log in, they have accounts). Seeing an empty dashboard for their
own unit is confusing, and the sections that should be most useful to
them (household roster, visits to the shared unit) are the ones that
fail.

**Current workaround:** none. The dashboard shell renders cleanly; the
content is empty. No security exposure — the RPCs are correctly
refusing access, they just don't yet have the household-member path.

**Permanent fix — extend three RPCs:**

- `list_unit_visits` — permit household-member read of the unit's
  visits. They co-occupy; the information is theirs to see.
- `list_household_members` — permit household-member read of the
  roster they belong to.
- `list_guest_pins_for_unit` — permit household-member read filtered
  to `created_by = current_account_id()`. Mirrors the existing RLS
  policy `authorizations_select_household_member` which already scopes
  this way.

Each RPC's residency predicate changes from "active occupancy exists"
to "active occupancy exists OR active household_members row exists",
with the guest-PIN case adding the created_by filter.

**Target phase:** next resident-adjacent slice. Small — three
migration-wrapped function replacements, one pgTAP addition.

**Impact if not fixed:** household membership works for the primary
resident (invite, list, remove) but household members themselves
experience a hollow dashboard. Feature is half-built from their
perspective.

---

## Issue 20 — generate_unit_invite does not cross-check household_members for hash collisions

**Severity:** Low
**Area:** Data integrity
**Found:** 2026-10-02 during 4c review

**Symptom:** `generate_unit_invite` (migration 0045) checks new invite
codes for collisions against `occupancies.invite_code_hash` only.
`generate_household_invite` (migration 0057) checks against both
`household_members` and `occupancies`. The unit-invite path is
asymmetric — it could theoretically emit a code that already exists as
a live household invite.

**Why it matters:** the alphabet is 31 chars over 8 positions
(~852 billion), so the collision probability is negligible. But the
two invite generation paths should be structurally identical, and
right now one checks two tables while the other checks one.

**Current workaround:** none. No observed collisions.

**Permanent fix:** `create or replace function
public.generate_unit_invite(...)` — same body as 0045, with the
collision check widened to a `union all` across
`household_members.invite_code_hash` and
`occupancies.invite_code_hash`. Same shape as 0057's generator.
Single migration, ~5 lines changed.

**Target phase:** any upcoming DB cleanup. Small.

**Impact if not fixed:** structurally asymmetric — not a live bug.
Resolving it removes a class of "why do these two functions differ"
questions from future review.

---

## Issue 21 — EXIT is strictly server-bound; no offline fallback

**Severity:** Medium
**Area:** Product / safety / operations
**Found:** 2026-10-08 during Task Q recon

**Symptom:** EXIT requires a server round-trip at three points:

1. `verifyPinAgainstPhc` — PBKDF2-HMAC-SHA256 against a server-held
   pepper and the stored PHC hash (route: `app/api/guard/exit/route.ts`).
2. `evaluate_exit` — RPC; all state validation lives in Postgres.
3. `logAppEvent` — writes an `access_events` row for every attempt.

If the guard device cannot reach the Worker, none of the three can run.
The guard device falls back to `SYSTEM_UNAVAILABLE` (same copy as a
server-side 503). No retry, no queue, no cache.

**Why it matters:** the guard is a human — a gate opens manually if the
network is down. What fails is the *record*: no `access_events` row,
no exit timestamp, and the `access_sessions` row stays `open` until
manually reconciled. A burst of unresolved sessions during an outage
also masks genuine anomalies in the same signal.

**Current workaround:** none. Guards open gates manually; sessions
accumulate as `open`; operator reconciles via the admin attention view
or `resolve_session()`.

**Permanent fix:** not attempted — and not recommended. Any offline
EXIT that accepts a 6-digit PIN without server verification either
trusts every entry or rejects every entry; neither is a real
verification. Same reasoning rules out offline ENTRY (rate limits,
authorization windows, credential lookup all live server-side). The
correct posture is:

1. Guard-device copy that distinguishes "network unreachable" from
   "server error" — currently both render `SYSTEM_UNAVAILABLE`.
2. A defined operator procedure for reconciling unresolved sessions
   that grew during an outage — see Issue 1.

**Target phase:** copy + procedure refinement — any upcoming UX pass.
Offline verification: not planned.

**Impact if not fixed:** during an outage, exits are recorded as
unresolved sessions rather than as clean exits. The unresolved-session
queue grows, and manual reconciliation cost scales linearly with
outage length. Not a security hole — the human guard retains physical
control — but a real operational cost.

