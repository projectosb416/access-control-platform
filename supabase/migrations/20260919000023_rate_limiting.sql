-- ============================================================================
-- Migration 0023: rate limiting
-- ============================================================================
-- Purpose:
--   Stop brute-force attacks against PINs and detect abuse at the gate.
--   This is the primary defense for 6-digit PINs — Phase 4's PIN-hash
--   verification proved the KDF alone cannot resist offline attack at
--   Workers' 100k iteration cap. Rate limiting + lockout carry the load.
--
-- Model — sliding window + explicit lockout:
--   1. Sliding window counter — attempts are counted in 10-second buckets.
--      To check the rate over a 60-second window, we sum the last ~6
--      buckets. The window truly slides, unlike fixed-window counters that
--      can be gamed at minute boundaries.
--
--   2. Explicit lockout — when the counter crosses the threshold, a lockout
--      row is written with an absolute expiry. Until then, no attempts are
--      processed. This is the layer that actually stops an attacker — the
--      counter is only the trigger.
--
-- Three scopes (Phase 4 Security & RLS doc §5):
--   'credential'  per PIN        — stops distributed brute force
--   'gate'        per gate       — detects insider misuse
--   'guard'       per guard      — detects compromised device
--
-- Integration:
--   The application layer (Cloudflare Worker) is the enforcement point —
--   it holds the pepper, verifies the PIN, and calls these functions:
--
--     1. check_rate_limit(...)       → if not allowed, log RATE_LIMITED, deny
--     2. PBKDF2 verify the PIN
--     3. if wrong: record_rate_limit_attempt(...)
--        if threshold crossed:   lock_scope(...)
--
--   The access engine (evaluate_entry / evaluate_exit) is untouched —
--   rate limiting happens before entry is even evaluated.
--
-- RLS posture — same as access_credentials:
--   Enabled, no policies. Service-role only. This is security
--   infrastructure, not user-visible data.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. rate_limit_buckets
-- ----------------------------------------------------------------------------
-- Bucketed counters. bucket_start is aligned to p_bucket_seconds boundaries
-- so multiple calls within the same 10-second window increment the same row.

create table public.rate_limit_buckets (
  scope_type     text not null
                 check (scope_type in ('credential','gate','guard')),
  scope_id       uuid not null,
  bucket_start   timestamptz not null,
  attempt_count  int not null default 0
                 check (attempt_count >= 0),

  primary key (scope_type, scope_id, bucket_start)
);

comment on table public.rate_limit_buckets is
  'Sliding-window counters, bucketed. Rows are cheap; purge regularly.';

comment on column public.rate_limit_buckets.bucket_start is
  'Aligned to 10-second boundaries. Upsert on conflict increments attempt_count.';

create index rate_limit_buckets_scope_start
  on public.rate_limit_buckets(scope_type, scope_id, bucket_start desc);

create index rate_limit_buckets_cleanup
  on public.rate_limit_buckets(bucket_start);


-- ----------------------------------------------------------------------------
-- 2. rate_limit_lockouts
-- ----------------------------------------------------------------------------
-- One active lockout per scope. Overwriting on conflict extends the lockout
-- if an attacker keeps trying during the lockout window — they can't wait
-- it out by continuing to fire attempts.

create table public.rate_limit_lockouts (
  scope_type     text not null
                 check (scope_type in ('credential','gate','guard')),
  scope_id       uuid not null,
  locked_at      timestamptz not null default now(),
  lockout_until  timestamptz not null,
  reason         text,

  primary key (scope_type, scope_id),
  constraint rate_limit_lockouts_time_order
    check (lockout_until > locked_at)
);

comment on table public.rate_limit_lockouts is
  'Active lockouts. One row per (scope_type, scope_id).';

create index rate_limit_lockouts_expiry
  on public.rate_limit_lockouts(lockout_until);


-- ----------------------------------------------------------------------------
-- 3. check_rate_limit
-- ----------------------------------------------------------------------------
-- Returns whether an attempt is currently allowed.
-- First checks lockout, then sums buckets within the given window.
-- Never mutates state — safe to call on every attempt, even allowed ones.

