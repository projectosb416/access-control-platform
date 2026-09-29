# Access Control Platform — Working Handoff

**Purpose:** self-contained context for a fresh AI session. Paste the
contents of this file as the first message to bring a new assistant fully
up to speed. Update the appended milestones at the bottom at each phase
transition.

---

## 1. PROJECT

A general-purpose physical access control platform for residential
estates, apartment buildings, homes, offices. Guards process gate
entry/exit using 6-digit PIN credentials issued to visitors, vendors,
contractors, residents. Organizations manage their own people, properties,
units, gates, guards, shifts. Server-authoritative. Every attempt logged.
No fabricated exits.

**Canonical physical-access chain:**
Person → Authorization → Credential/PIN → Access Session → Access Event.

**Primary reference documents (in repo):**
- `docs/phase-7/` — service architecture (guard auth, error mapping,
  idempotency, Supabase clients)
- `docs/phase-8/` — operational states, device classes
- `docs/ops/` — production migrations, subscription lock, pepper recovery,
  known issues, enhancements

---

## 2. WORKFLOW — NON-NEGOTIABLE

This discipline has caught four production-class bugs so far. Do not skip.

### Core rules
1. **One step at a time.** Never bundle. Each step is stated, run, verified.
2. **Verify before commit.** Structural checks (head/tail, grep counts,
   `wc -l`, exact string matches) before staging.
3. **Surgical edits.** `sed` or targeted Node scripts for one-line changes.
   Full-file rewrite only for new files or when the whole file changes.
4. **Never guess at flags or versions.** Check `--help` or releases page.
5. **Flag conflicts before acting.** Name contradictions to locked decisions.
6. **Plain language for product decisions.** The user is the product owner,
   not a database engineer. Ask in real-world scenarios.
7. **Commit and push are separate messages.** Never same-line. Prevents
   "commit skipped, push pushed nothing" failure.
8. **When something fails, diagnose first.** Run a diagnostic that produces
   visible output. Never guess the fix.
9. **Trace through behavior before calling something a bug.** False alarms
   waste cycles.
10. **Nothing stages until lint + typecheck + test + build pass locally.** CI's verify job runs all four; local runs must match. Note: `npm test` runs vitest in watch mode on an interactive terminal — use `npm test -- --run` (or `npm run test:run`) to exit after one pass. On Termux specifically, the default `forks` vitest pool can time out under memory pressure — use `npm test -- --run --pool=threads` locally. CI runs the default pool on Ubuntu runners and is unaffected.

### Secrets discipline
- **Never paste a secret into chat.** Not even partial. Rotate if it happens.
- Use `cut -d: -f1,2` on credentials files — never `cat` (leaks tokens).
- Every secret saved in user's password manager BEFORE use.
- CI must use `printf '%s'`, never `echo`, piping to `wrangler secret put`.
  Echo appends `\n` and corrupts the value silently.

### Definition of done
- Local: lint, typecheck, test, build all pass.
- Remote: CI green on GitHub Actions, on the specific commit SHA.
- Deployed (if relevant): hitting the real URL returns expected result.
- Migration: applied to staging, function actually tested by calling it.
- Worker: deployed URL exercised with a real HTTP request.

---

## 3. ENVIRONMENT

