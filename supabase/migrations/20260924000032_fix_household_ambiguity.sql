-- ============================================================================
-- Migration 0032: fix plpgsql variable/column ambiguity in household functions
-- ============================================================================
-- Bug in migration 0031:
--   Three functions declared record variables (v_hm, and NEW/OLD in triggers)
--   whose field names collide with column names in the queries they execute.
--   plpgsql's default variable_conflict=error raised "column reference is
--   ambiguous" at RUNTIME. The migration applied cleanly because plpgsql
--   function bodies are interpreted, not validated at CREATE time. The bug
--   surfaces only when the function is called.
--
--   Affected:
--     - redeem_household_invite                (v_hm.unit_id vs household_members.unit_id)
--     - end_household_members_for_unit         (new/old.status vs household_members.status)
--     - revoke_authorizations_on_household_end (new/old.status vs authorizations.status)
--
-- Fix:
--   Qualify every column reference with an explicit table alias. This is
--   the durable fix — intent is explicit and does not depend on plpgsql
--   directive settings that could change in a future PostgreSQL upgrade.
--
-- No triggers need recreating — trigger objects point at the function name,
-- and replacing the function body is sufficient.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. redeem_household_invite — fix
-- ----------------------------------------------------------------------------

create or replace function public.redeem_household_invite(p_code_hash text)
returns table (
  household_member_id uuid,
  unit_id             uuid,
  organization_id     uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hm        record;
  v_org_id    uuid;
  v_account   uuid;
  v_person_id uuid;
  v_display   text;
begin
  v_account := public.current_account_id();
  if v_account is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select hm.*, p.organization_id as org_id
    into v_hm
    from public.household_members hm
    join public.units u on u.id = hm.unit_id
    join public.properties p on p.id = u.property_id
   where hm.invite_code_hash = p_code_hash
     and hm.status = 'invited'
     and hm.invite_expires_at > now()
   for update of hm;

  if not found then
    raise exception 'INVITE_INVALID_OR_EXPIRED';
  end if;

  v_org_id := v_hm.org_id;

  if not public.is_org_operational(v_org_id) then
    raise exception 'SUBSCRIPTION_INACTIVE';
  end if;

  -- Every column qualified with hm2.
  if exists (
    select 1 from public.household_members hm2
    where hm2.unit_id = v_hm.unit_id
      and hm2.account_id = v_account
      and hm2.status = 'active'
  ) then
    raise exception 'ALREADY_HOUSEHOLD_MEMBER';
  end if;

  -- Every column qualified with p2.
  select p2.id into v_person_id
    from public.people p2
   where p2.account_id = v_account
     and p2.organization_id = v_org_id
   limit 1;

  if v_person_id is null then
    select a.display_name into v_display
      from public.accounts a
     where a.id = v_account;

    insert into public.people (organization_id, account_id, full_name, status)
    values (v_org_id, v_account, coalesce(v_display, 'Household Member'), 'active')
    returning id into v_person_id;
  end if;

  -- Every column qualified with hm3.
  update public.household_members hm3
     set account_id = v_account,
         person_id = v_person_id,
         status = 'active',
         joined_at = now(),
         invite_code_hash = null
   where hm3.id = v_hm.id;

  perform public.log_audit_event(
    v_org_id,
    v_account,
    'household_member.joined',
    'household_member',
    v_hm.id,
    null,
    jsonb_build_object('unit_id', v_hm.unit_id)
  );

  return query select v_hm.id, v_hm.unit_id, v_org_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- 2. end_household_members_for_unit — fix
-- ----------------------------------------------------------------------------

create or replace function public.end_household_members_for_unit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'active' and new.status = 'ended' then
    update public.household_members hm
       set status = 'ended',
           ended_at = now(),
           ended_by = new.ended_by,
           end_reason = 'occupancy ended'
     where hm.unit_id = new.unit_id
       and hm.status = 'active';
  end if;
  return new;
end;
$$;


-- ----------------------------------------------------------------------------
-- 3. revoke_authorizations_on_household_end — fix
-- ----------------------------------------------------------------------------

create or replace function public.revoke_authorizations_on_household_end()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'active' and new.status = 'ended' and old.account_id is not null then
    update public.authorizations a
       set status = 'revoked',
           revoked_at = now(),
           revoked_by = new.ended_by,
           revoke_reason = 'household membership ended'
     where a.created_by = old.account_id
       and a.scope_unit_id = old.unit_id
       and a.status in ('active', 'in_progress');
  end if;
  return new;
end;
$$;