create or replace function public.check_rate_limit(
  p_scope_type      text,
  p_scope_id        uuid,
  p_window_seconds  int,
  p_max_attempts    int
)
returns table (
  allowed             boolean,
  current_count       int,
  retry_after_seconds int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lockout_until  timestamptz;
  v_count          int;
  v_oldest_bucket  timestamptz;
  v_retry_after    int;
begin
  -- 1. Lockout takes precedence.
  select lockout_until into v_lockout_until
    from public.rate_limit_lockouts
   where scope_type = p_scope_type
     and scope_id = p_scope_id
     and lockout_until > now()
   limit 1;

  if found then
    return query select
      false,
      0,
      greatest(1, extract(epoch from (v_lockout_until - now()))::int);
    return;
  end if;

  -- 2. Sum buckets within the sliding window.
  select
    coalesce(sum(attempt_count), 0)::int,
    min(bucket_start)
    into v_count, v_oldest_bucket
    from public.rate_limit_buckets
   where scope_type = p_scope_type
     and scope_id = p_scope_id
     and bucket_start >= now() - make_interval(secs => p_window_seconds);

  if v_count >= p_max_attempts then
    -- Retry when the oldest counted bucket falls out of the window.
    v_retry_after := greatest(
      1,
      extract(epoch from (
        v_oldest_bucket + make_interval(secs => p_window_seconds) - now()
      ))::int
    );
    return query select false, v_count, v_retry_after;
    return;
  end if;

  return query select true, v_count, 0;
end;
$$;

comment on function public.check_rate_limit(text, uuid, int, int) is
  'Returns (allowed, current_count, retry_after_seconds). Checks lockout then sliding-window count. Read-only.';


-- ----------------------------------------------------------------------------
-- 4. record_rate_limit_attempt
-- ----------------------------------------------------------------------------
-- Increments the current 10-second bucket for this scope. Returns the
-- new total count in the current bucket (NOT the window sum — the caller
-- decides whether to lock based on the window sum via check_rate_limit).

create or replace function public.record_rate_limit_attempt(
  p_scope_type     text,
  p_scope_id       uuid,
  p_bucket_seconds int default 10
)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_bucket_start timestamptz;
  v_new_count    int;
begin
  v_bucket_start := to_timestamp(
    floor(extract(epoch from now()) / p_bucket_seconds) * p_bucket_seconds
  );

  insert into public.rate_limit_buckets (scope_type, scope_id, bucket_start, attempt_count)
  values (p_scope_type, p_scope_id, v_bucket_start, 1)
  on conflict (scope_type, scope_id, bucket_start)
  do update set attempt_count = rate_limit_buckets.attempt_count + 1
  returning attempt_count into v_new_count;

  return v_new_count;
end;
$$;

comment on function public.record_rate_limit_attempt(text, uuid, int) is
  'Increments the current bucket. Returns new count for that bucket.';


-- ----------------------------------------------------------------------------
-- 5. lock_scope
-- ----------------------------------------------------------------------------
-- Sets or extends a lockout. Extending is intentional: an attacker who
-- keeps trying during a lockout makes it worse, not better.

create or replace function public.lock_scope(
  p_scope_type       text,
  p_scope_id         uuid,
  p_lockout_seconds  int,
  p_reason           text default null
)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
begin
  if p_lockout_seconds <= 0 then
    raise exception 'LOCKOUT_SECONDS_MUST_BE_POSITIVE';
  end if;

  v_until := now() + make_interval(secs => p_lockout_seconds);

  insert into public.rate_limit_lockouts (scope_type, scope_id, locked_at, lockout_until, reason)
  values (p_scope_type, p_scope_id, now(), v_until, p_reason)
  on conflict (scope_type, scope_id)
  do update set
    locked_at = now(),
    lockout_until = v_until,
    reason = coalesce(p_reason, rate_limit_lockouts.reason);

  return v_until;
end;
$$;

comment on function public.lock_scope(text, uuid, int, text) is
  'Sets or extends a lockout on a scope. Returns the lockout expiry.';


-- ----------------------------------------------------------------------------
-- 6. purge_old_rate_limit_data
-- ----------------------------------------------------------------------------
-- Housekeeping. Deletes buckets past their usefulness and lockouts long
-- expired. Called by scheduled cron (Phase 11) or manually.

create or replace function public.purge_old_rate_limit_data(
  p_bucket_retention_seconds int default 300
)
returns table (
  buckets_deleted  int,
  lockouts_deleted int
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_buckets  int;
  v_lockouts int;
begin
  with d as (
    delete from public.rate_limit_buckets
     where bucket_start < now() - make_interval(secs => p_bucket_retention_seconds)
    returning 1
  )
  select count(*) into v_buckets from d;

  with d as (
    delete from public.rate_limit_lockouts
     where lockout_until < now() - interval '24 hours'
    returning 1
  )
  select count(*) into v_lockouts from d;

  return query select v_buckets, v_lockouts;
end;
$$;

comment on function public.purge_old_rate_limit_data(int) is
  'Deletes stale buckets and expired lockouts. Returns (buckets_deleted, lockouts_deleted).';


-- ----------------------------------------------------------------------------
-- 7. Row Level Security
-- ----------------------------------------------------------------------------
-- Enabled, no policies. Service-role only. Same posture as access_credentials.

alter table public.rate_limit_buckets  enable row level security;
alter table public.rate_limit_lockouts enable row level security;

-- No SELECT policies  — no user role may read rate-limit state.
-- No INSERT policies  — writes only via the SECURITY DEFINER functions above.
-- No UPDATE policies  — same.
-- No DELETE policies  — purge runs with service role.

-- ============================================================================
-- Summary of the rate-limit model:
--
--   Application layer (Cloudflare Worker) calls, in order:
--     1. check_rate_limit(scope, id, window, max)     — is the attempt allowed?
--     2. If allowed: verify PIN via PBKDF2.
--     3. If PIN wrong: record_rate_limit_attempt(...) — increment bucket.
--     4. If window sum now exceeds threshold: lock_scope(..., 300, '...')
--     5. Log every attempt to access_events (RATE_LIMITED on rejection).
--
--   Three scopes serve three threats:
--     credential → distributed brute force on a single PIN
--     gate       → insider misuse or compromised guard device
--     guard      → single-account hammering
--
--   The access engine (evaluate_entry / evaluate_exit) is untouched.
--   Rate limiting is a precondition, not a part of the entry decision.
-- ============================================================================
