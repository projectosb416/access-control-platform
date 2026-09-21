-- ============================================================================
-- Migration 0014: evaluate_exit + session resolution
-- ============================================================================
-- Purpose:
--   Complete the access engine with the EXIT decision (handoff §18), plus
--   the two admin actions needed around unresolved sessions.
--
--   evaluate_exit:  close an open session. Exit gate may differ from entry
--                   gate (§18). Always writes exactly one event.
--
--   mark_session_unresolved:  transition an 'open' session to 'unresolved'
--                   when the exit is not coming. Never fabricates an exit;
--                   the session's original events remain unchanged.
--
--   resolve_session:  admin annotates an unresolved session with reason +
--                   notes. Status stays 'unresolved' — resolution is an
--                   additional historical record, not a rewrite (§38).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. evaluate_exit
-- ----------------------------------------------------------------------------

create or replace function public.evaluate_exit(
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
  v_reason        text;
begin
  -- 1. Idempotency first.
  if p_idempotency_key is not null then
    select ae.id, ae.result_code, ae.access_session_id, ae.reason
      into v_existing
      from public.access_events ae
     where ae.organization_id = p_organization_id
       and ae.idempotency_key = p_idempotency_key
     limit 1;

    if found then
      return query select
        v_existing.result_code, v_existing.id,
        v_existing.access_session_id, v_existing.reason;
      return;
    end if;
  end if;

  -- 2. Guard must exist in this org.
  select * into v_guard
    from public.guard_profiles
   where id = p_guard_profile_id
     and organization_id = p_organization_id;
  if not found then
    raise exception 'GUARD_NOT_FOUND';
  end if;

  -- 3. Gate must exist and be active.
  select * into v_gate
    from public.gates
   where id = p_gate_id
     and organization_id = p_organization_id;
  if not found or v_gate.status <> 'active' then
    v_reason := 'gate is not active';
    v_event_id := public.log_access_event(
      p_organization_id, 'exit', 'GATE_INACTIVE', v_reason,
      null, p_credential_id, null, p_gate_id, p_guard_profile_id,
      null, null, p_idempotency_key
    );
    return query select 'GATE_INACTIVE'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  -- 4. Guard must have an active shift session at this gate.
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
      p_organization_id, 'exit', 'GUARD_NOT_ON_ACTIVE_SHIFT', v_reason,
      null, p_credential_id, null, p_gate_id, p_guard_profile_id,
      null, null, p_idempotency_key
    );
    return query select 'GUARD_NOT_ON_ACTIVE_SHIFT'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  -- 5. Credential must exist in this org.
  select * into v_cred
    from public.access_credentials
   where id = p_credential_id
     and organization_id = p_organization_id;
  if not found then
    v_reason := 'credential not found';
    v_event_id := public.log_access_event(
      p_organization_id, 'exit', 'INVALID_PIN', v_reason,
      null, p_credential_id, null, p_gate_id, p_guard_profile_id,
      v_shift_sess.id, null, p_idempotency_key
    );
    return query select 'INVALID_PIN'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  -- 6. Load authorization.
  select * into v_auth
    from public.authorizations
   where id = v_cred.authorization_id
     and organization_id = p_organization_id;
  if not found then
    v_reason := 'authorization not found';
    v_event_id := public.log_access_event(
      p_organization_id, 'exit', 'DENIED', v_reason,
      null, p_credential_id, null, p_gate_id, p_guard_profile_id,
      v_shift_sess.id, null, p_idempotency_key
    );
    return query select 'DENIED'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  -- 7. Find an open session for this authorization.
  select * into v_open_sess
    from public.access_sessions
   where authorization_id = v_auth.id
     and organization_id = p_organization_id
     and status = 'open'
   limit 1;

  if not found then
    v_reason := 'no active visit to close';
    v_event_id := public.log_access_event(
      p_organization_id, 'exit', 'NO_ACTIVE_SESSION', v_reason,
      v_auth.id, p_credential_id, v_auth.person_id, p_gate_id, p_guard_profile_id,
      v_shift_sess.id, null, p_idempotency_key
    );
    return query select 'NO_ACTIVE_SESSION'::text, v_event_id, null::uuid, v_reason;
    return;
  end if;

  -- 8. All checks passed. Close the session + log the exit event atomically.
  v_event_id := public.uuidv7();

  insert into public.access_events (
    id, organization_id, direction, result_code,
    authorization_id, credential_id, person_id,
    gate_id, guard_profile_id, shift_session_id, access_session_id,
    idempotency_key
  ) values (
    v_event_id, p_organization_id, 'exit', 'GRANTED',
    v_auth.id, p_credential_id, v_auth.person_id,
    p_gate_id, p_guard_profile_id, v_shift_sess.id, v_open_sess.id,
    p_idempotency_key
  );

  update public.access_sessions
     set status = 'completed',
         exited_at = now(),
         gate_exited_id = p_gate_id,
         exited_shift_session_id = v_shift_sess.id,
         closed_by_event_id = v_event_id
   where id = v_open_sess.id
     and status = 'open';

  -- Credential lifecycle on exit:
  --   one_time  → consumed (done forever)
  --   reusable  → active   (ready for next visit)
  if v_auth.authorization_type = 'one_time' then
    update public.access_credentials
       set status = 'consumed',
           consumed_at = now()
     where id = v_cred.id
       and status = 'in_use';

    update public.authorizations
       set status = 'completed'
     where id = v_auth.id
       and status = 'in_progress';
  else
    -- reusable
    update public.access_credentials
       set status = 'active'
     where id = v_cred.id
       and status = 'in_use';
  end if;

  return query select 'GRANTED'::text, v_event_id, v_open_sess.id, null::text;
