-- ============================================================================
-- Migration 0075: terms_version on accounts
-- ============================================================================
-- Purpose:
--   Records which version of the terms of service an account holder
--   accepted at signup. Companion to migration 0069 (terms_accepted_at).
--   Together, the two columns answer "did this account accept our
--   terms, and which revision did they accept".
--
-- Why a version column:
--   When the terms or privacy policy materially change, the client
--   bumps LEGAL_CONSENT_VERSION in lib/legal/version.ts. Existing
--   accounts keep the version they originally accepted. A dispute or
--   audit can then identify which revision each account is bound by.
--
-- Metadata channel:
--   handle_new_auth_user() reads new.raw_user_meta_data->>'terms_version'.
--   When terms_accepted is the string 'true', the version string (if
--   present) is stored; otherwise null.
--
-- No consistency constraint:
--   A client that sends terms_accepted=true but omits terms_version
--   will produce a row with terms_accepted_at set and terms_version
--   null. That is an honest signal of a client bug — the alternative
--   would break signup entirely. Clients are expected to always send
--   both; see app/admin/signup/page.tsx and
--   app/resident/join/[code]/join-client.tsx.
--
-- No backfill:
--   Existing rows keep terms_version = NULL. The timestamp on existing
--   rows (if any) still records when terms were accepted; the version
--   cannot be reconstructed.
--
-- Preserved from the previous function body verbatim:
--   - 'pending_activation' status value
--   - Inline coalesce for display_name
--   - The case-expression shape on terms_accepted
--   - Column list order (extended, not reordered)
--
-- Ambiguity discipline (§11):
--   Trigger body has no table alias, but the insert column list is
--   explicit and every reference is on `new`. No collision risk.
-- ============================================================================


alter table public.accounts
  add column terms_version text;

comment on column public.accounts.terms_version is
  'Version of the terms of service accepted at signup. NULL for accounts created before version tracking existed, or when the client did not provide a version in signup metadata. See LEGAL_CONSENT_VERSION in lib/legal/version.ts.';


-- ----------------------------------------------------------------------------
-- Extend handle_new_auth_user() to read terms_version from metadata.
-- Byte-preserving on all pre-existing lines; only the column list and
-- values list are extended.
-- ----------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.accounts (
    auth_user_id, display_name, status, terms_accepted_at, terms_version
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
    end,
    case
      when new.raw_user_meta_data->>'terms_accepted' = 'true'
        then new.raw_user_meta_data->>'terms_version'
      else null
    end
  );
  return new;
end;
$$;
