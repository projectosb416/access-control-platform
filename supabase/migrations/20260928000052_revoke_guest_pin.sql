-- ============================================================================
-- Migration 0052: revoke_guest_pin
-- ============================================================================
-- Purpose:
--   Resident-initiated revocation of a guest PIN they created.
--
--   Paired with 0053 (drop of authorizations_update_primary_resident):
--   resident-side writes on authorizations now go through SECURITY DEFINER
--   functions exclusively. This is the first such write for authorizations.
--
--   The function updates BOTH the authorization and its live credential
--   in one transaction, so the gate sees the revocation atomically. A row
--   in access_credentials left at 'active' after its authorization was
--   'revoked' would still be found by lookup_key at the gate and pass
--   evaluate_exit — that must not happen.
--
-- Behavior:
--   - Caller must be authenticated.
--   - Caller must be created_by on the authorization AND hold an active
--     occupancy on the authorization's scope_unit_id.
--   - Authorization must exist.
--   - Idempotent: already revoked or cancelled → silent success, no
--     duplicate audit row.
--   - Terminal-but-not-revocable: completed or expired → NOT_REVOKABLE.
--     We do not rewrite history by flipping these to 'revoked'.
--   - Revocable: active or in_progress → flip to revoked (both tables),
--     set revoked_at on both (coupled by CHECK constraints), write audit.
--
-- Concurrency:
--   SELECT ... FOR UPDATE on the authorizations row serializes concurrent
--   revoke attempts. Two simultaneous calls: one flips, the other sees
--   status='revoked' on entry and returns silently. Exactly one audit row.
--
-- Error codes (Worker maps to HTTP per docs/phase-7/error-http-mapping.md):
--   NOT_AUTHENTICATED          → 401  (existing)
--   NOT_AUTHORIZED             → 403  (existing)
--   AUTHORIZATION_NOT_FOUND    → 404  (new; added to doc in same change)
--   NOT_REVOKABLE              → 409  (new; added to doc in same change)
-- ============================================================================

create or replace function public.revoke_guest_pin(p_authorization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_org_id     uuid;
  v_status     text;
  v_scope_unit uuid;
  v_created_by uuid;
begin
  -- 1. Authenticated.
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- 2. Load and lock the row. FOR UPDATE serializes concurrent revokes.
  select a.organization_id, a.status, a.scope_unit_id, a.created_by
    into v_org_id, v_status, v_scope_unit, v_created_by
    from public.authorizations a
   where a.id = p_authorization_id
   for update;

  if not found then
    raise exception 'AUTHORIZATION_NOT_FOUND';
  end if;

  -- 3. Ownership + residency. Both required.
  if v_created_by <> v_account_id then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if v_scope_unit is null or not exists (
    select 1
      from public.occupancies o
     where o.unit_id    = v_scope_unit
       and o.account_id = v_account_id
       and o.status     = 'active'
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- 4. Idempotent no-op: already terminal for the right reason.
  if v_status in ('revoked','cancelled') then
    return;
  end if;

  -- 5. Terminal for a different reason — do not rewrite history.
  if v_status in ('completed','expired') then
    raise exception 'NOT_REVOKABLE';
  end if;

  -- 6. Revocable states only.
  if v_status not in ('active','in_progress') then
    raise exception 'NOT_REVOKABLE';
  end if;

  -- 7. Flip the authorization. status and revoked_at are coupled by CHECK.
  update public.authorizations
     set status     = 'revoked',
         revoked_at = now()
   where id = p_authorization_id;

  -- 8. Flip every live credential on this authorization. Terminal
  --    credentials (consumed/expired/revoked/cancelled) are left alone.
  update public.access_credentials
     set status     = 'revoked',
         revoked_at = now()
   where authorization_id = p_authorization_id
     and status in ('created','active','in_use');

  -- 9. Audit — same transaction as the state change.
  perform public.log_audit_event(
    v_org_id,
    v_account_id,
    'authorization.revoked',
    'authorization',
    p_authorization_id,
    null,
    jsonb_build_object('reason', 'resident_initiated')
  );
end;
$$;

comment on function public.revoke_guest_pin(uuid) is
  'Resident-initiated revocation of a guest PIN they created. SECURITY DEFINER; requires active occupancy on the authorization''s scope unit. Idempotent on already-revoked/cancelled. Rejects completed/expired as NOT_REVOKABLE. Flips both the authorization and its live credentials atomically.';
