-- ============================================================================
-- Migration 0031: household_members
-- ============================================================================
-- Purpose:
--   Household members of a unit — co-managers of the unit's access.
--   They generate guest PINs for their own visitors, tracked by
--   attribution. Plan-limited at the application layer via entitlements,
--   not hardcoded in the schema.
--
-- Invite flow:
--   1. Primary Resident generates invite code (Worker generates random,
--      SHA-256 hashes, sends hash here).
--   2. Code sent via WhatsApp / any channel.
--   3. Recipient signs up / signs in (Supabase Auth).
--   4. Recipient redeems code -> account linked, person created if needed,
--      household_members row becomes 'active'.
--
-- Invite code is hashed in the Worker (SHA-256 hex). Only the hash is
-- stored here. Cleared on redemption — single-use. Same pattern as guard
-- session tokens (migration 0029).
--
-- Multiple units per account allowed: one active membership per
-- (unit, account). A student can be household at two addresses.
--
-- Cascade rules:
--   - Occupancy ends -> all active household members of that unit end.
--   - Household member ends -> their active authorizations revoke.
--   Both are enforced by triggers, not application code.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. household_members
-- ----------------------------------------------------------------------------

create table public.household_members (
  id                 uuid primary key default public.uuidv7(),
  unit_id            uuid not null references public.units(id) on delete restrict,

  -- Nullable until the invite is redeemed.
  account_id         uuid references public.accounts(id) on delete restrict,
  person_id          uuid references public.people(id) on delete restrict,

  -- The Primary Resident who issued the invite.
  invited_by         uuid not null references public.accounts(id) on delete restrict,

  status             text not null default 'invited'
                     check (status in ('invited','active','ended')),

  -- Invite code (hashed). Cleared on redemption — single-use.
  invite_code_hash   text,
  invite_expires_at  timestamptz,

  invited_at         timestamptz not null default now(),
  joined_at          timestamptz,
  ended_at           timestamptz,
  ended_by           uuid references public.accounts(id) on delete set null,
  end_reason         text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Invited: no account/person yet, invite hash + expiry required.
  constraint household_members_invited_shape
    check (status <> 'invited' or (
      account_id is null
      and person_id is null
      and invite_code_hash is not null
      and invite_expires_at is not null
    )),

  -- Active: account + person linked, join timestamp set.
  constraint household_members_active_shape
    check (status <> 'active' or (
      account_id is not null
      and person_id is not null
      and joined_at is not null
    )),

  -- Ended: ended_at required.
  constraint household_members_ended_shape
    check (status <> 'ended' or ended_at is not null)
);

comment on table public.household_members is
  'Household members of a unit. Co-manage access; generate their own guest PINs.';

comment on column public.household_members.invite_code_hash is
  'SHA-256 hex of the single-use invite code. Cleared on redemption.';

comment on column public.household_members.invited_by is
  'The Primary Resident who issued the invite.';

create trigger household_members_set_updated_at
  before update on public.household_members
  for each row execute function public.set_updated_at();

create index household_members_unit_id    on public.household_members(unit_id);
create index household_members_account_id on public.household_members(account_id)
  where account_id is not null;

-- At most one pending invite per unit.
create unique index household_members_one_pending_per_unit
  on public.household_members(unit_id)
  where status = 'invited';

-- At most one active household membership per (unit, account).
create unique index household_members_one_active_per_unit_account
  on public.household_members(unit_id, account_id)
  where status = 'active' and account_id is not null;

-- Fast invite redemption lookup. Partial because hash is cleared on use.
create unique index household_members_invite_hash
  on public.household_members(invite_code_hash)
  where invite_code_hash is not null;


-- ----------------------------------------------------------------------------
-- 2. Helper: unit_organization_id
-- ----------------------------------------------------------------------------
-- Needed by RLS policies that check org-scoped rules on a unit.

