# Subscription Cron — Design Note

**Status:** deferred. The function exists and is verified. The scheduled
Worker that calls it daily is not built yet.

**Why deferred:** the Worker needs Cloudflare Cron Trigger configuration,
a new CI deploy job, and its own test against a deployed schedule — all
of which overlap with Tier 1 #3 (production environment setup). Doing it
now would mean building it twice. Building it during Tier 1 #3 means
staging and production get the same infrastructure in one pass.

**What exists today:** public.run_subscription_expiry_check() — a
SECURITY DEFINER function that is fully tested and idempotent. It sends
reminders in the final 30 days of an active subscription, expires lapsed
subscriptions, and writes audit + notifications. Callable manually from
the Supabase SQL Editor, or from any service-role client.

**What is missing:** a scheduled trigger that calls it once per day.

---

## What the Worker will look like

Files:

    workers/subscription-cron/
      wrangler.jsonc
      src/index.ts

wrangler.jsonc — expected shape:

    {
      "$schema": "../../node_modules/wrangler/config-schema.json",
      "name": "access-control-platform-subscription-cron",
      "main": "src/index.ts",
      "compatibility_date": "2025-03-01",
      "compatibility_flags": ["nodejs_compat"],
      "triggers": {
        "crons": ["0 6 * * *"]
      }
    }

Runs daily at 06:00 UTC. Chosen to fire after midnight in West Africa
(UTC+1) but before business hours — reminders are waiting when admins
open the app.

src/index.ts — expected shape:

- On scheduled event (not fetch), call run_subscription_expiry_check()
  via the Supabase service-role client.
- Log the returned reminders_sent and subscriptions_expired counts to the
  Worker console (visible in Cloudflare's log stream).
- On error: log the full error, do not retry. The next day's run is
  already scheduled and idempotent, so a one-day miss self-heals.

Environment secrets the Worker will need:

- SUPABASE_URL — same value already in GitHub Secrets
- SUPABASE_SERVICE_ROLE_KEY — same value already in GitHub Secrets
- (Not NEXT_PUBLIC_* — this Worker has no browser surface.)

---

## How it will deploy

New CI job: deploy-subscription-cron, modeled on deploy-pin-hash-test.
Runs on push to main, after verify passes. Installs wrangler, sets the
two secrets via wrangler secret put, deploys. Same pattern already
proven twice in this repo.

---

## How it will be tested

A Worker with only a scheduled handler has no HTTP endpoint to hit. The
verification is: wait for the scheduled trigger, check the log output,
verify the effect in the database.

A cheaper approach for staging: give the Worker a small authenticated
POST /run route (guarded by TEST_AUTH_TOKEN, same shared secret as the
pin-hash-test worker). That allows firing the job manually from Termux
for testing. The actual Cloudflare cron trigger is verified once, in
production, by waiting one day and checking logs.

---

## What this note is NOT

- Not a spec for the audit-events design of the cron runs. The function
  already writes an audit_events row per subscription transition.
- Not a plan for multiple schedules or manual triggers. One schedule,
  daily. If a different cadence is ever needed, that is a future decision.

---

## Follow-up trigger

Build this Worker during Tier 1 #3 (production environment). Do not skip
it — the auto-expiry mechanism is a revenue and security control, and it
only fires when this Worker actually runs on a schedule.
