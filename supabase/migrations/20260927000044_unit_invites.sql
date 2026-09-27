-- ============================================================================
-- Migration 0044: unit invite support on occupancies
-- ============================================================================
-- Purpose:
--   Enable an admin to invite a Primary Resident for a vacant unit. The
--   invitation is a single-use code that the recipient redeems (piece 2)
--   to create an account, person row, and active occupancy.
--
--   Pattern mirrors household_members (migration 0031), which solved the
--   same "invited but not yet redeemed" problem at unit level:
--
--     account_id      — nullable until redemption
--     status='invited' — pre-redemption state
--     invite_code_hash — single-use, cleared on redemption
--     invite_expires_at — hard expiry, admin-configured
--
-- Changes to occupancies:
--   1. account_id loses NOT NULL (invited rows have no account yet)
--   2. Extend status CHECK to include 'invited'
--   3. Three new columns: invite_code_hash, invite_expires_at, invited_at
--   4. Consistency constraint: 'invited' requires hash + expiry + null account
--   5. Partial unique index on invite_code_hash (single-use across all rows)
--   6. Partial unique index: at most one 'invited' per unit
--
-- Not changed:
--   - RLS. Existing policies are already correct: invited rows have null
--     account so self-select doesn't match, admin-select does. No policy
--     changes needed.
--   - occupancies_one_active_per_unit — this index on status='active' is
--     unaffected by a new index on status='invited'.
--   - occupancies_end_consistency — 'invited' does not trigger it.
--
-- One live invite per unit: the generate_unit_invite() function (built
-- separately) supersedes any existing 'invited' row before inserting a
-- new one, so the partial unique index is satisfied.
-- ============================================================================

-- 1. account_id may be NULL for invited (pre-redemption) rows.
alter table public.occupancies
  alter column account_id drop not null;

-- 2. Extend the status CHECK. Drop defensively in case the constraint
--    name was auto-generated differently than we expect.
alter table public.occupancies
  drop constraint if exists occupancies_status_check;

alter table public.occupancies
  add constraint occupancies_status_check
    check (status in ('pending', 'active', 'invited', 'ended', 'cancelled'));

-- 3. New columns.
alter table public.occupancies
  add column invite_code_hash   text,
  add column invite_expires_at  timestamptz,
  add column invited_at         timestamptz;

comment on column public.occupancies.invite_code_hash is
  'SHA-256 hex of the single-use unit invite code. Cleared on redemption.';

comment on column public.occupancies.invite_expires_at is
  'Absolute expiry for the invite. App compares against now() at read time.';

comment on column public.occupancies.invited_at is
  'When the invite was generated. Audit trail — not the same as created_at.';

-- 4. Consistency constraint: 'invited' requires hash, expiry, timestamp,
--    and no account yet.
alter table public.occupancies
  add constraint occupancies_invited_consistency
    check (
      status <> 'invited'
      or (account_id is null
          and invite_code_hash is not null
          and invite_expires_at is not null
          and invited_at is not null)
    );

-- 5. Single-use codes. Cleared on redemption, so historical rows don't
--    compete for uniqueness.
create unique index occupancies_invite_code_unique
  on public.occupancies(invite_code_hash)
  where invite_code_hash is not null;

-- 6. At most one live invite per unit at any time.
create unique index occupancies_one_invite_per_unit
  on public.occupancies(unit_id)
  where status = 'invited';
