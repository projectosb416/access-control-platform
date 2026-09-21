-- ============================================================================
-- Migration 0013: log_access_event helper + evaluate_entry
-- ============================================================================
-- Purpose:
--   The authoritative ENTRY decision engine (handoff §17).
--
-- Architecture:
--   PIN verification (PBKDF2) happens in the application layer — the Cloudflare
--   Worker holds the pepper and the salt-parameter lookup. By the time we get
--   here, the PIN has been verified. This function does the STATE validation:
--   authorization status, validity window, concurrent sessions, gate state,
--   guard shift state — and writes the resulting event + session atomically.
--
--   This split is deliberate:
--     - Pepper never enters Postgres.
--     - PBKDF2 never runs on the DB (Workers are faster at it, and safer).
--     - State transitions (which must be atomic) happen in one transaction.
--
-- Idempotency:
--   Every call may carry an idempotency_key. If an event exists for
--   (organization_id, idempotency_key), the function returns that event's
--   result without any state change. Retries are safe.
--
-- Result codes:
--   Matches handoff §19. Every attempt — success or failure — writes exactly
--   one access_event. The append-only contract is never broken.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. log_access_event — internal helper
-- ----------------------------------------------------------------------------
-- Reduces repetition across the many failure branches in evaluate_entry.
-- Always generates the id internally; caller does not supply it.