| Item | Value |
|---|---|
| Dev host | Termux on Android ARM64 (user's phone) |
| Node | 24.x (pinned in `.nvmrc`, `package.json` engines, CI) |
| Framework | Next.js 16.3.5, **Webpack** (not Turbopack) |
| React | 19.2.8 |
| UI | shadcn/ui — Base UI primitives, Nova style, neutral base |
| Backend | Supabase (Postgres + Auth + RLS) — staging + production |
| Deploy | Cloudflare Workers via `@opennextjs/cloudflare` |
| Repo | github.com/projectosb416/access-control-platform (private) |
| Main URL | https://access-control-platform.projectosb416.workers.dev |
| Test worker | https://access-control-platform-pin-hash-test.projectosb416.workers.dev |

**Supabase projects:**
- Staging: `access-control-platform-staging`, eu-west-1
- Production: `access-control-platform-production`, eu-west-1

**GitHub Secrets configured (16 total):** CLOUDFLARE_API_TOKEN,
CLOUDFLARE_ACCOUNT_ID, PIN_PEPPER, TEST_AUTH_TOKEN, SUPABASE_URL,
SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PROJECT_REF,
SUPABASE_DB_PASSWORD, SUPABASE_ACCESS_TOKEN, SENTRY_DSN,
PRODUCTION_SUPABASE_URL, PRODUCTION_SUPABASE_ANON_KEY,
PRODUCTION_SUPABASE_SERVICE_ROLE_KEY, PRODUCTION_SUPABASE_PROJECT_REF,
PRODUCTION_SUPABASE_DB_PASSWORD

**Git credentials:** per-repo file at
`~/.git-credentials-access-control-platform`. Global file used by another
project. Do not touch the global file.

---

## 4. LOCKED ARCHITECTURAL DECISIONS

Do not re-litigate without explicit reopening.

### Identity
- Person ≠ Account. Visitors never need accounts to receive a PIN.
- `people` is org-scoped. Same human in two orgs = two rows.
- Fixed roles: admin, guard, primary_resident on organization_memberships.
- Platform admins in their own table, above the tenant boundary.
- Primary Resident = active occupancy row, not a membership role flag.

### Access engine
- 6-digit PIN is a credential, not identity.
- ENTRY/EXIT always explicitly selected. No inference.
- Exit gate may differ from entry gate (§18). Both recorded.
- Atomic state changes via SECURITY DEFINER Postgres functions.
- Idempotency via `idempotency_key`, unique per org on access_events.
- Append-only access_events and audit_events. No UPDATE/DELETE policies.
- audit_events also has an immutability trigger (UPDATE/DELETE/TRUNCATE
  all raise).

### Credentials
- PBKDF2-HMAC-SHA256, 100,000 iterations (Workers platform cap).
- 16-byte salt, 32-byte pepper, `pepper || pin` before derivation.
- PHC format in one column: `$pbkdf2-sha256$i=100000$<salt_b64>$<hash_b64>`.
- `pepper_version` per credential — enables future rotation.
- `lookup_key` = HMAC-SHA256(pepper, "org:<org_id>:pin:<pin>").
- RLS on access_credentials: zero policies. Service-role only.

### Rate limiting
- Sliding window with 10-second buckets + explicit lockout.
- Three scopes: credential, gate, guard.
- Single atomic call — `rate_limit_attempt()`. Not Worker-orchestrated.
- RLS: zero policies. Service-role only.
- Thresholds read from plan entitlements via `rate_limit_attempt_for_org()`.

### Shifts and gates
- Design A: shift has a gate. Admin creates shift → select gate → time
  window → shift_code generated.
- Gate capacity is concurrent, set per gate by Admin, limited by plan.
- Guard enters Shift ID + Guard ID to start.
- Moving between gates requires ending the current shift session.
- Guard cannot log in without a Shift ID. If subscription lapsed → no new
  shifts → no Shift IDs → guards cannot start.

### Guard auth model
- Shift-scoped session. 32-byte random token, SHA-256 hash stored in
  Postgres, raw token as HttpOnly cookie.
- Five hardenings: token bound to shift_session row, bound to gate,
  256-bit entropy, only hash in DB, rate-limited per guard.
- 24-hour cookie Max-Age is upper bound. Shift status is real bound.
- No rotation in v1. One token per shift session.
- Re-auth on same shift (device swap, phone wipe) reuses the session,
  hash overwritten, old token dead.

### Guard device model
- Personal phone is primary. No shipped hardware.
- Shared gate device works incidentally but is not a designed mode.
- Guard login: estate code + shift code + guard code (device stores
  only org_id).
- Guard IDs auto-generated on creation (GU-XXXXXX).
- Guards have NO account. Auth is shift code + guard code.

### Commercial
- Per month, billed yearly. Price as total-charged amount in minor units
  + billing_cycle_months=12.
- Plans editable, seeded initially. Entitlements are key-value.
- Subscription history preserved. One row per plan period.
- Provider-agnostic. Provider is free-text ("paystack", "bank_transfer").
- Two payment flows: webhook (auto-activate) and manual bank transfer.
- pending_confirmation status is manual-only.

### Subscription enforcement
- Rule: when org is not operational, NO INSERT on tenant tables.
  SELECT/UPDATE/payments always work.
- Enforced at RLS layer — 12 INSERT policies check is_org_operational.
- Access engine untouched — no subscription check inside evaluate_entry.
- First signup bypasses via setup_organization() (SECURITY DEFINER).
- Reminder cadence: 7 touchpoints in final 30 days (30/23/16/9/5/3/1).
- No grace period. On expiry, restrictions apply immediately.

### Database conventions
- UUIDv7 primary keys (custom public.uuidv7() function).
- snake_case, plural table names.
- timestamptz everywhere, UTC.
- Status columns as text with CHECK constraints, not native enums.
- Partial unique indexes for concurrency rules.
- No hard deletes on tenant tables — archive via status.
- organization_id on every tenant-scoped table.
- set_updated_at() trigger on every table with updated_at.
- Column references in plpgsql qualified with table name when function
  has OUT params with same name (migrations 0032, 0040).

### Device classes (UI)
- Handheld, Tablet, Desk, Wall, Embedded (reserved).
- Guard: Handheld (primary), Tablet (gatehouse), Wall (mounted display).
- Resident: Handheld only.
- Admin: Handheld, Desk, Wall (ambient read-only).
- Composition rules per class in docs/phase-8/device-classes.md.

---

## 5. MIGRATION LEDGER (41 applied, all green)

| # | Name | Purpose |
|---|---|---|
| 0001 | extensions_and_helpers | uuidv7(), set_updated_at(), pgcrypto |
| 0002 | accounts | Auth identities, handle_new_auth_user(), current_account_id() |
| 0003 | organizations_and_memberships | Tenant boundary, is_org_member/admin |
| 0004 | platform_admins | Platform Admin role, is_platform_admin() |
| 0005 | people | Org-scoped individuals |
| 0006 | property_unit_occupancy | Geography, one active occupancy per unit |
| 0007 | gates_and_guard_profiles | Gates, guards, generate_code_for_org() |
| 0008 | shifts_and_sessions | Shifts, sessions, start/end_shift_session |
| 0009 | appointments_and_authorizations | Scheduling + permission layer |
| 0010 | access_credentials | PHC format, zero RLS policies |
| 0011 | access_sessions_and_events | Session lifecycle, append-only events |
| 0012 | access_credentials_lookup_key | O(1) lookup |
| 0013 | evaluate_entry | ENTRY engine |
| 0014 | evaluate_exit_and_resolution | EXIT, mark unresolved, resolve |
| 0015 | notifications | In-app notifications |
| 0016 | alerts | Actionable conditions |
| 0017 | audit_events | Governance log, log_audit_event() |
| 0018 | plans_and_entitlements | Plan catalog, key-value entitlements |
| 0019 | subscriptions | Per-period history, is_org_operational() |
| 0020 | payment_transactions | Provider-agnostic ledger |
| 0021 | payment_functions | 5 payment flow functions |
| 0022 | subscription_enforcement | setup_organization(), lock 12 policies |
| 0023 | rate_limiting | Buckets, lockouts |
| 0024 | audit_enforcement | Immutable trigger, audit calls |
| 0025 | fix_shifts_shift_sessions_rls | Broke RLS recursion |
| 0026 | fix_subscription_supersede | Fixed self-referential FK ordering |
| 0027 | create_authorization | Atomic authorization + credential |
| 0028 | rate_limit_attempt | Atomic wrapper with advisory lock |
| 0029 | shift_session_tokens | Session tokens, resolve_shift_session |
| 0030 | find_event_by_idempotency | Idempotency short-circuit |
| 0031 | household_members | Household + cascading lifecycle |
| 0032 | fix_household_ambiguity | Fixed plpgsql ambiguity |
| 0033 | subscription_expiry_check | Windowed reminders |
| 0034 | idempotency_key_length | 200-char CHECK |
| 0035 | session_token_hash_comment | Comment on SHA-256 choice |
| 0036 | install_pgtap | Testing framework |
| 0037 | rate_limit_entitlements | Thresholds from plan |
| 0038 | fix_shift_reauth_status | Re-auth flips shift to active |
| 0039 | create_guard_with_person | Atomic guard creation |
| 0040 | fix_create_guard_ambiguity | Qualify RETURNING column |
| 0041 | remove_guard_profile | Hard delete with history protection |

**Test files in supabase/tests/:** 01_evaluate_entry, 02_start_shift_session,
03_rate_limit_attempt, 04_create_authorization, 05_evaluate_exit,
06_create_subscription_from_payment, 07_run_subscription_expiry_check.
~65 assertions, run on every push via CI job `test-db`.

---

## 6. CODE STRUCTURE


---

## 7. CI WORKFLOW JOBS

On push to main:
1. `verify` — lint, typecheck, test, build (Next.js)
2. `verify-worker` — OpenNext Worker build
3. `apply-migrations` — Supabase staging
4. `test-db` — pgTAP against staging
5. `deploy-pin-hash-test` — test worker
6. `deploy-main-app` — main Worker to Cloudflare
7. `smoke-test-deployed` — 4 checks against live URL

Manual trigger only:
8. `production-migrations` — applies to production on manual fire
   with confirmation string "apply-to-production"

---

## 8. PHASE STATUS

- **Phase 1-3:** DONE (original handoff)
- **Phase 4 (Security & RLS):** DONE
- **Phase 5 (Schema):** DONE — 41 migrations
- **Phase 5.5 (Hardening):** DONE — subscription auto-expiry, smoke tests,
  DB tests, rate-limit entitlements, idempotency key constraint,
  subscription lock reference, session token docs, Sentry + PII scrub
- **Phase 6 (Env scaffold):** DONE — repo, CI, Cloudflare deploy
- **Phase 7 (Services):** DONE — service boundaries, docs, ENTRY slice
- **Phase 8 (UX dialogue):** DONE — journeys, operational states, device
  classes
- **Phase 9 (Implementation):** IN PROGRESS
  - First slice: Guard ENTRY Handheld ✅
  - Admin-lite: 7/7 ✅ (signup, login, org setup, gates, guards, shifts,
    activity, unresolved sessions)
  - Resident journey ⬜ NEXT
  - Guard device enrolment ⬜ deferred
  - Admin credential search + fix ⬜
  - Command Center ⬜
  - Billing page + payment UI ⬜

---

## 9. KNOWN ISSUES (docs/ops/known-issues.md)

| # | Severity | Summary |
|---|---|---|
| 1 | ~~High~~ | ~~Unresolved sessions required manual SQL~~ RESOLVED |
| 2 | Low | Middleware convention deprecated in Next 16 (rename to proxy) |
| 3 | Low | Lint warnings in older files (PIN_LENGTH unused, anonymous default) |
| 4 | Medium | Sentry alert thresholds at defaults (alert on every new issue) |
| 5 | Low | eu-west-1 latency compromise for Nigeria (90ms) |
| 6 | Low | Tablet and Wall device-class ports not built |
| 7 | High | Endpoint filter hid terminal-state credentials (FIXED) |
| 8 | Low | Fixture validity windows expire mid-testing |
| 9 | Medium | Endpoint-level integration test coverage is thin |
| 10 | Low | Guard device enrolment uses raw UUID input |
| 11 | Medium | /admin/setup allows creating second organization |

---

## 10. ENHANCEMENTS (docs/ops/enhancements.md)

E1 — Animated logo loading spinner (Phase 9/10)
E2 — Animated UI libraries (evaluate, bundle cost)
E3 — Brevo SMTP for email (Phase 11)
E4 — Guard login screen styling polish
E5 — Horizontal scrolling nav (rejected)
E6 — Bulk unit creation from setup wizard
(more accumulate)

---

## 11. ENVIRONMENT PITFALLS (learned the hard way)

- **Turbopack does NOT work on Android ARM64.** Use `--webpack`.
- **`workerd` does not install on Android.** Wrangler + OpenNext are
  CI-only. Never add to package.json dependencies.
- **`esbuild` must be pinned explicitly** in verify-worker install
  (`esbuild@0.25.4`) because --legacy-peer-deps doesn't hoist it.
- **`@types/node` must be ^24** to match Node 24.
- **GitHub Actions secrets must be mapped into `env:` for every step.**
  Referencing $SECRET in run without env: silently produces empty.
- **CI `echo` corrupts secrets** — always `printf '%s'`.
- **Supabase SQL Editor:** no `\gset`, no temp tables across statements,
  raise notice doesn't show (use set_config + final select).
- **RLS testing** requires `set local role authenticated` +
  `set_config('request.jwt.claims', ...)`.
- **.env* glob in .gitignore** ignores .env.example — needs explicit
  `!.env.example`.
- **Shell globs like services/*/.gitkeep** don't expand on Termux — use
  explicit for loops.
- **Bash history expansion (!)** breaks node -e — write to file, run, delete.
- **/tmp is not writable on Termux** — use ~/.
- **Custom Postgres parameter names** for set_config require identifiers
  not starting with digits — `diag.one` not `diag.1`.
- **RLS recursion** between tables with cross-referencing policies — wrap
  cross-table lookups in SECURITY DEFINER helpers.
- **Self-referential FK ordering** — split write into 3 steps.
- **plpgsql OUT-param ambiguity** — RETURNING clauses conflict with
  returns-table column names. Qualify: `table.column`.
- **A migration going green does NOT mean its functions work.** plpgsql
  bodies are validated at call time. Every migration that adds a function
  needs a runtime test that actually invokes it.
- **React 19 purity rule** flags Date.now() during render even in Server
  Components. Fixes: `useState(() => Date.now())` lazy initializer, or
  single-line call with eslint-disable-next-line above it.
- **Supabase FK-name disambiguation** — tables with two FKs to same target
  require explicit FK names in `.select()` join strings.
- **Supabase join typing gap** — string-select with qualified FK names
  returns GenericStringError. Cast through `unknown` to a local interface.
- **GitHub "Repository not found"** on private repo usually means wrong
  credentials, not missing repo. Multiple accounts on one device can
  clobber credentials.
- **GitHub Free doesn't support required reviewers** on private repos for
  Environments. Use workflow_dispatch instead.

---

## 12. APPENDED MILESTONES (chronological)

### Phase 4 — Security & RLS — COMPLETE

Locked at docs/phase-7. Tenant-scope matrix, RLS policies per role,
PBKDF2 at 100k iterations (Workers cap), 16-byte salt + 32-byte pepper,
HMAC lookup_key, rate limiting strategy, transaction/locking approach.

### Phase 5 — Schema — COMPLETE

41 migrations applied. All layers built:
identity, property, operations, access, communication, governance,
commercial, enforcement, rate-limit.

### Phase 5.5 — Hardening — COMPLETE

Subscription auto-expiry (0033), smoke tests in CI, pgTAP tests,
rate-limit entitlements (0037), Sentry integration with PII scrub
verified, production Supabase live with manual migration workflow.

### Phase 6 — Env scaffold — COMPLETE

Termux + Node 24 + Next 16 Webpack, CI on GitHub Actions (7 jobs),
Cloudflare Workers deploy via OpenNext, smoke tests against live URL.

### Phase 7 — Services — COMPLETE

Service boundaries documented, 4 spec docs in docs/phase-7. Guard ENTRY
vertical slice proven end-to-end.

### Phase 8 — UX dialogue — COMPLETE

docs/phase-8/operational-states.md — 13 result codes with tiers/labels
docs/phase-8/device-classes.md — Handheld, Tablet, Desk, Wall, Embedded

### Phase 9 first slice — Guard ENTRY — COMPLETE

Login (estate UUID + shift code + guard code), ENTRY/EXIT mode toggle,
End Shift with confirmation dialog, tier sounds, Web Audio synthesis,
idempotency keys, cookie middleware. Bugs fixed: re-auth shift flip
(0038), endpoint filter hide terminal credentials.

### Phase 9 Admin-lite — COMPLETE

7/7 items:
1. Admin auth (signup, login, logout, route groups)
2. Org setup wizard (4 steps, atomic)
3. Add gate (list + form)
4. Add guard (person + profile atomic, deactivate/reactivate/remove)
5. Create shift (gate + time window, cancel)
6. Activity view (Sessions + Events tabs, Today/Attention/All filters)
7. Attention view (mark unresolved + add note, closes known-issue #1)

Plus: copy-to-clipboard for codes, nav shell (5 items).

Migrations 0039-0041 added. Bugs caught:
- Date.now() purity rule (React 19)
- Supabase FK disambiguation requirement
- plpgsql OUT-param ambiguity (0040)

---

## 13. IMMEDIATE NEXT ACTION

**Resident journey.** Depends on admin invite-code flow, which is
admin-lite-adjacent. Admin issues invite for a unit → resident redeems →
household management + guest PIN generation.

Pieces:
1. Admin unit management UI (currently units exist only from setup wizard)
2. Admin generates unit invite code (short, expiring, single-use)
3. Resident signup via invite code → creates account + person + occupancy
4. Resident dashboard (household, guest PINs, activity)
5. Household member invite (same pattern as unit invite)
6. Guest PIN generation (calls create_authorization_with_credential)

Not yet built for v1:
- Guard device enrolment (short estate code instead of UUID)
- Admin credential search + fix (Scenario 2 support-desk)
- Command Center dashboard
- Billing page + plan selection + payment UI
- Paystack/Flutterwave webhook (pending CAC docs)
- Landing page
- Email verification via Brevo

---

**End of handoff.**
