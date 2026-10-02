-- ============================================================================
-- Migration 0061: cross-table collision check in generate_unit_invite (#20)
-- ============================================================================
-- Bug (from migration 0045):
--   generate_unit_invite generates an 8-char invite code and checks for
--   collision against occupancies.invite_code_hash only. It does not
--   check household_members.invite_code_hash.
--
--   Migration 0057's generate_household_invite checks BOTH tables. The
--   two generators are structurally asymmetric: one collides against a
--   single table, the other against two.
--
--   Probability of an actual collision is negligible (31^8 ≈ 852
--   billion). This is a structural correctness fix, not a live bug —
--   but the asymmetry would prompt "why do these two functions differ?"
--   at every future review.
--
-- Fix:
--   Widen the collision check to a union across both tables. Same body
--   as 0045 otherwise. Signature unchanged.
--
-- No other changes. The code-generation loop, error handling, supersede
-- logic, subscription check, and audit call are identical to 0045.
--
-- Ambiguity discipline (§11):
--   Column references inside the widened exists are qualified with
--   table aliases (hm2, o2). The original 0045 used unqualified
--   references in this block; none of them collided with the function's
--   OUT parameter names (code, occupancy_id, expires_at), but the
--   convention across 0032/0040/0047/0048 is to qualify consistently.
-- ============================================================================

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
    select 1 from public.occupancies o
     where o.unit_id = p_unit_id
       and o.status  = 'active'
  ) then
    raise exception 'UNIT_ALREADY_OCCUPIED';
  end if;

  -- Supersede any existing invited row for this unit. Audit each supersession.
  update public.occupancies o
     set status      = 'cancelled',
         ended_at    = now(),
         ended_by    = v_account_id,
         end_reason  = 'superseded by new invite'
   where o.unit_id = p_unit_id
     and o.status  = 'invited';

  -- Generate a unique code. Retry up to 50 times on hash collision.
  -- Widened in this migration: check BOTH occupancies and
  -- household_members — mirrors generate_household_invite (0057).
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
      select 1 from public.occupancies o2
       where o2.invite_code_hash = v_hash
      union all
      select 1 from public.household_members hm2
       where hm2.invite_code_hash = v_hash
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
  'Generates a single-use unit invite. Returns plaintext code once; only the SHA-256 hash is stored. Supersedes prior invited rows. Cross-checks hash against BOTH occupancies and household_members (widened in 0061, mirroring 0057).';
