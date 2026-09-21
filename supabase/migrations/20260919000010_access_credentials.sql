-- ============================================================================
-- Migration 0010: access_credentials
-- ============================================================================
-- Purpose:
--   Store the PIN credential attached to an authorization. Never the raw PIN —
--   only a verifiable, self-describing representation.
--
--   Representation: PHC-style string (single column), e.g.
--     $pbkdf2-sha256$i=100000$<salt_b64>$<hash_b64>
--
--   Self-describing format means algorithm parameters travel with the
--   credential. Future parameter upgrades do not invalidate existing rows.
--
--   PIN hashing happens in application code (Cloudflare Worker), not here.
--   The pepper lives in Cloudflare Worker secrets, never in this database.
--   pepper_version is recorded separately because it is not part of PHC.
--
--   Lifecycle (handoff §20):
--     CREATED → ACTIVE → IN_USE → CONSUMED
--     exceptional EXPIRED / REVOKED / CANCELLED
--
--   RLS posture (strongest):
--     RLS is enabled. No policies are defined — for any role. This means
--     only the service role (which bypasses RLS) can read or write this
--     table. Application users (admin, primary resident, guard, person)
--     never query it directly. Anything they need to know about a credential
--     (its status) is served through a service-role API that returns only
--     safe fields — never the hash.
--
--     This prevents a compromised admin session from ever obtaining PIN
--     hashes for offline attack, and keeps raw credential material out of
--     every client path. Matches Phase 4 Security & RLS doc §3.
-- ============================================================================

create table public.access_credentials (
  id                uuid primary key default public.uuidv7(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  authorization_id  uuid not null references public.authorizations(id) on delete restrict,

  -- PHC-style single string: algorithm, params, salt, hash.
  -- Never the raw PIN. Format is versioned by the algorithm prefix.
  credential        text not null,

  -- Which pepper hashed this credential. The pepper itself lives in Cloudflare
  -- Worker secrets — this column only records the version label so that
  -- rotation is possible without invalidating live credentials.
  pepper_version    text not null default 'v1',

  status            text not null default 'created'
                    check (status in (
                      'created','active','in_use','consumed',
                      'expired','revoked','cancelled'
                    )),

  activated_at      timestamptz,
  consumed_at       timestamptz,
  revoked_at        timestamptz,
  revoked_by        uuid references public.accounts(id) on delete set null,
  revoke_reason     text,

  created_by        uuid references public.accounts(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint access_credentials_credential_not_blank
    check (length(btrim(credential)) > 0),

  -- PHC string must start with $ (self-describing format).
  constraint access_credentials_credential_phc_shape
    check (credential like '$%'),

  constraint access_credentials_consume_consistency
    check ((status = 'consumed') = (consumed_at is not null)),

  constraint access_credentials_revoke_consistency
    check ((status = 'revoked') = (revoked_at is not null))
);

comment on table public.access_credentials is
  'PIN credentials attached to authorizations. Never stores raw PINs.';

comment on column public.access_credentials.credential is
  'PHC-style string: $pbkdf2-sha256$i=<iterations>$<salt_b64>$<hash_b64>. Pepper already mixed in before derivation.';

comment on column public.access_credentials.pepper_version is
  'Which pepper version hashed this credential. Enables pepper rotation without re-hashing live credentials.';

create trigger access_credentials_set_updated_at
  before update on public.access_credentials
  for each row execute function public.set_updated_at();

create index access_credentials_organization_id on public.access_credentials(organization_id);
create index access_credentials_authorization_id on public.access_credentials(authorization_id);

-- At most one live credential per authorization. Historical credentials
-- (consumed, expired, revoked, cancelled) are kept for audit.
create unique index access_credentials_one_active_per_authorization
  on public.access_credentials(authorization_id)
  where status in ('created','active','in_use');

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
-- RLS enabled, no policies.
--
-- Effect: no user-facing role can SELECT, INSERT, UPDATE, or DELETE. Only
-- the service role — used exclusively in server-side code, never exposed to
-- the browser — can touch this table.
--
-- The application layer exposes credential *status* through a service-role
-- endpoint that returns only safe fields (status, activated_at, consumed_at,
-- revoked_at). The `credential` and `pepper_version` columns never leave the
-- database except into the service-role process memory for verification.

alter table public.access_credentials enable row level security;

-- No SELECT policies  — no user role may read credential rows.
-- No INSERT policies  — credentials are created only by service role.
-- No UPDATE policies  — status transitions happen only via service role.
-- No DELETE policies  — never hard-deleted; revocation is a status change.

-- ============================================================================
-- Note for future hardening review:
--   If we ever need admin-visible credential metadata through RLS (rather
--   than through a service-role API), it must be exposed via a column-safe
--   view or a SECURITY DEFINER function that returns only whitelisted
--   columns — never a table-level SELECT policy on this table.
-- ============================================================================
