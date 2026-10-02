-- ============================================================================
-- Migration 0059: cancel_subscription
-- ============================================================================
-- Purpose:
--   Org admin (or platform admin) cancels the current operational
--   subscription for their organization. Immediate effect: status flips
--   to 'cancelled', is_org_operational() returns false, the 12 tenant
--   INSERT policies from migration 0022 engage.
--
-- What cancellation DOES NOT do — deliberate, not default:
--
--   Cancellation does not revoke existing access. The access engine
--   (evaluate_entry, evaluate_exit, start_shift_session, end_shift_session)
--   has NO subscription check by design — see 0022's own header comment:
--   "The access engine ... is deliberately untouched."
--
--   Therefore:
--     - Active guard shifts continue to function until they end
--     - Valid guest PINs continue to work at the gate
--     - Standing household-member credentials continue to work
--     - A visitor inside the property can always exit
--       (§23: exit is always allowed; blocking it is a safety violation)
--
--   What changes: no NEW shifts, no NEW people, no NEW properties, units,
--   gates, guards, or authorizations. Existing activity winds down
--   naturally. This is the documented intent of the enforcement model —
--   "gate operations wind down naturally" (0022 summary).
--
--   Rationale: the subscription is prepaid for the period. Cutting active
--   access mid-period would be punitive and physically unsafe. Wind-down
--   honors the paid period while stopping new activity.
--
-- Immediate vs. scheduled cancellation:
--   This migration makes cancellation IMMEDIATE. Standard SaaS practice
--   is often cancel-at-period-end; that requires a schema addition
--   (e.g. cancel_at_period_end boolean) and a modification to the
--   subscription-expiry checker (0033). Deferred to v2, alongside the
--   platform-admin upgrade-confirmation UI, because both touch the same
--   schema area. v1 UI copy must be honest: "Cancelling ends your access
--   immediately. Unused time is not refunded."
--
-- No revocation of already-issued authorizations, no gate closures, no
-- notification cascade — none of that is required for correctness.
-- Existing data stays readable and editable per 0022.
--
-- Errors:
--   NOT_AUTHENTICATED
--   NOT_AUTHORIZED            — caller is neither org admin nor platform admin
--   NO_ACTIVE_SUBSCRIPTION    — org has no operational subscription
--
-- Idempotency:
--   Calling cancel on an already-cancelled subscription returns silently.
--   Double-tap on the confirm dialog is benign.
-- ============================================================================

create or replace function public.cancel_subscription(
  p_organization_id uuid,
  p_reason          text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_sub        record;
begin
  -- 1. Authenticated.
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- 2. Caller must be org admin or platform admin.
  if not public.is_org_admin(p_organization_id)
     and not public.is_platform_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- 3. Find and lock the current operational subscription.
  select s.id, s.status
    into v_sub
    from public.subscriptions s
   where s.organization_id = p_organization_id
     and s.status in ('trial','active','past_due','grace_period')
   for update;

  if not found then
    -- Idempotent: if the only row is already cancelled, treat as success.
    -- Distinguish "no subscription at all" from "already cancelled".
    if exists (
      select 1 from public.subscriptions s
       where s.organization_id = p_organization_id
         and s.status = 'cancelled'
    ) then
      return;
    end if;
    raise exception 'NO_ACTIVE_SUBSCRIPTION';
  end if;

  -- 4. Flip to cancelled. cancelled_at is coupled to status='cancelled'
  --    by the CHECK constraint subscriptions_cancelled_consistency.
  update public.subscriptions s
     set status        = 'cancelled',
         cancelled_at  = now(),
         cancelled_by  = v_account_id,
         cancel_reason = coalesce(p_reason, 'cancelled by admin')
   where s.id = v_sub.id;

  -- 5. Audit — same transaction as the state change.
  perform public.log_audit_event(
    p_organization_id,
    v_account_id,
    'subscription.cancelled',
    'subscription',
    v_sub.id,
    p_reason,
    jsonb_build_object(
      'previous_status', v_sub.status
    )
  );
end;
$$;

comment on function public.cancel_subscription(uuid, text) is
  'Cancels the current operational subscription. Immediate effect: no NEW tenant activity; existing activity (shifts, PINs, exits) continues. Idempotent. Org admin or platform admin.';
