-- ============================================================================
-- Migration 0038: fix re-auth shift status
-- ============================================================================
-- Bug: start_shift_session's re-auth path (migration 0029) updates the
-- session token hash but does not flip the parent shift from 'scheduled'
-- to 'active'. The new-session path does. Consequence: when a guard
-- re-authenticates on a shift whose status was reset, or when a shift
-- was created but never had a fresh session on it, the re-auth succeeds
-- server-side but resolve_shift_session (which requires shift.status =
-- 'active') rejects every subsequent request with 401.
--
-- Discovered during the Phase 9 Guard ENTRY browser test on the deployed
-- Worker. The end-to-end slice is what surfaced it — no unit test was
-- exercising the re-auth path against a scheduled shift.
--
-- Fix: after updating the session token in the re-auth branch, also
-- UPDATE shifts SET status = 'active' WHERE status = 'scheduled'. This
-- mirrors the new-session path exactly. Idempotent — if the shift is
-- already active or completed, the UPDATE affects zero rows.
--
-- Not changed: resolve_shift_session. Its requirement that the shift be
-- 'active' is correct. A session whose shift is still 'scheduled' is an
-- inconsistent state, not a legitimate one. Loosening the check would
-- hide the bug rather than surface it.
--
-- Audit confirming single-point fix:
--   insert into shift_sessions  → start_shift_session only
--   update shift_sessions       → re-auth (this fix) + end_shift_session
--   shift.status = 'active'     → new-session path only (now mirrored here)
-- ============================================================================

create or replace function public.start_shift_session(
  p_organization_id     uuid,
  p_shift_code          text,
  p_guard_code          text,
  p_session_token_hash  text,
  p_early_minutes       int default 30
)
returns table (
  session_id uuid,
  shift_id   uuid,
  gate_id    uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift       record;
  v_guard       record;
  v_gate        record;
  v_active_cnt  int;
  v_existing    record;
  v_session_id  uuid;
  v_hash_ok     boolean;
begin
  -- 0. Validate token hash format — 64 lowercase hex chars (SHA-256)
  v_hash_ok :=
    p_session_token_hash is not null
    and length(p_session_token_hash) = 64
    and p_session_token_hash ~ '^[0-9a-f]{64}$';

  if not v_hash_ok then
    raise exception 'INVALID_SESSION_TOKEN_HASH';
  end if;

  -- 1. Locate shift
  select * into v_shift
  from public.shifts
  where organization_id = p_organization_id
    and shift_code = p_shift_code;

  if v_shift is null then
    raise exception 'SHIFT_NOT_FOUND';
  end if;

  if v_shift.status not in ('scheduled', 'active') then
    raise exception 'SHIFT_NOT_OPEN';
  end if;

  if now() > v_shift.scheduled_end then
    raise exception 'SHIFT_ENDED';
  end if;

  if now() < v_shift.scheduled_start - make_interval(mins => p_early_minutes) then
    raise exception 'SHIFT_NOT_OPEN';
  end if;

  -- 2. Locate guard
  select * into v_guard
  from public.guard_profiles
  where organization_id = p_organization_id
    and guard_code = p_guard_code;

  if v_guard is null then
    raise exception 'GUARD_NOT_FOUND';
  end if;

  if v_guard.status <> 'active' then
    raise exception 'GUARD_NOT_ACTIVE';
  end if;

  -- 3. Check for an existing active session for this guard
  select ss.* into v_existing
  from public.shift_sessions ss
  where ss.guard_profile_id = v_guard.id
    and ss.status = 'active'
  limit 1;

  if found then
    if v_existing.shift_id = v_shift.id then
      -- -------------------------------------------------------------------
      -- Idempotent re-auth on the same shift.
      -- Overwrite the token hash; the old token is now invalid.
      -- -------------------------------------------------------------------
      update public.shift_sessions
         set session_token_hash      = p_session_token_hash,
             session_token_issued_at = now()
       where id = v_existing.id;

      -- Fix (migration 0038): if the shift is still scheduled, flip it
      -- to active. Mirrors the new-session path. A session that is
      -- active must have an active shift — resolve_shift_session
      -- depends on this invariant.
      update public.shifts
         set status = 'active',
             started_at = coalesce(started_at, now())
       where id = v_shift.id
         and status = 'scheduled';

      return query select v_existing.id, v_existing.shift_id, v_shift.gate_id;
      return;
    else
      raise exception 'GUARD_ALREADY_ON_SHIFT';
    end if;
  end if;

  -- 4. Lock the gate row and check capacity (new session path)
  select * into v_gate
  from public.gates
  where id = v_shift.gate_id
  for update;

  if v_gate is null or v_gate.status <> 'active' then
    raise exception 'GATE_NOT_ACTIVE';
  end if;

  select count(*) into v_active_cnt
  from public.shift_sessions s
  join public.shifts sh on sh.id = s.shift_id
  where sh.gate_id = v_gate.id
    and s.status = 'active';

  if v_active_cnt >= v_gate.max_active_guards then
    raise exception 'GATE_CAPACITY_REACHED';
  end if;

  -- 5. Create the session
  v_session_id := public.uuidv7();

  insert into public.shift_sessions (
    id, shift_id, guard_profile_id, status, started_at,
    session_token_hash, session_token_issued_at
  ) values (
    v_session_id, v_shift.id, v_guard.id, 'active', now(),
    p_session_token_hash, now()
  );

  -- Mark shift active on first join
  if v_shift.status = 'scheduled' then
    update public.shifts
       set status = 'active', started_at = now()
     where id = v_shift.id;
  end if;

  return query select v_session_id, v_shift.id, v_gate.id;
end;
$$;

comment on function public.start_shift_session(uuid, text, text, text, int) is
  'Start or re-authenticate a shift session. Re-auth path also flips the parent shift to active if still scheduled (migration 0038). Idempotent on same-shift re-auth.';
