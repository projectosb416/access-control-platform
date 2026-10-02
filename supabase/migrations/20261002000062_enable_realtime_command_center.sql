-- ============================================================================
-- Migration 0062: enable Realtime on Command Center source tables
-- ============================================================================
-- Purpose:
--   Add three tables to the supabase_realtime publication so the Command
--   Center's live updates work. Without this, subscribing to
--   postgres_changes returns no events, and B2's Realtime wiring is inert.
--
-- Tables added:
--   access_events     — Live activity panel
--   access_sessions   — Currently inside panel + attention banner
--   shift_sessions    — Shifts in progress + Gates panel guard counts
--
-- Tables NOT added (deliberate):
--   gates, people, shifts, authorizations — change rarely (admin action
--   only). The Refresh button covers them. Adding them would widen the
--   change stream without meaningfully improving freshness.
--
-- RLS behavior:
--   Supabase Realtime respects RLS on the publishing side. A subscriber
--   only receives changes for rows they could SELECT. The existing
--   policies (access_events_select_admin, access_sessions_select_admin,
--   shift_sessions_select_admin_or_own) already scope to the admin's
--   org — no RLS change is needed. This is why enabling Realtime is
--   safe here and does not require new policies or SECURITY DEFINER
--   wrappers, unlike the writes that had to be routed through functions
--   in 0053/0055/0057.
--
-- Idempotency:
--   ALTER PUBLICATION ... ADD TABLE raises if the table is already in
--   the publication. Wrapped in a DO block that checks
--   pg_publication_tables first — same discipline as 0058's seed.
--   Re-running this migration against an already-enabled staging DB
--   is a no-op.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'access_events'
  ) then
    alter publication supabase_realtime add table public.access_events;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'access_sessions'
  ) then
    alter publication supabase_realtime add table public.access_sessions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'shift_sessions'
  ) then
    alter publication supabase_realtime add table public.shift_sessions;
  end if;
end
$$;
