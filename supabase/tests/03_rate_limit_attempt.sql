-- ============================================================================
-- Test: rate_limit_attempt
-- ============================================================================
-- Covers the atomic rate-limit wrapper: threshold, lockout, isolation
-- between scopes, and input validation.
--
-- Determinism: pgTAP runs inside one transaction, so now() is frozen.
-- Every attempt lands in the same 10-second bucket, making the window
-- count equal to the attempt count. No clock faking required.
--
-- Wrapped in begin/rollback. Fixtures use UUIDs prefixed 'b3'.
-- ============================================================================

begin;

set search_path = public, extensions;

select plan(11);

-- ============================================================================
-- Assertion 1: fresh scope → allowed, count=1
-- ============================================================================
select is(
  (select (allowed, current_count)::text from public.rate_limit_attempt(
    'gate', 'b3000000-0000-0000-0000-000000000001', 60, 5, 300, 10
  )),
  '(t,1)',
  'fresh gate scope allows first attempt with count 1'
);

-- ============================================================================
-- Assertions 2-5: attempts 2-5 keep count climbing, all allowed
-- ============================================================================
select is(
  (select (allowed, current_count)::text from public.rate_limit_attempt(
    'gate', 'b3000000-0000-0000-0000-000000000001', 60, 5, 300, 10
  )),
  '(t,2)',
  'attempt 2 allowed, count 2'
);

select is(
  (select (allowed, current_count)::text from public.rate_limit_attempt(
    'gate', 'b3000000-0000-0000-0000-000000000001', 60, 5, 300, 10
  )),
  '(t,3)',
  'attempt 3 allowed, count 3'
);

select is(
  (select (allowed, current_count)::text from public.rate_limit_attempt(
    'gate', 'b3000000-0000-0000-0000-000000000001', 60, 5, 300, 10
  )),
  '(t,4)',
  'attempt 4 allowed, count 4'
);

select is(
  (select (allowed, current_count)::text from public.rate_limit_attempt(
    'gate', 'b3000000-0000-0000-0000-000000000001', 60, 5, 300, 10
  )),
  '(t,5)',
  'attempt 5 allowed, count 5 (max reached but not exceeded)'
);

-- ============================================================================
-- Assertion 6: attempt 6 crosses threshold → denied + lockout applied
-- ============================================================================
select is(
  (select (allowed, current_count, lockout_applied)::text from public.rate_limit_attempt(
    'gate', 'b3000000-0000-0000-0000-000000000001', 60, 5, 300, 10
  )),
  '(f,6,t)',
  'attempt 6 denied and lockout applied'
);

-- ============================================================================
-- Assertion 7: attempt 7 denied by existing lockout, no new lockout
-- ============================================================================
select is(
  (select (allowed, lockout_applied)::text from public.rate_limit_attempt(
    'gate', 'b3000000-0000-0000-0000-000000000001', 60, 5, 300, 10
  )),
  '(f,f)',
  'attempt 7 denied by existing lockout without re-triggering'
);

-- ============================================================================
-- Assertion 8: different scope_id is isolated
-- ============================================================================
select is(
  (select (allowed, current_count)::text from public.rate_limit_attempt(
    'gate', 'b3000000-0000-0000-0000-000000000002', 60, 5, 300, 10
  )),
  '(t,1)',
  'a different gate scope starts fresh'
);

-- ============================================================================
-- Assertion 9: different scope_type is isolated
-- ============================================================================
select is(
  (select (allowed, current_count)::text from public.rate_limit_attempt(
    'guard', 'b3000000-0000-0000-0000-000000000001', 60, 5, 300, 10
  )),
  '(t,1)',
  'same uuid but different scope_type starts fresh'
);

-- ============================================================================
-- Assertion 10: invalid scope_type → INVALID_SCOPE_TYPE
-- ============================================================================
select throws_ok(
  $$select public.rate_limit_attempt(
    'not-a-scope', 'b3000000-0000-0000-0000-000000000001', 60, 5, 300, 10
  )$$,
  'P0001',
  'INVALID_SCOPE_TYPE',
  'invalid scope_type raises INVALID_SCOPE_TYPE'
);

-- ============================================================================
-- Assertion 11: zero max_attempts → INVALID_MAX_ATTEMPTS
-- ============================================================================
select throws_ok(
  $$select public.rate_limit_attempt(
    'gate', 'b3000000-0000-0000-0000-000000000001', 60, 0, 300, 10
  )$$,
  'P0001',
  'INVALID_MAX_ATTEMPTS',
  'zero max_attempts raises INVALID_MAX_ATTEMPTS'
);

select * from finish();

rollback;
