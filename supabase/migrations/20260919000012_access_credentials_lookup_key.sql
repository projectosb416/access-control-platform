-- ============================================================================
-- Migration 0012: add lookup_key to access_credentials
-- ============================================================================
-- Purpose:
--   Enable O(1) credential lookup by PIN without weakening the PBKDF2 hash.
--
-- Problem this solves:
--   PBKDF2 with a per-credential salt produces a different hash every time.
--   You cannot hash the incoming PIN and search for it. Without a lookup
--   key, ENTRY would have to fetch every active credential in the org and
--   PBKDF2-test each one — unusable at scale.
--
-- Solution:
--   A second, cheap, deterministic derivation alongside the PBKDF2 hash:
--
--     lookup_key = HMAC-SHA256(pepper, "org:" || organization_id || ":pin:" || raw_pin)
--
--   - Deterministic: same PIN + same org → same lookup_key. Enables index.
--   - Peppered: without the pepper, an attacker cannot reverse lookup_key
--     into the PIN. The pepper never lives in this database.
--   - Doesn't weaken PBKDF2: the actual credential verification still uses
--     the expensive PBKDF2 hash. lookup_key is only for finding the row.
--
--   This is the standard searchable-encryption pattern.
--
-- Flow at ENTRY (app layer, Cloudflare Worker):
--   1. Receive PIN + gate + guard session.
--   2. Compute lookup_key = HMAC(pepper, org || pin).
--   3. Query access_credentials by (organization_id, lookup_key).
--   4. PBKDF2(pin, salt, params, pepper) → constant-time compare with `credential`.
--   5. On match: pass to evaluate_entry() for state validation.
--   6. On mismatch: log INVALID_PIN event, deny.
--
-- Uniqueness:
--   Within an org, at most one LIVE credential can answer to a given PIN.
--   Enforced by a partial unique index over live statuses. Historical
--   credentials (consumed/expired/revoked/cancelled) don't block reuse —
--   the same PIN can be issued to a new visitor months later.
-- ============================================================================

-- The table is empty (created in migration 0011, no rows yet), so NOT NULL
-- can be added directly without a backfill step.
alter table public.access_credentials
  add column lookup_key         text not null,
  add column lookup_key_version text not null default 'v1';

comment on column public.access_credentials.lookup_key is
  'HMAC-SHA256(pepper, "org:" || organization_id || ":pin:" || raw_pin). Deterministic lookup. Never the raw PIN.';

comment on column public.access_credentials.lookup_key_version is
  'Which pepper version produced this lookup_key. Enables pepper rotation without reissuing live credentials.';

alter table public.access_credentials
  add constraint access_credentials_lookup_key_not_blank
    check (length(btrim(lookup_key)) > 0);

-- The index that makes ENTRY O(1). Partial: only live credentials compete
-- for uniqueness. Same btree serves the query (organization_id, lookup_key).
create unique index access_credentials_unique_live_lookup_key
  on public.access_credentials(organization_id, lookup_key)
  where status in ('created','active','in_use');

-- ============================================================================
-- Security note:
--   RLS on this table remains enabled with no policies (migration 0011).
--   Only the service role can read or write. lookup_key does not change
--   that — it is not exposed to any user-facing role.
-- ============================================================================