create or replace function public.log_access_event(
  p_organization_id   uuid,
  p_direction         text,
  p_result_code       text,
  p_reason            text,
  p_authorization_id  uuid,
  p_credential_id     uuid,
  p_person_id         uuid,
  p_gate_id           uuid,
  p_guard_profile_id  uuid,
  p_shift_session_id  uuid,
  p_access_session_id uuid,
  p_idempotency_key   text,
  p_metadata          jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_event_id uuid;
begin
  v_event_id := public.uuidv7();

  insert into public.access_events (
    id, organization_id, direction, result_code, reason,
    authorization_id, credential_id, person_id,
    gate_id, guard_profile_id, shift_session_id, access_session_id,
    idempotency_key, metadata
  ) values (
    v_event_id, p_organization_id, p_direction, p_result_code, p_reason,
    p_authorization_id, p_credential_id, p_person_id,
    p_gate_id, p_guard_profile_id, p_shift_session_id, p_access_session_id,
    p_idempotency_key, coalesce(p_metadata, '{}'::jsonb)
  );

  return v_event_id;
end;
$$;

comment on function public.log_access_event(
  uuid, text, text, text, uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, jsonb
) is
  'Internal helper: writes one access_event with a fresh uuidv7 id. Returns the new id.';


-- ----------------------------------------------------------------------------
-- 2. evaluate_entry — authoritative ENTRY decision
-- ----------------------------------------------------------------------------
-- Preconditions:
--   p_credential_id has already been PIN-verified by the application layer.
--
-- Guarantees:
--   - Exactly one access_event is written for this call (except on idempotent
--     replay, where the original event is returned).
--   - On GRANTED: one access_session is created, credential moves to in_use,
--     and a one-time authorization moves to in_progress — all atomically.
--   - On any failure: event is written, no session is created, no state moves.
--   - Never fabricates or silences anything.

create or replace function public.evaluate_entry(
  p_organization_id   uuid,
  p_credential_id     uuid,
  p_gate_id           uuid,
  p_guard_profile_id  uuid,
  p_idempotency_key   text default null
)
returns table (
  result_code        text,
  access_event_id    uuid,
  access_session_id  uuid,
  reason             text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing      record;
  v_cred          record;
  v_auth          record;
  v_gate          record;
  v_guard         record;
  v_shift_sess    record;
  v_open_sess     record;
  v_event_id      uuid;
  v_session_id    uuid;
  v_reason        text;
begin
  -- -------------------------------------------------------------------------
  -- 1. Idempotency: replay returns original result.
  -- -------------------------------------------------------------------------
  if p_idempotency_key is not null then
    select ae.id, ae.result_code, ae.access_session_id, ae.reason
      into v_existing
      from public.access_events ae
     where ae.organization_id = p_organization_id
       and ae.idempotency_key = p_idempotency_key
     limit 1;

    if found then
      return query select
        v_existing.result_code,
        v_existing.id,
        v_existing.access_session_id,
        v_existing.reason;
      return;
    end if;
  end if;

  -- -------------------------------------------------------------------------
  -- 2. Guard must exist in this org and be active.
  -- -------------------------------------------------------------------------
  select * into v_guard
    from public.guard_profiles
   where id = p_guard_profile_id
     and organization_id = p_organization_id;

  if not found then
    -- Cannot log an event without a valid guard_profile_id (FK).
    raise exception 'GUARD_NOT_FOUND';
  end if;

  if v_guard.status <> 'active' then
    v_reason := 'guard profile is not active';
    v_event_id := public.log_access_event(
      p_organization_id, 'entry', 'GUARD_NOT_ON_ACTIVE_SHIFT', v_reason,
      null, p_credential_id, null, p_gate_id, p_guard_profile_id,
      null, null, p_idempotency_key
    );
    return query select 'GUARD_NOT_ON_ACTIVE_SHIFT'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- 3. Gate must exist in this org and be active.
  -- -------------------------------------------------------------------------
  select * into v_gate
    from public.gates
   where id = p_gate_id
     and organization_id = p_organization_id;

  if not found then
    v_reason := 'gate not found';
    v_event_id := public.log_access_event(
      p_organization_id, 'entry', 'GATE_INACTIVE', v_reason,
      null, p_credential_id, null, p_gate_id, p_guard_profile_id,
      null, null, p_idempotency_key
    );
    return query select 'GATE_INACTIVE'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  if v_gate.status <> 'active' then
    v_reason := 'gate is not active';
    v_event_id := public.log_access_event(
      p_organization_id, 'entry', 'GATE_INACTIVE', v_reason,
      null, p_credential_id, null, p_gate_id, p_guard_profile_id,
      null, null, p_idempotency_key
    );
    return query select 'GATE_INACTIVE'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- 4. Guard must have an active shift session at this gate.
  -- -------------------------------------------------------------------------
  select ss.* into v_shift_sess
    from public.shift_sessions ss
    join public.shifts sh on sh.id = ss.shift_id
   where ss.guard_profile_id = p_guard_profile_id
     and ss.status = 'active'
     and sh.gate_id = p_gate_id
     and sh.organization_id = p_organization_id
   limit 1;

  if not found then
    v_reason := 'no active shift session at this gate';
    v_event_id := public.log_access_event(
      p_organization_id, 'entry', 'GUARD_NOT_ON_ACTIVE_SHIFT', v_reason,
      null, p_credential_id, null, p_gate_id, p_guard_profile_id,
      null, null, p_idempotency_key
    );
    return query select 'GUARD_NOT_ON_ACTIVE_SHIFT'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- 5. Credential must exist in this org.
  -- -------------------------------------------------------------------------
  select * into v_cred
    from public.access_credentials
   where id = p_credential_id
     and organization_id = p_organization_id;

  if not found then
    v_reason := 'credential not found';
    v_event_id := public.log_access_event(
      p_organization_id, 'entry', 'INVALID_PIN', v_reason,
      null, p_credential_id, null, p_gate_id, p_guard_profile_id,
      v_shift_sess.id, null, p_idempotency_key
    );
    return query select 'INVALID_PIN'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- 6. Credential status.
  -- -------------------------------------------------------------------------
  if v_cred.status = 'consumed' then
    v_reason := 'one-time credential already consumed';
    v_event_id := public.log_access_event(
      p_organization_id, 'entry', 'ONE_TIME_ALREADY_CONSUMED', v_reason,
      null, p_credential_id, null, p_gate_id, p_guard_profile_id,
      v_shift_sess.id, null, p_idempotency_key
    );
    return query select 'ONE_TIME_ALREADY_CONSUMED'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  if v_cred.status = 'revoked' then
    v_reason := 'credential revoked';
    v_event_id := public.log_access_event(
      p_organization_id, 'entry', 'REVOKED_AUTHORIZATION', v_reason,
      null, p_credential_id, null, p_gate_id, p_guard_profile_id,
      v_shift_sess.id, null, p_idempotency_key
    );
    return query select 'REVOKED_AUTHORIZATION'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  if v_cred.status in ('expired','cancelled') then
    v_reason := 'credential ' || v_cred.status;
    v_event_id := public.log_access_event(
      p_organization_id, 'entry', 'EXPIRED_AUTHORIZATION', v_reason,
      null, p_credential_id, null, p_gate_id, p_guard_profile_id,
      v_shift_sess.id, null, p_idempotency_key
    );
    return query select 'EXPIRED_AUTHORIZATION'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  if v_cred.status = 'in_use' then
    v_reason := 'credential already has an open session';
    v_event_id := public.log_access_event(
      p_organization_id, 'entry', 'UNRESOLVED_VISIT', v_reason,
      null, p_credential_id, null, p_gate_id, p_guard_profile_id,
      v_shift_sess.id, null, p_idempotency_key
    );
    return query select 'UNRESOLVED_VISIT'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  if v_cred.status not in ('created','active') then
    v_reason := 'unexpected credential status: ' || v_cred.status;
    v_event_id := public.log_access_event(
      p_organization_id, 'entry', 'DENIED', v_reason,
      null, p_credential_id, null, p_gate_id, p_guard_profile_id,
      v_shift_sess.id, null, p_idempotency_key
    );
    return query select 'DENIED'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- 7. Load authorization.
  -- -------------------------------------------------------------------------
  select * into v_auth
    from public.authorizations
   where id = v_cred.authorization_id
     and organization_id = p_organization_id;

  if not found then
    v_reason := 'authorization not found';
    v_event_id := public.log_access_event(
      p_organization_id, 'entry', 'DENIED', v_reason,
      null, p_credential_id, null, p_gate_id, p_guard_profile_id,
      v_shift_sess.id, null, p_idempotency_key
    );
    return query select 'DENIED'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- 8. Authorization status.
  -- -------------------------------------------------------------------------
  if v_auth.status = 'revoked' then
    v_reason := 'authorization revoked';
    v_event_id := public.log_access_event(
      p_organization_id, 'entry', 'REVOKED_AUTHORIZATION', v_reason,
      v_auth.id, p_credential_id, v_auth.person_id, p_gate_id, p_guard_profile_id,
      v_shift_sess.id, null, p_idempotency_key
    );
    return query select 'REVOKED_AUTHORIZATION'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  if v_auth.status in ('expired','cancelled') then
    v_reason := 'authorization ' || v_auth.status;
    v_event_id := public.log_access_event(
      p_organization_id, 'entry', 'EXPIRED_AUTHORIZATION', v_reason,
      v_auth.id, p_credential_id, v_auth.person_id, p_gate_id, p_guard_profile_id,
      v_shift_sess.id, null, p_idempotency_key
    );
    return query select 'EXPIRED_AUTHORIZATION'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  if v_auth.status not in ('active','in_progress') then
    v_reason := 'authorization status: ' || v_auth.status;
    v_event_id := public.log_access_event(
      p_organization_id, 'entry', 'DENIED', v_reason,
      v_auth.id, p_credential_id, v_auth.person_id, p_gate_id, p_guard_profile_id,
      v_shift_sess.id, null, p_idempotency_key
    );
    return query select 'DENIED'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- 9. Validity window.
  -- -------------------------------------------------------------------------
  if now() < v_auth.valid_from then
    v_reason := 'authorization not yet valid';
    v_event_id := public.log_access_event(
      p_organization_id, 'entry', 'DENIED', v_reason,
      v_auth.id, p_credential_id, v_auth.person_id, p_gate_id, p_guard_profile_id,
      v_shift_sess.id, null, p_idempotency_key
    );
    return query select 'DENIED'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  if now() >= v_auth.valid_until then
    v_reason := 'authorization validity window has ended';
    v_event_id := public.log_access_event(
      p_organization_id, 'entry', 'EXPIRED_AUTHORIZATION', v_reason,
      v_auth.id, p_credential_id, v_auth.person_id, p_gate_id, p_guard_profile_id,
      v_shift_sess.id, null, p_idempotency_key
    );
    return query select 'EXPIRED_AUTHORIZATION'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- 10. No concurrent open session (authorization-scoped).
  -- -------------------------------------------------------------------------
  select * into v_open_sess
    from public.access_sessions
   where authorization_id = v_auth.id
     and status = 'open'
   limit 1;

  if found then
    v_reason := 'authorization already has an open session';
    v_event_id := public.log_access_event(
      p_organization_id, 'entry', 'UNRESOLVED_VISIT', v_reason,
      v_auth.id, p_credential_id, v_auth.person_id, p_gate_id, p_guard_profile_id,
      v_shift_sess.id, v_open_sess.id, p_idempotency_key
    );
    return query select 'UNRESOLVED_VISIT'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- 11. No concurrent open session (person-scoped).
  -- -------------------------------------------------------------------------
  select * into v_open_sess
    from public.access_sessions
   where person_id = v_auth.person_id
     and organization_id = p_organization_id
     and status = 'open'
   limit 1;

  if found then
    v_reason := 'person already has an open session in this organization';
    v_event_id := public.log_access_event(
      p_organization_id, 'entry', 'UNRESOLVED_VISIT', v_reason,
      v_auth.id, p_credential_id, v_auth.person_id, p_gate_id, p_guard_profile_id,
      v_shift_sess.id, v_open_sess.id, p_idempotency_key
    );
    return query select 'UNRESOLVED_VISIT'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- 12. All checks passed. Create session + event atomically.
  -- -------------------------------------------------------------------------
  -- Pre-generate both ids so no UPDATE is needed on either row.
  -- Session is inserted first (with opened_by_event_id = pre-generated),
  -- then event references the session.

  v_session_id := public.uuidv7();
  v_event_id   := public.uuidv7();

  insert into public.access_sessions (
    id, organization_id, authorization_id, person_id,
    gate_entered_id, entered_shift_session_id,
    opened_by_event_id,
    status, entered_at
  ) values (
    v_session_id, p_organization_id, v_auth.id, v_auth.person_id,
    p_gate_id, v_shift_sess.id,
    v_event_id,
    'open', now()
  );

  insert into public.access_events (
    id, organization_id, direction, result_code,
    authorization_id, credential_id, person_id,
    gate_id, guard_profile_id, shift_session_id, access_session_id,
    idempotency_key
  ) values (
    v_event_id, p_organization_id, 'entry', 'GRANTED',
    v_auth.id, p_credential_id, v_auth.person_id,
    p_gate_id, p_guard_profile_id, v_shift_sess.id, v_session_id,
    p_idempotency_key
  );

  update public.access_credentials
     set status = 'in_use'
   where id = v_cred.id
     and status in ('created','active');

  if v_auth.authorization_type = 'one_time' then
    update public.authorizations
       set status = 'in_progress'
     where id = v_auth.id
       and status = 'active';
  end if;

  return query select 'GRANTED'::text, v_event_id, v_session_id, null::text;
end;
$$;

comment on function public.evaluate_entry(uuid, uuid, uuid, uuid, text) is
  'Authoritative ENTRY decision engine (handoff §17). Atomic. Writes exactly one event per attempt.';
