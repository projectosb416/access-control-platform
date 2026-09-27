-- ============================================================================
-- Migration 0048: use ON CONSTRAINT in redeem_unit_invite
-- ============================================================================
-- Bug in migration 0047:
--   `insert into organization_memberships ... on conflict (organization_id,
--   account_id, role) do nothing` — plpgsql parses the parenthesized list
--   after ON CONFLICT as column references, and both unit_id and
--   organization_id exist as OUT parameters from the function's RETURNS
--   TABLE clause. Ambiguous → raise at call time.
--
--   Same underlying plpgsql mechanism as migrations 0032, 0040, and 0047.
--   The previous fix qualified WHERE clause references but missed the
--   ON CONFLICT target — the third occurrence of this class in the same
--   function.
--
-- Fix:
--   Use `on conflict on constraint organization_memberships_unique_account_role
--   do nothing`. Names the constraint directly, no column-list parsing, no
--   ambiguity possible. The constraint is defined in migration 0046.
--
-- No other changes to the function.
-- ============================================================================

create or replace function public.redeem_unit_invite(p_code_hash text)
returns table (
  unit_id         uuid,
  organization_id uuid
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_account_id    uuid;
  v_occupancy     record;
  v_org_id        uuid;
  v_unit_id       uuid;
  v_person_id     uuid;
  v_membership_id uuid;
begin
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select o.id, o.unit_id, o.invite_expires_at
    into v_occupancy
    from public.occupancies o
   where o.invite_code_hash = p_code_hash
     and o.status = 'invited'
     and o.invite_expires_at > now()
   for update of o;

  if not found then
    raise exception 'INVITE_INVALID_OR_EXPIRED';
  end if;

  v_unit_id := v_occupancy.unit_id;

  select p.organization_id into v_org_id
    from public.units u
    join public.properties p on p.id = u.property_id
   where u.id = v_unit_id;

  if v_org_id is null then
    raise exception 'INVITE_INVALID_OR_EXPIRED';
  end if;

  if exists (
    select 1 from public.occupancies o
     where o.unit_id = v_unit_id
       and o.status = 'active'
  ) then
    raise exception 'UNIT_ALREADY_OCCUPIED';
  end if;

  if exists (
    select 1
      from public.occupancies o
      join public.units u on u.id = o.unit_id
      join public.properties p on p.id = u.property_id
     where o.account_id = v_account_id
       and o.status = 'active'
       and p.organization_id = v_org_id
  ) then
    raise exception 'ALREADY_PRIMARY_RESIDENT';
  end if;

  update public.occupancies o
     set account_id         = v_account_id,
         status             = 'active',
         started_at         = now(),
         invite_code_hash   = null,
         invite_expires_at  = null
   where o.id = v_occupancy.id;

  select p.id into v_person_id
    from public.people p
   where p.account_id = v_account_id
     and p.organization_id = v_org_id
   limit 1;

  if v_person_id is null then
    insert into public.people (
      organization_id, account_id, full_name, status
    )
    select v_org_id, v_account_id, coalesce(a.display_name, 'Resident'), 'active'
      from public.accounts a
     where a.id = v_account_id
    returning id into v_person_id;
  end if;

  -- Fix: use ON CONSTRAINT — no column-list parsing, no ambiguity.
  insert into public.organization_memberships (
    organization_id, account_id, role, status, joined_at
  ) values (
    v_org_id, v_account_id, 'primary_resident', 'active', now()
  )
  on conflict on constraint organization_memberships_unique_account_role
    do nothing
  returning id into v_membership_id;

  perform public.log_audit_event(
    v_org_id,
    v_account_id,
    'unit_invite.redeemed',
    'occupancy',
    v_occupancy.id,
    null,
    jsonb_build_object(
      'unit_id', v_unit_id,
      'person_id', v_person_id
    )
  );

  return query select v_unit_id, v_org_id;
end;
$$;

comment on function public.redeem_unit_invite(text) is
  'Atomically redeems a unit invite: activates occupancy, creates person + primary_resident membership, clears invite hash.';
