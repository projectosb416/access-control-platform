-- ============================================================================
-- Migration 0063: organizations_select_platform_admin
-- ============================================================================
-- Purpose:
--   Permit platform admins to read every organization, regardless of
--   org membership. Without this, the Platform Owner dashboard cannot
--   list tenants — the only existing SELECT policy on organizations is
--   organizations_select_member (is_org_member(id)), which scopes to
--   orgs the caller belongs to.
--
-- Drift note:
--   This policy existed on staging out-of-band before this migration.
--   The repo had no record. Formalized here with drop-if-exists +
--   create so:
--     - Staging (has policy) — drop + recreate to identical shape
--     - Fresh DB (no policy) — drop no-op, create builds it
--   Idempotent either way.
--
-- Pattern matches subscriptions_select_platform_admin (0019) and
-- payment_transactions_select_platform_admin (0020) — same
-- is_platform_admin() predicate, same "sits above the tenant
-- boundary" intent.
--
-- Bootstrap:
--   platform_admins starts empty. Grants are out-of-band (see 0004's
--   header comment). Staging has a grant for the dev account; the
--   production grant is a separate shipping-time step.
-- ============================================================================

drop policy if exists organizations_select_platform_admin on public.organizations;

create policy organizations_select_platform_admin on public.organizations
  for select
  using (public.is_platform_admin());
