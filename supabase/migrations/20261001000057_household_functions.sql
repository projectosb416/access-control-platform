-- ============================================================================
-- Migration 0057: household invite + member lifecycle functions
-- ============================================================================
-- Purpose:
--   Four SECURITY DEFINER functions covering the household-members
--   lifecycle for the Primary Resident of a unit:
--
--     generate_household_invite   — create a single-use invite code
--     cancel_household_invite     — retract an unused invite
--     end_household_member        — remove an active member
--     list_household_members      — read the unit's household roster
--
--   Companion change: drop two RLS policies on household_members that
--   are row-scoped, not column-scoped — same structural shape as
--   authorizations_update_primary_resident (dropped in 0053),
--   authorizations_insert_primary_resident (dropped in 0055), and the
--   notifications_update_self_read policy flagged as #18.
--
--   Concretely, the current policies permit a Primary Resident to:
--     - INSERT with status='active' directly, bypassing the entire
--       invite flow (creating a live household member without consent)
--     - UPDATE account_id on a live row — hijacking a member's seat
--     - UPDATE invite_code_hash — taking over a live pending invite
--     - UPDATE invited_by — attribution spoof
--     - UPDATE status from 'ended' back to 'active' — reactivating a
--       member the system already terminated
--
--   After this migration, there is no client-reachable write path to
--   household_members that is not a SECURITY DEFINER function.
--
-- Design constraints honored:
--   - Never touches is_primary_resident or occupancy status. None of
--     the four functions write to organization_memberships or
--     occupancies. The existing occupancy-end cascade trigger fires
--     BECAUSE OF occupancy changes; it does not cause them.
--   - Same eligibility checks as generate_unit_invite: authenticated,
--     active primary resident (or org admin for cancel/end), subscription
--     operational, unit active.
--   - Cross-table invite-code collision check: hashes are tested against
--     both household_members and occupancies before acceptance.
--     (generate_unit_invite does NOT yet do this — retrofitting it is a
--     separate follow-up.)
--   - Invite codes are 8 chars over the 31-char alphabet, SHA-256 hashed
--     before storage. Plaintext returned to caller once, never persisted.
--     Same pattern as guard session tokens (0029) and unit invites (0045).
--
-- Errors raised by these functions (docs/phase-7/error-http-mapping.md):
--   NOT_AUTHENTICATED, NOT_AUTHORIZED, SUBSCRIPTION_INACTIVE,
--   UNIT_NOT_FOUND, UNIT_NOT_ACTIVE, INVALID_DURATION,
--   CODE_GENERATION_FAILED, INVITE_NOT_FOUND,
--   HOUSEHOLD_MEMBER_NOT_FOUND, HOUSEHOLD_MEMBER_NOT_ACTIVE
--
-- Note on ambiguity (§11): every column reference inside these bodies
-- is qualified with a table alias. This is the discipline established
-- across migrations 0032, 0040, 0047, 0048 — plpgsql validates bodies
-- at call time, and bare column references that collide with OUT
-- parameter names raise at runtime.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. generate_household_invite
-- ----------------------------------------------------------------------------

