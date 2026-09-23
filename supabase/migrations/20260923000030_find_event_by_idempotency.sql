-- ============================================================================
-- Migration 0030: find_event_by_idempotency
-- ============================================================================
-- Purpose:
--   The guard ENTRY/EXIT endpoint checks this at the top of every request.
--   If a retried request arrives with the same idempotency_key, we return
--   the original response without re-running the decision logic, re-checking
--   rate limits, or writing duplicate events.
--
--   This is the top-level idempotency guard. The internal idempotency
--   check inside evaluate_entry remains as defense in depth, but in
--   practice the endpoint short-circuits before reaching it.
--
-- Returns the response shape that evaluate_entry uses, so the Worker can
-- return it directly to the client without transformation.
-- ============================================================================

create or replace function public.find_event_by_idempotency(
  p_organization_id uuid,
  p_idempotency_key text
)
returns table (
  result_code        text,
  access_event_id    uuid,
  access_session_id  uuid,
  reason             text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ae.result_code,
    ae.id,
    ae.access_session_id,
    ae.reason
  from public.access_events ae
  where ae.organization_id = p_organization_id
    and ae.idempotency_key = p_idempotency_key
    and p_idempotency_key is not null
  limit 1;
$$;

comment on function public.find_event_by_idempotency(uuid, text) is
  'Returns the original response for a replayed idempotency key. Empty if the key is new or null.';
