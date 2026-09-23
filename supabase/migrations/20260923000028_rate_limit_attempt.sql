-- ============================================================================
-- Migration 0028: rate_limit_attempt — single-transaction atomic wrapper
-- ============================================================================
-- Purpose:
--   Fold check_rate_limit + record_rate_limit_attempt + lock_scope into
--   ONE atomic Postgres call. Called by the Worker before PIN verification.
--
--   Why this exists (orchestrator refinement, accepted):
--     If the Worker did check → verify → record → lock as four separate
--     round trips, two concurrent requests could both pass "check" before
--     either "records" — reintroducing the race that Section 23 forbids.
--     The atomic wrapper closes that window.
--
-- Trade-off (explicit, accepted by orchestrator):
--   Since check and record happen together BEFORE PBKDF2, SUCCESSFUL
--   attempts also increment the counter. A visitor entering their PIN
--   once counts as one attempt against the window. Policy must set max
--   values high enough to accommodate legitimate traffic. Per-scope
--   guidance: credential 10/min, gate 100/min, guard 50/min.
--
-- Serialization:
--   pg_advisory_xact_lock(hashtextextended(scope_type || ':' || scope_id))
--   serializes all concurrent calls for the same scope for the duration
--   of the transaction. Released automatically at commit/rollback. No
--   deadlock risk — only one lock is acquired per call.
--
-- Caller mapping (Worker-side):
--   credential → used after lookup_key resolution, before PBKDF2 verify
--   gate       → used at gate entry/exit attempt
--   guard      → used at guard-level attempt boundary
--
-- Return:
--   allowed             boolean — may the caller proceed?
--   current_count       int     — window sum AFTER this attempt
--   retry_after_seconds int     — 0 if allowed; else seconds until next try
--   lockout_applied     boolean — did this call trigger a lockout?
-- ============================================================================

create or replace function public.rate_limit_attempt(
  p_scope_type      text,
  p_scope_id        uuid,
  p_window_seconds  int,
  p_max_attempts    int,
  p_lockout_seconds int,
  p_bucket_seconds  int default 10
)
returns table (
  allowed             boolean,
  current_count       int,
  retry_after_seconds int,
  lockout_applied     boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_key       bigint;
  v_lockout_until  timestamptz;
  v_retry_after    int;
  v_bucket_start   timestamptz;
  v_new_count      int;
  v_window_count   int;
  v_oldest_bucket  timestamptz;
begin
  -- -------------------------------------------------------------------------
  -- 1. Input validation
  -- -------------------------------------------------------------------------
  if p_scope_type is null
     or p_scope_type not in ('credential','gate','guard') then
    raise exception 'INVALID_SCOPE_TYPE';
  end if;

  if p_window_seconds is null or p_window_seconds <= 0 then
    raise exception 'INVALID_WINDOW_SECONDS';
  end if;

  if p_max_attempts is null or p_max_attempts <= 0 then
    raise exception 'INVALID_MAX_ATTEMPTS';
  end if;

  if p_lockout_seconds is null or p_lockout_seconds < 0 then
    raise exception 'INVALID_LOCKOUT_SECONDS';
  end if;

  if p_bucket_seconds is null
     or p_bucket_seconds <= 0
     or p_bucket_seconds > p_window_seconds then
    raise exception 'INVALID_BUCKET_SECONDS';
  end if;

  -- -------------------------------------------------------------------------
  -- 2. Serialize all concurrent calls for this scope
  -- -------------------------------------------------------------------------
  v_lock_key := hashtextextended(p_scope_type || ':' || p_scope_id::text, 0);
  perform pg_advisory_xact_lock(v_lock_key);

  -- -------------------------------------------------------------------------
  -- 3. Active lockout check — takes precedence over everything
  -- -------------------------------------------------------------------------
  select lockout_until into v_lockout_until
    from public.rate_limit_lockouts
   where scope_type = p_scope_type
     and scope_id = p_scope_id
     and lockout_until > now()
   limit 1;

  if found then
    v_retry_after := greatest(1, extract(epoch from (v_lockout_until - now()))::int);
    return query select false, 0, v_retry_after, false;
    return;
  end if;

  -- -------------------------------------------------------------------------
  -- 4. Record this attempt — atomic upsert of the current 10-second bucket
  -- -------------------------------------------------------------------------
  v_bucket_start := to_timestamp(
    floor(extract(epoch from now()) / p_bucket_seconds) * p_bucket_seconds
  );

  insert into public.rate_limit_buckets (scope_type, scope_id, bucket_start, attempt_count)
  values (p_scope_type, p_scope_id, v_bucket_start, 1)
  on conflict (scope_type, scope_id, bucket_start)
  do update set attempt_count = rate_limit_buckets.attempt_count + 1
  returning attempt_count into v_new_count;

  -- -------------------------------------------------------------------------
  -- 5. Sum the sliding window
  -- -------------------------------------------------------------------------
  select coalesce(sum(attempt_count), 0)::int, min(bucket_start)
    into v_window_count, v_oldest_bucket
    from public.rate_limit_buckets
   where scope_type = p_scope_type
     and scope_id = p_scope_id
     and bucket_start >= now() - make_interval(secs => p_window_seconds);

  -- -------------------------------------------------------------------------
  -- 6. Threshold check and lockout
  -- -------------------------------------------------------------------------
  if v_window_count > p_max_attempts then
    if p_lockout_seconds > 0 then
      insert into public.rate_limit_lockouts (
        scope_type, scope_id, locked_at, lockout_until, reason
      ) values (
        p_scope_type, p_scope_id, now(),
        now() + make_interval(secs => p_lockout_seconds),
        'threshold exceeded: ' || v_window_count || ' attempts in ' || p_window_seconds || 's'
      )
      on conflict (scope_type, scope_id)
      do update set
        locked_at     = now(),
        lockout_until = now() + make_interval(secs => p_lockout_seconds),
        reason        = excluded.reason;

      v_retry_after := p_lockout_seconds;
      return query select false, v_window_count, v_retry_after, true;
      return;
    else
      -- Lockout disabled — deny but don't lock. Retry when the oldest
      -- bucket falls out of the window.
      v_retry_after := greatest(1, extract(epoch from (
        v_oldest_bucket + make_interval(secs => p_window_seconds) - now()
      ))::int);
      return query select false, v_window_count, v_retry_after, false;
      return;
    end if;
  end if;

  -- -------------------------------------------------------------------------
  -- 7. Allowed
  -- -------------------------------------------------------------------------
  return query select true, v_window_count, 0, false;
end;
$$;

comment on function public.rate_limit_attempt(text, uuid, int, int, int, int) is
  'Atomic rate-limit check + record + lock. Serialized per scope via pg_advisory_xact_lock. Called by the Worker before PIN verification.';

-- ============================================================================
-- Note on the pre-existing functions:
--   check_rate_limit, record_rate_limit_attempt, lock_scope remain in place.
--   They are still useful as building blocks and for tests. The Worker uses
--   only rate_limit_attempt — one call, one transaction.
-- ============================================================================