create or replace function public.generate_household_invite(
  p_unit_id          uuid,
  p_duration_minutes int default 1440
)
returns table (
  household_member_id uuid,
  code                text,
  expires_at          timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_account_id  uuid;
  v_org_id      uuid;
  v_unit        record;
  v_alphabet    text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_code        text := null;
  v_hash        text;
  v_hm_id       uuid;
  v_expires_at  timestamptz;
  v_attempt     int;
  v_candidate   text;
  v_i           int;
  v_hit         boolean;
begin
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Resolve unit + org.
  select u.id, u.status, p.organization_id
    into v_unit
    from public.units u
    join public.properties p on p.id = u.property_id
   where u.id = p_unit_id;

  if not found then
    raise exception 'UNIT_NOT_FOUND';
  end if;

  if v_unit.status <> 'active' then
    raise exception 'UNIT_NOT_ACTIVE';
  end if;

  v_org_id := v_unit.organization_id;

  if not public.is_org_operational(v_org_id) then
    raise exception 'SUBSCRIPTION_INACTIVE';
  end if;

  -- Caller must be the active primary resident of this unit.
  if not exists (
    select 1
      from public.occupancies o
     where o.unit_id    = p_unit_id
       and o.account_id = v_account_id
       and o.status     = 'active'
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- Duration bounds.
  if p_duration_minutes is null
     or p_duration_minutes <= 0
     or p_duration_minutes > 1440 then
    raise exception 'INVALID_DURATION';
  end if;

  -- Supersede any existing invited row for this unit. Partial unique
  -- index household_members_one_pending_per_unit requires this to happen
  -- before the new row is inserted.
  update public.household_members hm
     set status             = 'ended',
         ended_at           = now(),
         ended_by           = v_account_id,
         end_reason         = 'superseded by new invite',
         invite_code_hash   = null,
         invite_expires_at  = null
   where hm.unit_id = p_unit_id
     and hm.status  = 'invited';

  -- Generate a unique 8-char code, cross-checked against BOTH tables.
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
      select 1 from public.household_members hm2
       where hm2.invite_code_hash = v_hash
      union all
      select 1 from public.occupancies o2
       where o2.invite_code_hash = v_hash
    ) into v_hit;

    if not v_hit then
      v_code := v_candidate;
      exit;
    end if;
  end loop;

  if v_code is null then
    raise exception 'CODE_GENERATION_FAILED';
  end if;

  v_hm_id      := public.uuidv7();
  v_expires_at := now() + make_interval(mins => p_duration_minutes);

  insert into public.household_members (
    id, unit_id, account_id, person_id, invited_by, status,
    invite_code_hash, invite_expires_at, invited_at
  ) values (
    v_hm_id, p_unit_id, null, null, v_account_id, 'invited',
    v_hash, v_expires_at, now()
  );

  perform public.log_audit_event(
    v_org_id,
    v_account_id,
    'household_invite.generated',
    'household_member',
    v_hm_id,
    null,
    jsonb_build_object(
      'unit_id',    p_unit_id,
      'expires_at', v_expires_at
    )
  );

  return query select v_hm_id, v_code, v_expires_at;
end;
$$;

comment on function public.generate_household_invite(uuid, int) is
  'Primary-resident-only. Generates a single-use household invite for the unit. Returns plaintext code once; only the SHA-256 hash is stored. Supersedes any prior invited row. Cross-checks hash against both household_members and occupancies.';


-- ----------------------------------------------------------------------------
-- 2. cancel_household_invite
-- ----------------------------------------------------------------------------

create or replace function public.cancel_household_invite(
  p_unit_id uuid,
  p_reason  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_org_id     uuid;
  v_hm_id      uuid;
  v_updated    int;
begin
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select p.organization_id into v_org_id
    from public.units u
    join public.properties p on p.id = u.property_id
   where u.id = p_unit_id;

  if v_org_id is null then
    raise exception 'UNIT_NOT_FOUND';
  end if;

  if not public.is_org_operational(v_org_id) then
    raise exception 'SUBSCRIPTION_INACTIVE';
  end if;

  -- Caller must be the active primary resident OR org admin.
  if not public.is_org_admin(v_org_id)
     and not exists (
       select 1
         from public.occupancies o
        where o.unit_id    = p_unit_id
          and o.account_id = v_account_id
          and o.status     = 'active'
     ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  update public.household_members hm
     set status            = 'ended',
         ended_at          = now(),
         ended_by          = v_account_id,
         end_reason        = coalesce(p_reason, 'cancelled'),
         invite_code_hash  = null,
         invite_expires_at = null
   where hm.unit_id = p_unit_id
     and hm.status  = 'invited'
   returning hm.id into v_hm_id;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    raise exception 'INVITE_NOT_FOUND';
  end if;

  perform public.log_audit_event(
    v_org_id,
    v_account_id,
    'household_invite.cancelled',
    'household_member',
    v_hm_id,
    p_reason,
    jsonb_build_object('unit_id', p_unit_id)
  );
end;
$$;

comment on function public.cancel_household_invite(uuid, text) is
  'Cancels a live household invite. Idempotent-in-shape: raises INVITE_NOT_FOUND if no invited row exists. Primary resident or org admin.';


-- ----------------------------------------------------------------------------
-- 3. end_household_member
-- ----------------------------------------------------------------------------

create or replace function public.end_household_member(
  p_household_member_id uuid,
  p_reason              text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_hm         record;
  v_org_id     uuid;
begin
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select hm.id, hm.unit_id, hm.status, hm.account_id
    into v_hm
    from public.household_members hm
   where hm.id = p_household_member_id
   for update;

  if not found then
    raise exception 'HOUSEHOLD_MEMBER_NOT_FOUND';
  end if;

  -- Idempotent: already ended.
  if v_hm.status = 'ended' then
    return;
  end if;

  -- Only active members can be ended. Invited rows use
  -- cancel_household_invite.
  if v_hm.status <> 'active' then
    raise exception 'HOUSEHOLD_MEMBER_NOT_ACTIVE';
  end if;

  select p.organization_id into v_org_id
    from public.units u
    join public.properties p on p.id = u.property_id
   where u.id = v_hm.unit_id;

  if not public.is_org_operational(v_org_id) then
    raise exception 'SUBSCRIPTION_INACTIVE';
  end if;

  -- Caller must be the active primary resident OR org admin.
  if not public.is_org_admin(v_org_id)
     and not exists (
       select 1
         from public.occupancies o
        where o.unit_id    = v_hm.unit_id
          and o.account_id = v_account_id
          and o.status     = 'active'
     ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  update public.household_members hm2
     set status     = 'ended',
         ended_at   = now(),
         ended_by   = v_account_id,
         end_reason = coalesce(p_reason, 'removed by primary resident')
   where hm2.id = p_household_member_id;

  -- Cascade trigger (revoke_authorizations_on_household_end, migration
  -- 0032) fires on the transition old.status='active' -> new.status='ended'
  -- with old.account_id NOT NULL. That revokes the member's active
  -- authorizations for this unit. No further action here.

  perform public.log_audit_event(
    v_org_id,
    v_account_id,
    'household_member.ended',
    'household_member',
    p_household_member_id,
    p_reason,
    jsonb_build_object('unit_id', v_hm.unit_id)
  );
end;
$$;

comment on function public.end_household_member(uuid, text) is
  'Ends an active household member. Idempotent on already-ended. Cascade trigger revokes their active unit authorizations. Primary resident or org admin.';


-- ----------------------------------------------------------------------------
-- 4. list_household_members
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER because the read path joins people to fetch the
-- member's full_name, and people_select_admin_or_self blocks the
-- primary resident from seeing other accounts' person rows.

create or replace function public.list_household_members(p_unit_id uuid)
returns table (
  household_member_id uuid,
  full_name           text,
  status              text,
  invited_at          timestamptz,
  joined_at           timestamptz,
  ended_at            timestamptz,
  end_reason          text,
  invite_expires_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_org_id     uuid;
  v_is_admin   boolean := false;
begin
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select p.organization_id into v_org_id
    from public.units u
    join public.properties p on p.id = u.property_id
   where u.id = p_unit_id;

  if v_org_id is null then
    raise exception 'UNIT_NOT_FOUND';
  end if;

  -- Allow either the active primary resident of the unit OR org admin.
  v_is_admin := public.is_org_admin(v_org_id);

  if not v_is_admin
     and not exists (
       select 1
         from public.occupancies o
        where o.unit_id    = p_unit_id
          and o.account_id = v_account_id
          and o.status     = 'active'
     ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  return query
    select
      hm.id                   as household_member_id,
      pe.full_name            as full_name,
      hm.status               as status,
      hm.invited_at           as invited_at,
      hm.joined_at            as joined_at,
      hm.ended_at             as ended_at,
      hm.end_reason           as end_reason,
      hm.invite_expires_at    as invite_expires_at
    from public.household_members hm
    left join public.people pe on pe.id = hm.person_id
    where hm.unit_id = p_unit_id
    order by hm.created_at desc;
end;
$$;

comment on function public.list_household_members(uuid) is
  'Primary-resident or admin. Lists household members for the unit with resolved person names. SECURITY DEFINER because people RLS blocks the join path otherwise.';


-- ----------------------------------------------------------------------------
-- 5. Drop the two row-scoped write policies on household_members
-- ----------------------------------------------------------------------------
-- After this, all writes go through the four functions above. SELECT
-- policy is unchanged.

drop policy if exists household_members_insert_primary_resident
  on public.household_members;

drop policy if exists household_members_update_primary_resident
  on public.household_members;
