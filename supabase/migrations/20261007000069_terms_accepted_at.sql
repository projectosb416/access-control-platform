-- ============================================================================
-- Migration 0069: terms_accepted_at on accounts
-- ============================================================================
-- Purpose:
--   Record when an account holder accepted the terms of service at
--   signup. The checkbox is a UX gate, not a security boundary — the
--   timestamp is server-authoritative (written by the trigger when
--   the client passes the flag), not client-supplied.
--
-- Metadata channel:
--   The existing trigger handle_new_auth_user() already reads
--   new.raw_user_meta_data->>'display_name'. This migration extends
--   it to also read new.raw_user_meta_data->>'terms_accepted'. When
--   the value is the string 'true', the trigger writes now() into the
--   new column; otherwise it writes NULL.
--
-- Why NULL and not an exception:
--   The trigger fires from Supabase Auth's internal signup path. We
--   cannot reject a signup at this layer without breaking auth. NULL
--   is the honest signal for two cases: (a) an account created before
--   this migration existed, (b) an account created without going
--   through the ToS gate. Both are worth distinguishing from a real
--   acceptance, and neither is a bug.
--
-- No backfill:
--   Existing rows keep NULL. There is no reliable way to reconstruct
--   when historical accounts would have accepted terms. Production
--   has zero accounts pre-migration (fresh install, platform admin
--   only); staging has a handful. NULL is correct.
--
-- Why a boolean flag and not a client-supplied timestamp:
--   A client could backdate or forward-date its own acceptance. The
--   server controls now(). Milliseconds of difference from the
--   client's observation are not worth the trust cost.
--
-- Trigger not recreated:
--   Only the function body changes. The trigger object points at the
--   function by name; create or replace is sufficient. No ALTER
--   TRIGGER needed.
--
-- Preserved from the previous function body verbatim:
--   - The 'pending_activation' status value. New accounts continue
--     to enter pending_activation, matching the existing activation
--     flow. This migration does NOT change account lifecycle.
--   - Inline coalesce for display_name (no DECLARE block added).
--   - The exact column list order for the insert (auth_user_id,
--     display_name, status) is extended, not reordered.
-- ============================================================================


alter table public.accounts
  add column terms_accepted_at timestamptz;

comment on column public.accounts.terms_accepted_at is
  'When the account holder accepted terms of service at signup. NULL for accounts created before tracking existed, or created without going through the ToS gate. Server-authoritative.';


-- ----------------------------------------------------------------------------
-- Extend handle_new_auth_user() to read terms_accepted from metadata.
-- Byte-preserving: only adds terms_accepted_at to the column list and
-- a case-expression to the values list. Everything else identical.
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.accounts (
    auth_user_id, display_name, status, terms_accepted_at
  )
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      split_part(new.email, '@', 1)
    ),
    'pending_activation',
    case
      when new.raw_user_meta_data->>'terms_accepted' = 'true' then now()
      else null
    end
  );
  return new;
end;
$$;
