-- ============================================================================
-- Migration 0022: subscription enforcement + setup_organization
-- ============================================================================
-- Purpose:
--   Enforce the "subscription is a key" model at the database level.
--
--   When an organization is not operational (provisioning before first
--   payment, or subscription expired / suspended / cancelled), no new
--   records can be created via user-facing INSERT policies. Everything
--   that already exists stays readable and editable. Payments always work.
--
--   The lock is expressed by adding one condition to every tenant-table
--   INSERT policy:
--
--     and public.is_org_operational(<organization_id>)
--
--   This is the ONLY change to the access model. The access engine
--   (evaluate_entry, evaluate_exit, start_shift_session, end_shift_session)
--   is deliberately untouched. The guard's cascade ("no new shift → no
--   Shift ID → guard cannot start") falls out naturally: the admin simply
--   cannot create new shifts once the subscription lapses.
--
--   First-signup path:
--     setup_organization() runs SECURITY DEFINER and is the ONE permitted
--     bypass. It creates the org (in 'provisioning' state), the admin's
--     person, membership, first property, and optional first unit — all
--     before any payment exists.
--
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. setup_organization
-- ----------------------------------------------------------------------------
-- Replaces the narrower create_organization_with_admin() from migration 0003,
-- which only created the org and the admin membership. This version also
-- creates the admin's person record, the first property, and an optional
-- first unit — everything the dashboard needs to render the initial view.

