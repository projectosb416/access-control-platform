-- ============================================================================
-- Migration 0045: generate_unit_invite + cancel_unit_invite
-- ============================================================================
-- Purpose:
--   Two SECURITY DEFINER functions that manage the unit invite lifecycle.
--
--   generate_unit_invite: produces a single-use code, supersedes any prior
--     invited row for the same unit, returns the plaintext code once.
--   cancel_unit_invite:   marks a live invite cancelled, unit returns to
--     vacant. No new invite is generated.
--
-- Design:
--   - 8-char code (31^8 ≈ 852 billion). No prefix. Global uniqueness because
--     the redemption URL does not know the org.
--   - Code is stored ONLY as a SHA-256 hash (invite_code_hash). Plaintext is
--     returned to the caller and never persisted.
--   - Default window: 24 hours. Cap: 24 hours (1440 minutes). Rationale:
--     invites are meant to be shared and redeemed immediately; a longer
--     window is a forgotten invite, not a benefit.
--   - Superseding an existing invited row sets status='cancelled' first, so
--     the occupancies_one_invite_per_unit partial unique index stays
--     satisfied during the transaction.
--   - Audit event written inside each function (same transaction as state
--     change). Matches the pattern from migration 0024.
--
-- Errors:
--   NOT_AUTHENTICATED / NOT_AUTHORIZED / SUBSCRIPTION_INACTIVE
--   UNIT_NOT_FOUND / UNIT_ARCHIVED / UNIT_ALREADY_OCCUPIED
--   INVALID_DURATION / CODE_GENERATION_FAILED
--   INVITE_NOT_FOUND (cancel only)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. generate_unit_invite
-- ----------------------------------------------------------------------------

create or replace function public.generate_unit_invite(
  p_organization_id  uuid,
  p_unit_id          uuid,
  p_duration_minutes int default 1440
)
returns table (
  occupancy_id uuid,
  code         text,
  expires_at   timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_account_id   uuid;
  v_unit         record;
  v_alphabet     text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code         text := null;
  v_hash         text;
  v_occupancy_id uuid;
  v_expires_at   timestamptz;
  v_attempt      int;
  v_candidate    text;
  v_i            int;
  v_hit          boolean;
begin
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not public.is_org_admin(p_organization_id) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if not public.is_org_operational(p_organization_id) then
    raise exception 'SUBSCRIPTION_INACTIVE';
  end if;

  if p_duration_minutes is null
     or p_duration_minutes <= 0
     or p_duration_minutes > 1440 then
    raise exception 'INVALID_DURATION';
  end if;

  -- Unit must exist in this org and be active.
  select u.id, u.status, p.organization_id
    into v_unit
    from public.units u
    join public.properties p on p.id = u.property_id
   where u.id = p_unit_id
     and p.organization_id = p_organization_id;

  if not found then
    raise exception 'UNIT_NOT_FOUND';
  end if;

  if v_unit.status <> 'active' then
    raise exception 'UNIT_ARCHIVED';
  end if;

  -- No active occupancy allowed.
  if exists (
    select 1 from public.occupancies
     where unit_id = p_unit_id
       and status = 'active'
  ) then
    raise exception 'UNIT_ALREADY_OCCUPIED';
  end if;

  -- Supersede any existing invited row for this unit. Audit each supersession.
  update public.occupancies
     set status      = 'cancelled',
         ended_at    = now(),
         ended_by    = v_account_id,
         end_reason  = 'superseded by new invite'
   where unit_id = p_unit_id
     and status  = 'invited';

  -- Generate a unique code. Retry up to 50 times on hash collision.
  for v_attempt in 1..50 loop
    v_candidate := '';
    for v_i in 1..8 loop
      v_candidate := v_candidate || substr(
        v_alphabet,
        1 + floor(random() * length(v_alphabet))::int,
        1
      );
    end loop;

    v_hash := encode(extensions.digest(v_candidate, 'sha256'), 'hex');

    select exists (
      select 1 from public.occupancies
       where invite_code_hash = v_hash
    ) into v_hit;

    if not v_hit then
      v_code := v_candidate;
      exit;
    end if;
  end loop;

  if v_code is null then
    raise exception 'CODE_GENERATION_FAILED';
  end if;

  v_occupancy_id := public.uuidv7();
  v_expires_at   := now() + make_interval(mins => p_duration_minutes);

  insert into public.occupancies (
    id, unit_id, account_id, status,
    invite_code_hash, invite_expires_at, invited_at,
    created_by
  ) values (
    v_occupancy_id, p_unit_id, null, 'invited',
    v_hash, v_expires_at, now(),
    v_account_id
  );

  -- Audit — inside same transaction.
  perform public.log_audit_event(
    p_organization_id,
    v_account_id,
    'unit_invite.generated',
    'occupancy',
    v_occupancy_id,
    null,
    jsonb_build_object(
      'unit_id', p_unit_id,
      'expires_at', v_expires_at
    )
  );

  return query select v_occupancy_id, v_code, v_expires_at;
end;
$$;

comment on function public.generate_unit_invite(uuid, uuid, int) is
  'Generates a single-use unit invite. Returns plaintext code once; only the SHA-256 hash is stored. Supersedes prior invited rows for the same unit. Default/cap window: 24h.';


-- ----------------------------------------------------------------------------
-- 2. cancel_unit_invite
-- ----------------------------------------------------------------------------

create or replace function public.cancel_unit_invite(
  p_organization_id uuid,
  p_unit_id         uuid,
  p_reason          text default 'cancelled by admin'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id   uuid;
  v_occupancy_id uuid;
  v_updated      int;
begin
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not public.is_org_admin(p_organization_id) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if not public.is_org_operational(p_organization_id) then
    raise exception 'SUBSCRIPTION_INACTIVE';
  end if;

  -- Cancel the live invited row for this unit, scoped to the org.
  update public.occupancies o
     set status     = 'cancelled',
         ended_at   = now(),
         ended_by   = v_account_id,
         end_reason = p_reason
   where o.unit_id = p_unit_id
     and o.status  = 'invited'
     and exists (
       select 1
         from public.units u
         join public.properties p on p.id = u.property_id
        where u.id = o.unit_id
          and p.organization_id = p_organization_id
     )
   returning o.id into v_occupancy_id;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'INVITE_NOT_FOUND';
  end if;

  -- Audit — inside same transaction.
  perform public.log_audit_event(
    p_organization_id,
    v_account_id,
    'unit_invite.cancelled',
    'occupancy',
    v_occupancy_id,
    p_reason,
    jsonb_build_object('unit_id', p_unit_id)
  );
end;
$$;

comment on function public.cancel_unit_invite(uuid, uuid, text) is
  'Cancels the live unit invite for the given unit. Unit returns to vacant. No new invite generated.';