create or replace function public.unit_organization_id(p_unit_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.organization_id
  from public.units u
  join public.properties p on p.id = u.property_id
  where u.id = p_unit_id;
$$;

comment on function public.unit_organization_id(uuid) is
  'Returns the organization that owns the given unit.';


-- ----------------------------------------------------------------------------
-- 3. Helper: is_household_member_of_unit
-- ----------------------------------------------------------------------------
-- Boolean: does the current account have an active household membership
-- at this unit? Used by RLS policies on authorizations.

create or replace function public.is_household_member_of_unit(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where account_id = public.current_account_id()
      and unit_id = p_unit_id
      and status = 'active'
  );
$$;

comment on function public.is_household_member_of_unit(uuid) is
  'True if the current account is an active household member of the given unit.';


-- ----------------------------------------------------------------------------
-- 4. redeem_household_invite
-- ----------------------------------------------------------------------------
-- Atomic redemption. Called by the Worker after the recipient has signed up
-- and the Worker has hashed their code input. Creates a person row if the
-- account doesn't already have one in this org.

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

  -- Find and lock the invite row.
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

  -- Subscription lock check.
  if not public.is_org_operational(v_org_id) then
    raise exception 'SUBSCRIPTION_INACTIVE';
  end if;

  -- Same account cannot already be active household member of this unit.
  if exists (
    select 1 from public.household_members
    where unit_id = v_hm.unit_id
      and account_id = v_account
      and status = 'active'
  ) then
    raise exception 'ALREADY_HOUSEHOLD_MEMBER';
  end if;

  -- Find or create the person row for this account in this org.
  select id into v_person_id
    from public.people
   where account_id = v_account
     and organization_id = v_org_id
   limit 1;

  if v_person_id is null then
    select display_name into v_display
      from public.accounts where id = v_account;

    insert into public.people (organization_id, account_id, full_name, status)
    values (v_org_id, v_account, coalesce(v_display, 'Household Member'), 'active')
    returning id into v_person_id;
  end if;

  -- Link the invite; clear hash — single-use.
  update public.household_members
     set account_id = v_account,
         person_id = v_person_id,
         status = 'active',
         joined_at = now(),
         invite_code_hash = null
   where id = v_hm.id;

  -- Audit.
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

comment on function public.redeem_household_invite(text) is
  'Atomically redeems a household invite. Links account, creates person if needed, marks membership active.';


-- ----------------------------------------------------------------------------
-- 5. Trigger: ending an occupancy ends all household members of the unit
-- ----------------------------------------------------------------------------

create or replace function public.end_household_members_for_unit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'active' and new.status = 'ended' then
    update public.household_members
       set status = 'ended',
           ended_at = now(),
           ended_by = new.ended_by,
           end_reason = 'occupancy ended'
     where unit_id = new.unit_id
       and status = 'active';
  end if;
  return new;
end;
$$;

comment on function public.end_household_members_for_unit() is
  'Trigger: when a unit occupancy ends, all active household members of the unit end.';

create trigger occupancies_end_household_members
  after update on public.occupancies
  for each row execute function public.end_household_members_for_unit();


-- ----------------------------------------------------------------------------
-- 6. Trigger: ending a household member revokes their authorizations
-- ----------------------------------------------------------------------------

create or replace function public.revoke_authorizations_on_household_end()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'active' and new.status = 'ended' and old.account_id is not null then
    update public.authorizations
       set status = 'revoked',
           revoked_at = now(),
           revoked_by = new.ended_by,
           revoke_reason = 'household membership ended'
     where created_by = old.account_id
       and scope_unit_id = old.unit_id
       and status in ('active', 'in_progress');
  end if;
  return new;
end;
$$;

comment on function public.revoke_authorizations_on_household_end() is
  'Trigger: when a household member ends, their active authorizations for the unit revoke.';

create trigger household_members_revoke_authorizations
  after update on public.household_members
  for each row execute function public.revoke_authorizations_on_household_end();


-- ----------------------------------------------------------------------------
-- 7. Row Level Security — household_members
-- ----------------------------------------------------------------------------

alter table public.household_members enable row level security;

-- Read: self, Primary Resident of the unit, or org admin.
create policy household_members_select on public.household_members
  for select
  using (
    account_id = public.current_account_id()
    or public.is_org_admin(public.unit_organization_id(unit_id))
    or unit_id = public.current_occupied_unit_id(public.unit_organization_id(unit_id))
  );

-- Insert: Primary Resident of the unit, org operational.
create policy household_members_insert_primary_resident on public.household_members
  for insert
  with check (
    unit_id = public.current_occupied_unit_id(public.unit_organization_id(unit_id))
    and public.is_org_operational(public.unit_organization_id(unit_id))
  );

-- Update: Primary Resident of the unit or org admin (to end membership).
create policy household_members_update_primary_resident on public.household_members
  for update
  using (
    unit_id = public.current_occupied_unit_id(public.unit_organization_id(unit_id))
    or public.is_org_admin(public.unit_organization_id(unit_id))
  )
  with check (
    unit_id = public.current_occupied_unit_id(public.unit_organization_id(unit_id))
    or public.is_org_admin(public.unit_organization_id(unit_id))
  );

-- No DELETE policy — rows are ended, never deleted.


-- ----------------------------------------------------------------------------
-- 8. Row Level Security — authorizations (three-tier visibility)
-- ----------------------------------------------------------------------------
-- Existing policies must be replaced. Three tiers now:
--   Admin             -> all in org
--   Primary Resident  -> all for their unit
--   Household member  -> only their own (created_by = current account)
--   Person (visitor)  -> their own

-- Drop and recreate the SELECT policies.
drop policy authorizations_select_admin on public.authorizations;
create policy authorizations_select_admin on public.authorizations
  for select
  using (public.is_org_admin(organization_id));

drop policy authorizations_select_primary_resident on public.authorizations;
create policy authorizations_select_primary_resident on public.authorizations
  for select
  using (
    scope_unit_id is not null
    and scope_unit_id = public.current_occupied_unit_id(organization_id)
  );

-- Household member sees only their own authorizations.
create policy authorizations_select_household_member on public.authorizations
  for select
  using (
    scope_unit_id is not null
    and created_by = public.current_account_id()
    and public.is_household_member_of_unit(scope_unit_id)
  );

drop policy authorizations_select_self on public.authorizations;
create policy authorizations_select_self on public.authorizations
  for select
  using (person_id = public.current_person_id(organization_id));


-- ----------------------------------------------------------------------------
-- 9. Row Level Security — people (household members can create visitors)
-- ----------------------------------------------------------------------------
-- Existing: people_insert_admin (admin + operational).
-- Add: household member can create visitor people in their org. Scope
-- checked at the function level when they create an authorization.

drop policy people_insert_admin on public.people;
create policy people_insert_admin on public.people
  for insert
  with check (
    public.is_org_admin(organization_id)
    and public.is_org_operational(organization_id)
  );

create policy people_insert_household_member on public.people
  for insert
  with check (
    public.is_org_operational(organization_id)
    and exists (
      select 1
      from public.household_members hm
      join public.units u on u.id = hm.unit_id
      join public.properties p on p.id = u.property_id
      where hm.account_id = public.current_account_id()
        and hm.status = 'active'
        and p.organization_id = people.organization_id
    )
  );

-- ============================================================================
-- Summary of what this migration enforces:
--
--   household_members: single table, invite-code redemption, multi-unit
--   per account supported, one active membership per (unit, account).
--
--   Cascade rules (triggers, not application):
--     Occupancy ends -> all household members of the unit end
--     Household member ends -> their active authorizations revoke
--
--   Visibility tiers on authorizations:
--     Admin: all in org
--     Primary Resident: all for their unit
--     Household member: only their own
--     Person: only their own
--
--   Next migration (0032) updates create_authorization_with_credential
--   to accept the household member path.
-- ============================================================================
