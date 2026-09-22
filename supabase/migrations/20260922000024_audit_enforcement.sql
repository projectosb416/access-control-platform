-- ============================================================================
-- Migration 0024: audit enforcement
-- ============================================================================
-- Purpose:
--   Two related fixes:
--
--   1. Make audit_events physically immutable. RLS already blocks user
--      writes (zero policies), but the service role bypasses RLS. A
--      BEFORE UPDATE / DELETE / TRUNCATE trigger stops even the service
--      role from rewriting history.
--
--   2. Add audit calls inside the governance functions that change state
--      without leaving an audit trail. Confirmed by the Phase 7 review:
--      confirm_manual_payment, cancel_manual_payment, resolve_session,
--      mark_session_unresolved, and record_payment_webhook all mutate
--      tenant state but wrote nothing to audit_events.
--
-- Placement rule (orchestrator refinement, accepted):
--   The audit insert happens inside the SAME transaction as the state
--   change it records. If the state change commits, the audit row commits.
--   If either fails, both roll back. No window where a state change
--   exists without its audit entry.
--
-- NOT audited here:
--   create_subscription_from_payment — internal helper called by the two
--   payment entry points. Auditing it would double-log one admin action.
--   Physical access events are not audited here either — they are logged
--   to access_events, which is a separate append-only ledger.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Immutable trigger
-- ----------------------------------------------------------------------------
-- Raises an exception on any UPDATE, DELETE, or TRUNCATE. Fires for every
-- role, including service role. If a future migration ever needs to modify
-- audit_events, it must explicitly ALTER TABLE ... DISABLE TRIGGER first —
-- a deliberate, reviewable act.

create or replace function public.prevent_audit_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events are immutable';
end;
$$;

comment on function public.prevent_audit_event_mutation() is
  'Trigger function: refuses any UPDATE, DELETE, or TRUNCATE on audit_events.';

create trigger audit_events_immutable_update
  before update on public.audit_events
  for each row execute function public.prevent_audit_event_mutation();

create trigger audit_events_immutable_delete
  before delete on public.audit_events
  for each row execute function public.prevent_audit_event_mutation();

create trigger audit_events_immutable_truncate
  before truncate on public.audit_events
  for each statement execute function public.prevent_audit_event_mutation();


-- ----------------------------------------------------------------------------
-- 2. confirm_manual_payment — add audit call
-- ----------------------------------------------------------------------------