create or replace function public.setup_organization(
  p_org_name        text,
  p_org_type        text,
  p_admin_full_name text,
  p_property_name   text,
  p_unit_label      text default null
)
returns table (
  organization_id uuid,
  person_id       uuid,
  property_id     uuid,
  unit_id         uuid,
  membership_id   uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id    uuid;
  v_org_id        uuid;
  v_person_id     uuid;
  v_membership_id uuid;
  v_property_id   uuid;
  v_unit_id       uuid;
begin
  -- Caller must be authenticated.
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Required inputs.
  if p_org_name is null or length(btrim(p_org_name)) = 0 then
    raise exception 'ORG_NAME_REQUIRED';
  end if;

  if p_org_type is null or p_org_type not in ('residential','workplace','other') then
    raise exception 'INVALID_ORG_TYPE';
  end if;

  if p_admin_full_name is null or length(btrim(p_admin_full_name)) = 0 then
    raise exception 'ADMIN_NAME_REQUIRED';
  end if;

  if p_property_name is null or length(btrim(p_property_name)) = 0 then
    raise exception 'PROPERTY_NAME_REQUIRED';
  end if;

  -- 1. Organization — provisioning until first payment.
  v_org_id := public.uuidv7();
  insert into public.organizations (id, name, display_name, organization_type, status)
  values (v_org_id, btrim(p_org_name), btrim(p_org_name), p_org_type, 'provisioning');

  -- 2. Admin's person record.
  v_person_id := public.uuidv7();
  insert into public.people (
    id, organization_id, account_id, full_name, status, created_by
  ) values (
    v_person_id, v_org_id, v_account_id, btrim(p_admin_full_name), 'active', v_account_id
  );

  -- 3. Admin membership — active so the dashboard is readable.
  v_membership_id := public.uuidv7();
  insert into public.organization_memberships (
    id, organization_id, account_id, role, status, joined_at
  ) values (
    v_membership_id, v_org_id, v_account_id, 'admin', 'active', now()
  );

  -- 4. First property.
  v_property_id := public.uuidv7();
  insert into public.properties (id, organization_id, name, status)
  values (v_property_id, v_org_id, btrim(p_property_name), 'active');

  -- 5. First unit (optional — some orgs have none).
  if p_unit_label is not null and length(btrim(p_unit_label)) > 0 then
    v_unit_id := public.uuidv7();
    insert into public.units (id, property_id, label, status)
    values (v_unit_id, v_property_id, btrim(p_unit_label), 'active');
  end if;

  return query select v_org_id, v_person_id, v_property_id, v_unit_id, v_membership_id;
end;
$$;

comment on function public.setup_organization(text, text, text, text, text) is
  'Atomic first-signup setup: creates org (provisioning), admin person, admin membership, first property, optional first unit. SECURITY DEFINER — the only permitted RLS bypass.';

-- Drop the narrower predecessor. Nothing references it, and the new function
-- covers its responsibilities with a wider scope.
drop function if exists public.create_organization_with_admin(text, text, text);


-- ----------------------------------------------------------------------------
-- 2. Lock every tenant INSERT policy behind is_org_operational
-- ----------------------------------------------------------------------------
-- Each policy is dropped and recreated with one added condition. Using
-- `drop policy` without `if exists` means a typo in a policy name fails
-- loudly, rather than silently leaving an unlocked policy in place.

-- organization_memberships — inviting new admins/guards/residents
drop policy memberships_insert_admin on public.organization_memberships;
create policy memberships_insert_admin on public.organization_memberships
  for insert
  with check (
    public.is_org_admin(organization_id)
    and public.is_org_operational(organization_id)
  );

-- people — adding new people
drop policy people_insert_admin on public.people;
create policy people_insert_admin on public.people
  for insert
  with check (
    public.is_org_admin(organization_id)
    and public.is_org_operational(organization_id)
  );

-- properties
drop policy properties_insert_admin on public.properties;
create policy properties_insert_admin on public.properties
  for insert
  with check (
    public.is_org_admin(organization_id)
    and public.is_org_operational(organization_id)
  );

-- units — scoped via property
drop policy units_insert_admin on public.units;
create policy units_insert_admin on public.units
  for insert
  with check (
    exists (
      select 1 from public.properties p
      where p.id = property_id
        and public.is_org_admin(p.organization_id)
        and public.is_org_operational(p.organization_id)
    )
  );

-- occupancies — scoped via unit → property
drop policy occupancies_insert_admin on public.occupancies;
create policy occupancies_insert_admin on public.occupancies
  for insert
  with check (
    exists (
      select 1 from public.units u
      join public.properties p on p.id = u.property_id
      where u.id = unit_id
        and public.is_org_admin(p.organization_id)
        and public.is_org_operational(p.organization_id)
    )
  );

-- gates
drop policy gates_insert_admin on public.gates;
create policy gates_insert_admin on public.gates
  for insert
  with check (
    public.is_org_admin(organization_id)
    and public.is_org_operational(organization_id)
  );

-- guard_profiles
drop policy guard_profiles_insert_admin on public.guard_profiles;
create policy guard_profiles_insert_admin on public.guard_profiles
  for insert
  with check (
    public.is_org_admin(organization_id)
    and public.is_org_operational(organization_id)
  );

-- shifts — this is the policy whose lock cascades to the guard
drop policy shifts_insert_admin on public.shifts;
create policy shifts_insert_admin on public.shifts
  for insert
  with check (
    public.is_org_admin(organization_id)
    and public.is_org_operational(organization_id)
  );

-- shift_sessions — scoped via shift
drop policy shift_sessions_insert_admin on public.shift_sessions;
create policy shift_sessions_insert_admin on public.shift_sessions
  for insert
  with check (
    exists (
      select 1 from public.shifts sh
      where sh.id = shift_id
        and public.is_org_admin(sh.organization_id)
        and public.is_org_operational(sh.organization_id)
    )
  );

-- appointments
drop policy appointments_insert_admin on public.appointments;
create policy appointments_insert_admin on public.appointments
  for insert
  with check (
    public.is_org_admin(organization_id)
    and public.is_org_operational(organization_id)
  );

-- authorizations — org-wide (admin)
drop policy authorizations_insert_admin on public.authorizations;
create policy authorizations_insert_admin on public.authorizations
  for insert
  with check (
    public.is_org_admin(organization_id)
    and public.is_org_operational(organization_id)
  );

-- authorizations — unit-scoped (primary resident)
drop policy authorizations_insert_primary_resident on public.authorizations;
create policy authorizations_insert_primary_resident on public.authorizations
  for insert
  with check (
    scope_unit_id is not null
    and scope_unit_id = public.current_occupied_unit_id(organization_id)
    and public.is_org_operational(organization_id)
  );


-- ============================================================================
-- Summary of the model enforced here:
--
--   Before payment, or after subscription lapse:
--     - READ      : works. Dashboard, history, reports — all visible.
--     - UPDATE    : works. End a shift, deactivate a guard, revoke a PIN.
--     - INSERT    : blocked at the 12 policies above.
--     - Payment   : works. record_manual_payment_intent() is SECURITY DEFINER
--                   and unaffected by these policies.
--
--   The guard cascade:
--     - Admin cannot create new shifts
--     - No new shift → no new Shift ID
--     - Guard has nothing to enter
--     - Existing shifts continue to function until they end
--     - Gate operations wind down naturally
--
--   No changes to the access engine. No changes to shift sessions in flight.
--   No changes to any UPDATE or SELECT policy.
-- ============================================================================