end;
$$;

comment on function public.evaluate_exit(uuid, uuid, uuid, uuid, text) is
  'Authoritative EXIT decision engine (handoff §18). Exit gate may differ from entry. Atomic.';


-- ----------------------------------------------------------------------------
-- 2. mark_session_unresolved
-- ----------------------------------------------------------------------------
-- Explicit transition: open → unresolved. Admin-only.
-- Used when we determine the exit is not coming (via admin action or, later,
-- a scheduled sweep). Never fabricates an exit, never rewrites events.

create or replace function public.mark_session_unresolved(
  p_organization_id uuid,
  p_session_id      uuid,
  p_reason          text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED';
  end if;

  update public.access_sessions
     set status = 'unresolved'
   where id = p_session_id
     and organization_id = p_organization_id
     and status = 'open';

  if not found then
    raise exception 'SESSION_NOT_OPEN';
  end if;
end;
$$;

comment on function public.mark_session_unresolved(uuid, uuid, text) is
  'Marks an open session as unresolved when the exit is not coming. Admin-only.';


-- ----------------------------------------------------------------------------
-- 3. resolve_session
-- ----------------------------------------------------------------------------
-- Admin annotates an unresolved session. Status STAYS 'unresolved' — the fact
-- that no exit ever happened is preserved. Resolution is an additional
-- historical record (§18, §38).

create or replace function public.resolve_session(
  p_organization_id uuid,
  p_session_id      uuid,
  p_reason          text,
  p_notes           text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'REASON_REQUIRED';
  end if;

  update public.access_sessions
     set resolved_at = now(),
         resolved_by = public.current_account_id(),
         resolution_reason = p_reason,
         resolution_notes = p_notes
   where id = p_session_id
     and organization_id = p_organization_id
     and status = 'unresolved'
     and resolved_at is null;

  if not found then
    raise exception 'SESSION_NOT_RESOLVABLE';
  end if;
end;
$$;

comment on function public.resolve_session(uuid, uuid, text, text) is
  'Admin resolution of an unresolved session. Status stays unresolved. Admin-only.';
