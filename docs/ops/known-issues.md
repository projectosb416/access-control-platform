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

**Current workaround:** Manual SQL run by an operator with Supabase access:

    update public.access_sessions
       set status = 'completed',
           exited_at = now(),
           gate_exited_id = <gate>,
           closed_by_event_id = gen_random_uuid()
     where organization_id = <org>
       and status = 'open';

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