create or replace function public.confirm_manual_payment(
  p_payment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment      record;
  v_admin_id     uuid;
  v_sub_id       uuid;
begin
  v_admin_id := public.current_account_id();

  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN';
  end if;

  select * into v_payment
    from public.payment_transactions
   where id = p_payment_id;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  if v_payment.source <> 'manual' then
    raise exception 'NOT_MANUAL_PAYMENT';
  end if;

  -- Idempotent: already confirmed → return existing subscription.
  if v_payment.status = 'succeeded' then
    return v_payment.subscription_id;
  end if;

  if v_payment.status <> 'pending_confirmation' then
    raise exception 'PAYMENT_NOT_PENDING';
  end if;

  update public.payment_transactions
     set status = 'succeeded',
         confirmed_at = now(),
         confirmed_by = v_admin_id
   where id = p_payment_id;

  v_sub_id := public.create_subscription_from_payment(p_payment_id);

  -- Audit: platform admin confirmed a manual payment.
  perform public.log_audit_event(
    v_payment.organization_id,
    v_admin_id,
    'subscription.payment_confirmed',
    'payment_transaction',
    p_payment_id,
    null,
    jsonb_build_object(
      'subscription_id', v_sub_id,
      'amount_minor_units', v_payment.amount_minor_units,
      'currency', v_payment.currency,
      'provider_reference', v_payment.provider_reference
    )
  );

  return v_sub_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- 3. cancel_manual_payment — add audit call
-- ----------------------------------------------------------------------------

create or replace function public.cancel_manual_payment(
  p_payment_id uuid,
  p_reason     text default 'cancelled'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
begin
  select * into v_payment
    from public.payment_transactions
   where id = p_payment_id;

  if not found then
    raise exception 'PAYMENT_NOT_FOUND';
  end if;

  if v_payment.status <> 'pending_confirmation' then
    raise exception 'PAYMENT_NOT_PENDING';
  end if;

  if not public.is_org_admin(v_payment.organization_id)
     and not public.is_platform_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  update public.payment_transactions
     set status = 'failed',
         failure_reason = p_reason
   where id = p_payment_id;

  perform public.log_audit_event(
    v_payment.organization_id,
    public.current_account_id(),
    'subscription.payment_cancelled',
    'payment_transaction',
    p_payment_id,
    p_reason,
    jsonb_build_object(
      'provider_reference', v_payment.provider_reference
    )
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- 4. mark_session_unresolved — add audit call
-- ----------------------------------------------------------------------------

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

  perform public.log_audit_event(
    p_organization_id,
    public.current_account_id(),
    'access_session.marked_unresolved',
    'access_session',
    p_session_id,
    p_reason,
    '{}'::jsonb
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- 5. resolve_session — add audit call
-- ----------------------------------------------------------------------------

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

  perform public.log_audit_event(
    p_organization_id,
    public.current_account_id(),
    'access_session.resolved',
    'access_session',
    p_session_id,
    p_reason,
    jsonb_build_object('resolution_notes', p_notes)
  );
end;
$$;


-- ----------------------------------------------------------------------------
-- 6. record_payment_webhook — add audit call
-- ----------------------------------------------------------------------------
-- System-triggered → actor is NULL. Idempotent replay returns early, no
-- audit written (a replay is not a new action).

create or replace function public.record_payment_webhook(
  p_organization_id    uuid,
  p_plan_id            uuid,
  p_purpose            text,
  p_provider           text,
  p_provider_reference text,
  p_amount_minor_units bigint,
  p_currency           text,
  p_status             text,
  p_failure_reason     text default null,
  p_provider_payload   jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_new_id      uuid;
begin
  -- Idempotency check.
  select id into v_existing_id
    from public.payment_transactions
   where provider = p_provider
     and provider_reference = p_provider_reference;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  v_new_id := public.uuidv7();

  insert into public.payment_transactions (
    id, organization_id, plan_id, purpose,
    source, provider, provider_reference,
    amount_minor_units, currency, status,
    failure_reason, provider_payload
  ) values (
    v_new_id, p_organization_id, p_plan_id, p_purpose,
    'webhook', p_provider, p_provider_reference,
    p_amount_minor_units, p_currency, p_status,
    p_failure_reason, coalesce(p_provider_payload, '{}'::jsonb)
  );

  if p_status = 'succeeded' then
    perform public.create_subscription_from_payment(v_new_id);
  end if;

  -- Audit: system-triggered (actor = NULL).
  perform public.log_audit_event(
    p_organization_id,
    null,
    'subscription.payment_webhook_recorded',
    'payment_transaction',
    v_new_id,
    null,
    jsonb_build_object(
      'provider', p_provider,
      'provider_reference', p_provider_reference,
      'status', p_status
    )
  );

  return v_new_id;
end;
$$;


-- ============================================================================
-- Summary of what this migration enforces:
--
--   audit_events becomes physically immutable — UPDATE, DELETE, and
--   TRUNCATE all raise an exception, regardless of role.
--
--   Every governance action now writes its audit row inside the same
--   transaction as the state change:
--     subscription.payment_confirmed       (platform admin confirms)
--     subscription.payment_cancelled       (either admin cancels)
--     subscription.payment_webhook_recorded (system, actor NULL)
--     access_session.marked_unresolved     (org admin)
--     access_session.resolved              (org admin)
--
--   Physical access is NOT audited here — access_events remains the
--   ledger for that, unchanged.
-- ============================================================================
