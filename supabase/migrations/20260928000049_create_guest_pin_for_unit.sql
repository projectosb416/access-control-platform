-- ============================================================================
-- Migration 0049: create_guest_pin_for_unit
-- ============================================================================
-- Purpose:
--   Resident-facing wrapper for creating a guest PIN on a specific unit.
--
--   Primary resident only. Admin-side PIN creation is deliberately out of
--   scope (the admin can already generate org-wide authorizations through
--   other paths; this surface is resident-specific).
--
--   The wrapper:
--     1. Verifies caller is the active primary resident of the given unit
--     2. Finds or creates the visitor person
--     3. Calls create_authorization_with_credential with scope_unit_id set
--
--   Everything inside one SECURITY DEFINER transaction. If the inner call
--   fails, the person row creation rolls back with it — no orphans.
--
-- Visitor person reuse heuristic:
--   If p_visitor_phone is provided, we match on (org, lower(name), phone)
--   and reuse an existing person if found. If phone is null, we always
--   create a new person — matching on name alone risks merging two real
--   different people, which is worse than a duplicate row.
--
-- Errors:
--   NOT_AUTHENTICATED
--   NOT_AUTHORIZED
--   SUBSCRIPTION_INACTIVE
--   UNIT_NOT_FOUND
--   UNIT_ARCHIVED
--   FULL_NAME_REQUIRED
--   PURPOSE_REQUIRED
--   INVALID_ACCESS_TYPE
--   INVALID_AUTHORIZATION_TYPE
--   INVALID_VALIDITY_WINDOW
-- ============================================================================

create or replace function public.create_guest_pin_for_unit(
  p_unit_id            uuid,
  p_visitor_full_name  text,
  p_visitor_phone      text,
  p_purpose            text,
  p_authorization_type text,
  p_valid_from         timestamptz,
  p_valid_until        timestamptz,
  p_credential         text,
  p_lookup_key         text,
  p_access_type        text default 'visitor',
  p_note               text default null,
  p_pepper_version     text default 'v1'
)
returns table (
  authorization_id uuid,
  credential_id    uuid,
  person_id        uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id   uuid;
  v_org_id       uuid;
  v_unit         record;
  v_caller_person uuid;
  v_visitor_id   uuid;
  v_auth_id      uuid;
  v_cred_id      uuid;
  v_result       record;
  v_name         text;
  v_phone        text;
begin
  -- 1. Authenticated.
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- 2. Resolve org from unit + check unit state.
  select u.id, u.status, p.organization_id
    into v_unit
    from public.units u
    join public.properties p on p.id = u.property_id
   where u.id = p_unit_id;

  if not found then
    raise exception 'UNIT_NOT_FOUND';
  end if;

  if v_unit.status <> 'active' then
    raise exception 'UNIT_ARCHIVED';
  end if;

  v_org_id := v_unit.organization_id;

  -- 3. Org operational.
  if not public.is_org_operational(v_org_id) then
    raise exception 'SUBSCRIPTION_INACTIVE';
  end if;

  -- 4. Caller is the active primary resident of this unit.
  if not exists (
    select 1
      from public.occupancies o
     where o.unit_id = p_unit_id
       and o.account_id = v_account_id
       and o.status = 'active'
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- 5. Input validation.
  v_name  := nullif(btrim(coalesce(p_visitor_full_name, '')), '');
  v_phone := nullif(btrim(coalesce(p_visitor_phone, '')), '');

  if v_name is null then
    raise exception 'FULL_NAME_REQUIRED';
  end if;

  if p_purpose is null or length(btrim(p_purpose)) = 0 then
    raise exception 'PURPOSE_REQUIRED';
  end if;

  if p_access_type is null or p_access_type not in (
    'visitor','vendor','contractor','client','employee','family_member','other'
  ) then
    raise exception 'INVALID_ACCESS_TYPE';
  end if;

  if p_authorization_type is null or p_authorization_type not in (
    'one_time','reusable'
  ) then
    raise exception 'INVALID_AUTHORIZATION_TYPE';
  end if;

  if p_valid_from is null or p_valid_until is null
     or p_valid_until <= p_valid_from then
    raise exception 'INVALID_VALIDITY_WINDOW';
  end if;

  -- 6. Find or create the visitor person.
  if v_phone is not null then
    select id into v_visitor_id
      from public.people
     where organization_id = v_org_id
       and lower(full_name) = lower(v_name)
       and phone = v_phone
     limit 1;
  end if;

  if v_visitor_id is null then
    insert into public.people (
      organization_id, full_name, phone, status, created_by
    ) values (
      v_org_id, v_name, v_phone, 'active', v_account_id
    )
    returning id into v_visitor_id;
  end if;

  -- 7. Caller's person row — used as host_person_id on the authorization.
  select id into v_caller_person
    from public.people
   where organization_id = v_org_id
     and account_id = v_account_id
   limit 1;

  -- Should always exist if caller is primary resident, but defensive:
  if v_caller_person is null then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- 8. Delegate to the existing atomic authorization creator. Audit is
  --    written inside that function — do not duplicate here.
  select * into v_result
    from public.create_authorization_with_credential(
      p_organization_id    := v_org_id,
      p_person_id          := v_visitor_id,
      p_scope_unit_id      := p_unit_id,
      p_appointment_id     := null,
      p_access_type        := p_access_type,
      p_purpose            := p_purpose,
      p_note               := p_note,
      p_host_person_id     := v_caller_person,
      p_authorization_type := p_authorization_type,
      p_valid_from         := p_valid_from,
      p_valid_until        := p_valid_until,
      p_credential         := p_credential,
      p_lookup_key         := p_lookup_key,
      p_pepper_version     := p_pepper_version
    );

  return query select v_result.authorization_id, v_result.credential_id, v_visitor_id;
end;
$$;

comment on function public.create_guest_pin_for_unit(
  uuid, text, text, text, text, timestamptz, timestamptz, text, text, text, text, text
) is
  'Primary-resident-only wrapper for creating a guest PIN scoped to their unit. Reuses visitor person when phone matches. Delegates audit to create_authorization_with_credential.';
