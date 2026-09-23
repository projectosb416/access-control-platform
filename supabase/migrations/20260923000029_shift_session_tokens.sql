-- ============================================================================
-- Migration 0029: shift session tokens
-- ============================================================================
-- Purpose:
--   Implement the shift-scoped session model specified in
--   docs/phase-7/guard-auth-model.md.
--
--   A guard starts a shift by entering shift_code + guard_code. The Worker
--   generates a 32-byte random token, hashes it (SHA-256 hex), and passes
--   the hash to start_shift_session. The function stores only the hash on
--   the shift_session row. The raw token goes back to the guard's device
--   as an HttpOnly cookie.
--
--   Subsequent guard requests present the cookie. The Worker hashes it
--   and calls resolve_shift_session() to get the session context — or a
--   rejection.
--
--   The raw token is NEVER stored. Only its SHA-256 hash lives in Postgres.
--   A database leak exposes hashes, not usable tokens.
--
-- Changes:
--   1. Two new columns on shift_sessions: session_token_hash, session_token_issued_at
--   2. Partial unique index on session_token_hash
--   3. resolve_shift_session() — Worker-facing verification function
--   4. start_shift_session() rewritten: takes p_session_token_hash, supports
--      idempotent re-auth (device wipe mid-shift), preserves all prior
--      validation and atomicity guarantees
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Add columns to shift_sessions
-- ----------------------------------------------------------------------------
-- Nullable so existing rows (staging only) remain valid. New sessions
-- always populate both. On a fresh production database, all sessions
-- will carry tokens from day one.

alter table public.shift_sessions
  add column session_token_hash      text,
  add column session_token_issued_at timestamptz;

comment on column public.shift_sessions.session_token_hash is
  'SHA-256 hex of the raw guard session token. Raw token never stored.';

comment on column public.shift_sessions.session_token_issued_at is
  'When the current token was issued. Updated on idempotent re-auth.';

-- Unique token hash across all sessions. Partial: null rows (pre-migration
-- or in-flight) do not collide.
create unique index shift_sessions_unique_token_hash
  on public.shift_sessions(session_token_hash)
  where session_token_hash is not null;


-- ----------------------------------------------------------------------------
-- 2. resolve_shift_session — token → session context
-- ----------------------------------------------------------------------------
-- Called by the Worker on every /guard/* request. Returns the session
-- context if the token is valid AND the parent shift is still active.
-- Returns zero rows otherwise.

create or replace function public.resolve_shift_session(p_token_hash text)
returns table (
  shift_session_id uuid,
  guard_profile_id uuid,
  gate_id          uuid,
  organization_id  uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ss.id,
    ss.guard_profile_id,
    sh.gate_id,
    sh.organization_id
  from public.shift_sessions ss
  join public.shifts sh on sh.id = ss.shift_id
  where ss.session_token_hash = p_token_hash
    and ss.status = 'active'
    and sh.status = 'active'
  limit 1;
$$;

comment on function public.resolve_shift_session(text) is
  'Verify a shift session token hash. Returns session context if the session and its shift are both active; empty otherwise.';


-- ----------------------------------------------------------------------------
-- 3. start_shift_session — now with token hash
-- ----------------------------------------------------------------------------
-- Behaviour:
--   1. Idempotent re-auth: if the guard already has an ACTIVE session on
--      THIS shift, update the token hash and return the existing session.
--      This is the "device wiped mid-shift" path — the guard re-enters
--      shift_code + guard_code and gets a fresh token for the same session.
--      The old token is invalidated because the hash is overwritten.
--   2. New session: create as before, store the token hash.
--   3. Guard already active on a DIFFERENT shift → GUARD_ALREADY_ON_SHIFT.
--
-- All prior validation preserved: shift window, gate active, capacity,
-- guard active, org match.
--
-- New parameter: p_session_token_hash (required, SHA-256 hex, 64 chars).

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
  -- -------------------------------------------------------------------------
  -- 0. Validate token hash format — 64 lowercase hex chars (SHA-256)
  -- -------------------------------------------------------------------------
  v_hash_ok :=
    p_session_token_hash is not null
    and length(p_session_token_hash) = 64
    and p_session_token_hash ~ '^[0-9a-f]{64}$';

  if not v_hash_ok then
    raise exception 'INVALID_SESSION_TOKEN_HASH';
  end if;

  -- -------------------------------------------------------------------------
  -- 1. Locate shift
  -- -------------------------------------------------------------------------
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

  -- -------------------------------------------------------------------------
  -- 2. Locate guard
  -- -------------------------------------------------------------------------
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

  -- -------------------------------------------------------------------------
  -- 3. Check for an existing active session for this guard
  -- -------------------------------------------------------------------------
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

      return query select v_existing.id, v_existing.shift_id, v_shift.gate_id;
      return;
    else
      raise exception 'GUARD_ALREADY_ON_SHIFT';
    end if;
  end if;

  -- -------------------------------------------------------------------------
  -- 4. Lock the gate row and check capacity (new session path)
  -- -------------------------------------------------------------------------
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

  -- -------------------------------------------------------------------------
  -- 5. Create the session
  -- -------------------------------------------------------------------------
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
  'Start or re-authenticate a shift session. Stores only the SHA-256 hash of the guard session token. Idempotent on same-shift re-auth. Locks gate row for capacity.';
