-- ============================================================================
-- Migration 0034: idempotency_key length constraint
-- ============================================================================
-- Purpose:
--   The Worker rejects idempotency keys longer than 200 characters, but the
--   schema does not enforce a limit. A service-role call could insert a
--   megabyte string, bloating the events table and index.
--
--   This migration adds the same limit at the database layer. It matches the
--   Worker-side check in app/api/guard/entry/route.ts. Both must stay in sync
--   — if the Worker limit ever changes, this constraint must change too.
--
--   Existing rows: nullable and short in practice. No backfill needed. If a
--   row already exceeded 200 chars (it does not — the Worker never allowed
--   it), the constraint would fail at apply time and we would see it.
-- ============================================================================

alter table public.access_events
  add constraint access_events_idempotency_key_length
    check (idempotency_key is null or length(idempotency_key) <= 200);

comment on constraint access_events_idempotency_key_length on public.access_events is
  'Idempotency keys are limited to 200 characters, matching the Worker-side check in app/api/guard/entry/route.ts.';
