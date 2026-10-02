-- ============================================================================
-- Migration 0060: household-member read permissions (issue #19)
-- ============================================================================
-- Purpose:
--   Extend three read RPCs to permit household members to read the data
--   they reasonably co-own:
--
--     list_guest_pins_for_unit — the caller's own PINs on the unit
--     list_unit_visits         — visits to the unit the caller lives in
--     list_household_members   — the roster they belong to
--
--   Before this migration, all three check only for an active occupancy
--   row. Household members have no occupancy (their membership lives in
--   household_members), so all three raise NOT_AUTHORIZED. The client
--   catches non-fatally — dashboard renders empty.
--
-- Blueprint AI review (#19):
--   Confirmed as a real UX gap, low severity, no security exposure.
--   Scope per review: extend all three RPCs to accept household members.
--   For list_guest_pins_for_unit specifically, the review said to filter
--   to created_by = current_account_id() for household members.
--
--   Verification: 0051 ALREADY applies that filter to every caller —
--   line 122 of 20260928000051 uses `and a.created_by = v_account_id`.
--   No filter change needed. Household members calling this function
--   will see only PINs they created, exactly as intended.
--
-- What does NOT change:
--   - The write functions in 0057 (generate_household_invite,
--     cancel_household_invite, end_household_member) keep their
--     primary-resident-only / org-admin predicates. Household members
--     cannot generate or cancel invites, nor remove other members.
--   - The NOT_AUTHENTICATED and UNIT_NOT_FOUND guards stay in place.
--   - Column projection and ORDER BY in all three functions unchanged.
--
-- Predicate shape (all three functions):
--   not (
--     exists (active occupancy for caller on unit)
--     or exists (active household_membership for caller on unit)
--   ) → raise NOT_AUTHORIZED
--
--   Reads cleaner than the equivalent NOT/AND/NOT form and matches how
--   compound predicates are phrased elsewhere in the codebase.
--
-- Ambiguity discipline (§11):
--   Every column reference inside these bodies is qualified with a
--   table alias. The signatures are unchanged, but the project's history
--   (0032, 0040, 0047, 0048) shows call-time validation is where
--   plpgsql errors surface — not create time.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. list_guest_pins_for_unit — widen access predicate
-- ----------------------------------------------------------------------------

create or replace function public.list_guest_pins_for_unit(p_unit_id uuid)
returns table (
  authorization_id    uuid,
  credential_id       uuid,
  visitor_full_name   text,
  visitor_phone       text,
  purpose             text,
  note                text,
  access_type         text,
  authorization_type  text,
  status              text,
  valid_from          timestamptz,
  valid_until         timestamptz,
  created_at          timestamptz,
  updated_at          timestamptz,
  entry_count         int,
  is_active           boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_org_id     uuid;
begin
  -- 1. Authenticated.
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- 2. Unit exists; capture its org for the access check.
  select p.organization_id into v_org_id
    from public.units u
    join public.properties p on p.id = u.property_id
   where u.id = p_unit_id;

  if not found then
    raise exception 'UNIT_NOT_FOUND';
  end if;

  -- 3. Caller is an active primary resident of this unit OR an active
  --    household member of it.
  if not (
    exists (
      select 1
        from public.occupancies o
       where o.unit_id    = p_unit_id
         and o.account_id = v_account_id
         and o.status     = 'active'
    )
    or exists (
      select 1
        from public.household_members hm
       where hm.unit_id    = p_unit_id
         and hm.account_id = v_account_id
         and hm.status     = 'active'
    )
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- 4. Return the list. Filter to the caller's own creations (unchanged
  --    from 0051) — household members see only PINs they created.
  --    Column references qualified where they collide with OUT
  --    parameter names — §11: plpgsql OUT-param ambiguity (0032, 0040).
  return query
    select
      a.id                 as authorization_id,
      c.id                 as credential_id,
      pe.full_name         as visitor_full_name,
      pe.phone             as visitor_phone,
      a.purpose            as purpose,
      a.note               as note,
      a.access_type        as access_type,
      a.authorization_type as authorization_type,
      a.status             as status,
      a.valid_from         as valid_from,
      a.valid_until        as valid_until,
      a.created_at         as created_at,
      a.updated_at         as updated_at,
      coalesce((
        select count(*)::int
          from public.access_events ae
         where ae.authorization_id = a.id
           and ae.direction       = 'entry'
           and ae.result_code     = 'GRANTED'
      ), 0)                as entry_count,
      (a.status in ('active','in_progress') and a.valid_until > now())
                           as is_active
    from public.authorizations a
    left join public.people pe
           on pe.id = a.person_id
    left join public.access_credentials c
           on c.authorization_id = a.id
    where a.scope_unit_id = p_unit_id
      and a.created_by    = v_account_id
      and (
        (a.status in ('active','in_progress') and a.valid_until > now())
        or
        (
          a.status in ('completed','expired','revoked','cancelled')
          and greatest(a.updated_at, a.valid_until) > now() - interval '7 days'
        )
        or
        (
          a.status in ('active','in_progress')
          and a.valid_until <= now()
          and a.valid_until >  now() - interval '7 days'
        )
      )
    order by a.created_at desc;
end;
$$;


-- ----------------------------------------------------------------------------
-- 2. list_unit_visits — widen access predicate
-- ----------------------------------------------------------------------------

create or replace function public.list_unit_visits(p_unit_id uuid)
returns table (
  session_id    uuid,
  visitor_name  text,
  entered_at    timestamptz,
  exited_at     timestamptz,
  status        text,
  resolved_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_org_id     uuid;
begin
  -- 1. Authenticated.
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- 2. Unit exists; capture its org.
  select p.organization_id into v_org_id
    from public.units u
    join public.properties p on p.id = u.property_id
   where u.id = p_unit_id;

  if not found then
    raise exception 'UNIT_NOT_FOUND';
  end if;

  -- 3. Caller is an active primary resident OR an active household
  --    member of this unit.
  if not (
    exists (
      select 1
        from public.occupancies o
       where o.unit_id    = p_unit_id
         and o.account_id = v_account_id
         and o.status     = 'active'
    )
    or exists (
      select 1
        from public.household_members hm
       where hm.unit_id    = p_unit_id
         and hm.account_id = v_account_id
         and hm.status     = 'active'
    )
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- 4. Return the most recent 20 sessions for this unit. The list is
  --    unit-scoped (all visits), not caller-scoped — household members
  --    co-occupy the unit and share visibility.
  return query
    select
      s.id          as session_id,
      per.full_name as visitor_name,
      s.entered_at  as entered_at,
      s.exited_at   as exited_at,
      s.status      as status,
      s.resolved_at as resolved_at
    from public.access_sessions s
    join public.authorizations a on a.id = s.authorization_id
    join public.people per       on per.id = s.person_id
    where a.scope_unit_id  = p_unit_id
      and s.organization_id = v_org_id
    order by s.entered_at desc
    limit 20;
end;
$$;


-- ----------------------------------------------------------------------------
-- 3. list_household_members — widen access predicate
-- ----------------------------------------------------------------------------

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
  -- 1. Authenticated.
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- 2. Unit exists; capture its org.
  select p.organization_id into v_org_id
    from public.units u
    join public.properties p on p.id = u.property_id
   where u.id = p_unit_id;

  if v_org_id is null then
    raise exception 'UNIT_NOT_FOUND';
  end if;

  -- 3. Caller is org admin, OR active primary resident, OR active
  --    household member of this unit.
  v_is_admin := public.is_org_admin(v_org_id);

  if not v_is_admin
     and not exists (
       select 1
         from public.occupancies o
        where o.unit_id    = p_unit_id
          and o.account_id = v_account_id
          and o.status     = 'active'
     )
     and not exists (
       select 1
         from public.household_members hm
        where hm.unit_id    = p_unit_id
          and hm.account_id = v_account_id
          and hm.status     = 'active'
     ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- 4. Return the roster.
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
