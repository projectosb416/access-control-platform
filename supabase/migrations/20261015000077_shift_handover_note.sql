-- ============================================================================
-- Migration 0077: shift handover note
-- ============================================================================
-- Purpose:
--   Adds an optional free-text handover note that a guard can attach
--   when ending a shift. The next guard starting at the same gate sees
--   the latest note. Zero ambiguity at gate handover.
--
-- Shape:
--   1. shift_sessions.handover_note text, nullable.
--   2. end_shift_session() extended with p_handover_note text default null.
--      The old 3-arg signature is DROPPED in this file — a growing
--      parameter list via create-or-replace creates an OVERLOAD, not a
--      replacement (continuity §11, hit in Task T 0067→0068; Postgres
--      raises 42725 "could not choose a best candidate function" when a
--      call matches both).
--   3. latest_gate_handover(p_organization_id, p_session_id) — a read
--      path for the guard entry page. SECURITY DEFINER, is_org_member
--      gated, returns the latest non-null handover_note from a
--      completed shift_session on the same gate (excluding the caller's
--      own session).
--
-- Why a new column, not end_reason:
--   end_reason is a reason code ('guard ended shift', 'admin ended
--   shift', etc.), not a user message. Repurposing it would make the
--   column bimodal — reason in one call, handover text in another.
--   Separate concerns, separate columns.
--
-- Why a separate read RPC, not extending start_shift_session:
--   start_shift_session is already on its second signature (migration
--   0029 added token support). Extending it again re-opens the overload
--   trap and mixes shift-start with handover-read. Separate query,
--   separate concern.
--
-- Ambiguity discipline (§11):
--   Every column reference inside function bodies is qualified with a
--   table alias.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Column
-- ----------------------------------------------------------------------------

alter table public.shift_sessions
  add column handover_note text;

comment on column public.shift_sessions.handover_note is
  'Optional free-text note from the guard ending this shift, intended for the next guard starting at the same gate. NULL if the guard did not leave a note. Distinct from end_reason (a reason code, not a user message).';


-- ----------------------------------------------------------------------------
-- 2. end_shift_session — extended with p_handover_note.
--    Old 3-arg signature dropped explicitly to avoid overload.
-- ----------------------------------------------------------------------------

drop function if exists public.end_shift_session(uuid, uuid, text);

create or replace function public.end_shift_session(
  p_organization_id uuid,
  p_session_id      uuid,
  p_reason          text default null,
  p_handover_note   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_shift   record;
begin
  select s.* into v_session
  from public.shift_sessions s
  join public.shifts sh on sh.id = s.shift_id
  where s.id = p_session_id
    and sh.organization_id = p_organization_id;

  if v_session is null then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if v_session.status <> 'active' then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;

  update public.shift_sessions ss
  set status         = 'completed',
      ended_at       = now(),
      ended_by       = public.current_account_id(),
      end_reason     = p_reason,
      handover_note  = nullif(btrim(p_handover_note), '')
  where ss.id = p_session_id;

  select sh.* into v_shift
  from public.shifts sh
  where sh.id = v_session.shift_id;

  if not exists (
    select 1 from public.shift_sessions ss
    where ss.shift_id = v_shift.id
      and ss.status = 'active'
  ) then
    update public.shifts sh
    set status       = 'completed',
        completed_at = now()
    where sh.id = v_shift.id;
  end if;
end;
$$;

comment on function public.end_shift_session(uuid, uuid, text, text) is
  'Ends the active shift session. Optional p_reason is a short code (e.g. "guard ended shift"); optional p_handover_note is free text visible to the next guard at the same gate. Idempotent — a second call against an already-ended session raises SESSION_NOT_ACTIVE, which the HTTP route treats as success.';


-- ----------------------------------------------------------------------------
-- 3. latest_gate_handover — read path for the guard entry page.
-- ----------------------------------------------------------------------------

create or replace function public.latest_gate_handover(
  p_organization_id uuid,
  p_session_id      uuid
)
returns table (
  handover_note text,
  ended_at      timestamptz,
  ended_by_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gate_id uuid;
begin
  if not public.is_org_member(p_organization_id) then
    raise exception 'NOT_ORG_MEMBER';
  end if;

  -- Resolve the current session's gate.
  select sh.gate_id into v_gate_id
  from public.shift_sessions ss
  join public.shifts sh on sh.id = ss.shift_id
  where ss.id = p_session_id
    and sh.organization_id = p_organization_id;

  if v_gate_id is null then
    return;
  end if;

  return query
    select ss.handover_note,
           ss.ended_at,
           p.full_name as ended_by_name
    from public.shift_sessions ss
    join public.shifts sh on sh.id = ss.shift_id
    left join public.people p on p.account_id = ss.ended_by
    where sh.organization_id = p_organization_id
      and sh.gate_id = v_gate_id
      and ss.id <> p_session_id
      and ss.status = 'completed'
      and ss.handover_note is not null
    order by ss.ended_at desc
    limit 1;
end;
$$;

comment on function public.latest_gate_handover(uuid, uuid) is
  'Returns the most recent completed shift_session handover_note on the same gate as the caller''s session (excluding the caller''s own session). SECURITY DEFINER + is_org_member gated. Empty result set means no recent handover at this gate.';
