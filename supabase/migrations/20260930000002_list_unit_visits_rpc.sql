-- ============================================================================
-- Migration 0056: list_unit_visits
-- ============================================================================
-- Purpose:
--   Read-only list of recent visits to a unit, scoped to the calling
--   resident's own unit. Resident-only. Returns the 20 most recent
--   access_sessions rows for the unit.
--
-- Why a SECURITY DEFINER function when RLS already permits the read:
--   access_sessions_select_primary_resident and the equivalent policy
--   on access_events already scope reads to
--   scope_unit_id = current_occupied_unit_id(organization_id). So a
--   resident can already query those tables directly via the anon
--   client and get correctly-scoped rows.
--
--   The function exists for API stability, not to bypass an RLS block.
--   A named RPC with a fixed return shape (session_id, visitor_name,
--   entered_at, exited_at, status, resolved_at) insulates the resident
--   dashboard from future schema changes on the underlying tables, and
--   matches the pattern established by list_guest_pins_for_unit (0051).
--
-- Drop-then-create rationale:
--   An earlier version of this function (with a different return type)
--   was applied to staging in error and reverted. This migration begins
--   with DROP FUNCTION IF EXISTS so the signature is not constrained by
--   any prior deployment. On a fresh database, the drop is a no-op.
--
-- Status semantics (three tiers, matching access_sessions_status_check):
--   open        — entered, not yet exited. Live 'inside' indicator.
--   completed   — entered and exited cleanly. Standard history row.
--   unresolved  — entered, exit not recorded. Honest 'exit not
--                 recorded' marker; do not present as clean history.
--                 See §Locked Decisions: 'no fabricated exits'.
--
--   The resolved_at column is returned so the UI can further
--   distinguish an unresolved session that has since been resolved by
--   admin (resolved_at IS NOT NULL) from one that is still
--   outstanding.
--
-- Error codes (Worker maps to HTTP per docs/phase-7/error-http-mapping.md):
--   NOT_AUTHENTICATED   → 401
--   UNIT_NOT_FOUND      → 404
--   NOT_AUTHORIZED      → 403
--
-- Security notes:
--   - SECURITY DEFINER. Bypasses RLS by design. Residency is enforced
--     inline via the same active-occupancy predicate as 0050 and 0051.
--   - Non-residents, unauthenticated callers, and unknown unit UUIDs
--     all raise before any rows are returned.
--   - No writes. Function is STABLE, not VOLATILE.
-- ============================================================================

drop function if exists public.list_unit_visits(uuid);

create or replace function public.list_unit_visits(p_unit_id uuid)
returns table (
  session_id    uuid,
  visitor_name  text,
  entered_at    timestamptz,
  exited_at     timestamptz,
  status        text,
  resolved_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_org_id     uuid;
begin
  -- 1. Authenticated.
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- 2. Unit exists; capture its org for the residency check.
  select p.organization_id into v_org_id
    from public.units u
    join public.properties p on p.id = u.property_id
   where u.id = p_unit_id;

  if not found then
    raise exception 'UNIT_NOT_FOUND';
  end if;

  -- 3. Caller is an active primary resident of this unit.
  --    Same predicate as list_guest_pins_for_unit (0051).
  if not exists (
    select 1
      from public.occupancies o
     where o.unit_id    = p_unit_id
       and o.account_id = v_account_id
       and o.status     = 'active'
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- 4. Return the most recent 20 sessions for this unit.
  --    Column references qualified where they collide with OUT
  --    parameter names — §11: plpgsql OUT-param ambiguity (0032, 0040).
  return query
    select
      s.id          as session_id,
      per.full_name as visitor_name,
      s.entered_at  as entered_at,
      s.exited_at   as exited_at,
      s.status      as status,
      s.resolved_at as resolved_at
    from public.access_sessions s
    join public.authorizations a on a.id = s.authorization_id
    join public.people per       on per.id = s.person_id
    where a.scope_unit_id  = p_unit_id
      and s.organization_id = v_org_id
    order by s.entered_at desc
    limit 20;
end;
$$;

comment on function public.list_unit_visits(uuid) is
  'Primary-resident-only list of recent visits for a unit. SECURITY DEFINER for API stability; residency enforced inline (same predicate as 0050/0051). Returns max 20 rows, newest first. Status is one of open, completed, unresolved per access_sessions_status_check.';
