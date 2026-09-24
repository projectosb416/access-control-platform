-- ============================================================================
-- Migration 0036: install pgTAP
-- ============================================================================
-- Purpose:
--   pgTAP is the Postgres testing framework. Test files live in
--   supabase/tests/ and run via `supabase test db` — in CI only, since the
--   Supabase CLI cannot run on the Termux development host.
--
--   Installed into the `extensions` schema (Supabase convention). Test
--   files set search_path to include both public and extensions so the
--   pgTAP assertion functions resolve.
--
--   Idempotent — safe to apply more than once.
-- ============================================================================

create extension if not exists pgtap with schema extensions;

comment on extension pgtap is
  'Postgres testing framework. Used by supabase/tests/ files, run via CI job test-db.';
