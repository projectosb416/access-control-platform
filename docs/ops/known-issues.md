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
