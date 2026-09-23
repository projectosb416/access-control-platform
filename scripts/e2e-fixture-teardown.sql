-- ============================================================================
-- E2E fixture teardown
-- ============================================================================
-- Makes the e2e test tenant completely inert after a regression test.
--
-- Why soft-shutdown and not hard-delete:
--   audit_events is immutable by design (migration 0024) — UPDATE, DELETE,
--   and TRUNCATE all raise. audit_events.organization_id also has ON DELETE
--   RESTRICT. So the org cannot be physically deleted while audit history
--   exists, and that is correct behavior per handoff §38 ("do not hard-delete
--   where history is required").
--
--   Instead, every operational status moves to a terminal state:
--     - subscription cancelled  -> is_org_operational() returns false
--     - credential revoked      -> no PIN can be used
--     - authorization revoked   -> no session can be opened
--     - guard inactive          -> cannot start shifts
--     - shift cancelled         -> no sessions can attach
--     - gate archived           -> capacity checks fail
--     - org closed              -> tenant-level shutdown
--
--   Audit history is preserved. Every test action remains reviewable.
--
-- Verification: after run, POST to /api/guard-session/start for this org
-- should return HTTP 409 (SHIFT_NOT_OPEN or similar), proving the fixture
-- is no longer operable through the deployed Worker.
-- ============================================================================

begin;

update public.access_credentials
   set status = 'revoked',
       revoked_at = now(),
       revoke_reason = 'e2e fixture shutdown'
 where organization_id = 'e0000000-0000-0000-0000-000000000010'
   and status in ('created','active','in_use');

update public.authorizations
   set status = 'revoked',
       revoked_at = now(),
       revoke_reason = 'e2e fixture shutdown'
 where organization_id = 'e0000000-0000-0000-0000-000000000010'
   and status in ('active','in_progress');

update public.guard_profiles
   set status = 'inactive'
 where organization_id = 'e0000000-0000-0000-0000-000000000010'
   and status = 'active';

update public.shifts
   set status = 'cancelled',
       cancelled_at = now(),
       cancel_reason = 'e2e fixture shutdown'
 where organization_id = 'e0000000-0000-0000-0000-000000000010'
   and status in ('scheduled','active');

update public.gates
   set status = 'archived'
 where organization_id = 'e0000000-0000-0000-0000-000000000010'
   and status = 'active';

update public.people
   set status = 'archived'
 where organization_id = 'e0000000-0000-0000-0000-000000000010'
   and status = 'active';

update public.subscriptions
   set status = 'cancelled',
       cancelled_at = now(),
       cancel_reason = 'e2e fixture shutdown'
 where organization_id = 'e0000000-0000-0000-0000-000000000010'
   and status in ('trial','active','past_due','grace_period');

update public.organizations
   set status = 'closed'
 where id = 'e0000000-0000-0000-0000-000000000010';

commit;

select
  (select status from public.organizations where id = 'e0000000-0000-0000-0000-000000000010') as org_status,
  (select status from public.subscriptions where organization_id = 'e0000000-0000-0000-0000-000000000010' order by created_at desc limit 1) as sub_status,
  (select status from public.guard_profiles where organization_id = 'e0000000-0000-0000-0000-000000000010' limit 1) as guard_status,
  (select status from public.gates where organization_id = 'e0000000-0000-0000-0000-000000000010' limit 1) as gate_status,
  (select status from public.shifts where organization_id = 'e0000000-0000-0000-0000-000000000010' limit 1) as shift_status,
  (select status from public.access_credentials where organization_id = 'e0000000-0000-0000-0000-000000000010' limit 1) as cred_status,
  (select status from public.authorizations where organization_id = 'e0000000-0000-0000-0000-000000000010' limit 1) as auth_status;
