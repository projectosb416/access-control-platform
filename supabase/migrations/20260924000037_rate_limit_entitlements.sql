-- ============================================================================
-- Migration 0037: rate-limit thresholds as entitlements
-- ============================================================================
-- Purpose:
--   Rate-limit thresholds are currently hardcoded in the Worker:
--     GATE_LIMIT = { window: 60, max: 50, lockout: 60 }
--     GUARD_LIMIT = { window: 60, max: 30, lockout: 60 }
--     CRED_LIMIT = { window: 60, max: 10, lockout: 300 }
--
--   A busy estate hitting the gate limit during a wedding cannot be tuned
--   without a code change and redeploy. This migration moves thresholds to
--   plan_entitlements (key-value, already used for other plan features).
--
--   Two new functions:
--     get_rate_limit_config(org_id, scope_type)   -> (window, max, lockout)
--     rate_limit_attempt_for_org(org_id, scope_type, scope_id)
--
--   The Worker no longer knows thresholds. It calls the wrapper with the
--   org and scope; Postgres looks up the plan and applies the config.
--
-- Entitlement keys (9 total):
--   rate_limit_gate_window_seconds
--   rate_limit_gate_max_attempts
--   rate_limit_gate_lockout_seconds
--   rate_limit_guard_window_seconds
--   rate_limit_guard_max_attempts
--   rate_limit_guard_lockout_seconds
--   rate_limit_credential_window_seconds
--   rate_limit_credential_max_attempts
--   rate_limit_credential_lockout_seconds
--
-- Defaults if unset — same values as the previous hardcoded constants.
-- No behavioral change for existing orgs.
--
-- No schema changes. Existing rate_limit_attempt stays as-is; the wrapper
-- calls it with the resolved config.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. get_rate_limit_config
-- ----------------------------------------------------------------------------

create or replace function public.get_rate_limit_config(
  p_organization_id uuid,
  p_scope_type      text
)
returns table (
  window_seconds  int,
  max_attempts    int,
  lockout_seconds int
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_plan_id uuid;
  v_window  int;
  v_max     int;
  v_lockout int;
  v_prefix  text;
begin
  if p_scope_type not in ('credential','gate','guard') then
    raise exception 'INVALID_SCOPE_TYPE';
  end if;

  -- Per-scope defaults. Matches the previous hardcoded values exactly.
  case p_scope_type
    when 'gate' then
      v_window := 60; v_max := 50; v_lockout := 60;
    when 'guard' then
      v_window := 60; v_max := 30; v_lockout := 60;
    when 'credential' then
      v_window := 60; v_max := 10; v_lockout := 300;
  end case;

  -- Find the plan behind the org's operational subscription, if any.
  select s.plan_id into v_plan_id
    from public.subscriptions s
   where s.organization_id = p_organization_id
     and s.status in ('trial','active','past_due','grace_period')
   order by s.current_period_end desc
   limit 1;

  if v_plan_id is null then
    return query select v_window, v_max, v_lockout;
    return;
  end if;

  v_prefix := 'rate_limit_' || p_scope_type || '_';

  -- Override defaults with plan entitlements if set.
  v_window := coalesce(
    (select (pe.entitlement_value#>>'{}')::int
       from public.plan_entitlements pe
      where pe.plan_id = v_plan_id
        and pe.entitlement_code = v_prefix || 'window_seconds'),
    v_window
  );

  v_max := coalesce(
    (select (pe.entitlement_value#>>'{}')::int
       from public.plan_entitlements pe
      where pe.plan_id = v_plan_id
        and pe.entitlement_code = v_prefix || 'max_attempts'),
    v_max
  );

  v_lockout := coalesce(
    (select (pe.entitlement_value#>>'{}')::int
       from public.plan_entitlements pe
      where pe.plan_id = v_plan_id
        and pe.entitlement_code = v_prefix || 'lockout_seconds'),
    v_lockout
  );

  return query select v_window, v_max, v_lockout;
end;
$$;

comment on function public.get_rate_limit_config(uuid, text) is
  'Resolves rate-limit thresholds for an org + scope from plan entitlements, with defaults if unset.';


-- ----------------------------------------------------------------------------
-- 2. rate_limit_attempt_for_org — wrapper
-- ----------------------------------------------------------------------------

create or replace function public.rate_limit_attempt_for_org(
  p_organization_id uuid,
  p_scope_type      text,
  p_scope_id        uuid,
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
  v_config record;
begin
  select * into v_config
    from public.get_rate_limit_config(p_organization_id, p_scope_type);

  return query
    select * from public.rate_limit_attempt(
      p_scope_type,
      p_scope_id,
      v_config.window_seconds,
      v_config.max_attempts,
      v_config.lockout_seconds,
      p_bucket_seconds
    );
end;
$$;

comment on function public.rate_limit_attempt_for_org(uuid, text, uuid, int) is
  'Wrapper: looks up rate-limit thresholds from the org''s plan, then calls rate_limit_attempt.';
