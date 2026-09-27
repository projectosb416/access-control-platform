-- ============================================================================
-- Migration 0043: extend setup_organization with property location
-- ============================================================================
-- Migration 0022 created setup_organization(org_name, org_type, admin_name,
-- property_name, unit_label). This replaces it with a version that also
-- accepts address, city, and state for the initial property.
--
-- Why drop + recreate instead of CREATE OR REPLACE: PostgreSQL treats a
-- function signature change as a new function, so CREATE OR REPLACE alone
-- would leave the old one in place. Explicit DROP then CREATE is the
-- unambiguous path.
--
-- Defaults on the new parameters mean any existing caller (including the
-- current wizard build until we update it in the same Phase 9 pass) keeps
-- working unchanged.
-- ============================================================================

drop function if exists public.setup_organization(text, text, text, text, text);

create or replace function public.setup_organization(
  p_org_name           text,
  p_org_type           text,
  p_admin_full_name    text,
  p_property_name      text,
  p_unit_label         text default null,
  p_property_address   text default null,
  p_property_city      text default null,
  p_property_state     text default null
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
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

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

  v_org_id := public.uuidv7();
  insert into public.organizations (id, name, display_name, organization_type, status)
  values (v_org_id, btrim(p_org_name), btrim(p_org_name), p_org_type, 'provisioning');

  v_person_id := public.uuidv7();
  insert into public.people (
    id, organization_id, account_id, full_name, status, created_by
  ) values (
    v_person_id, v_org_id, v_account_id, btrim(p_admin_full_name), 'active', v_account_id
  );

  v_membership_id := public.uuidv7();
  insert into public.organization_memberships (
    id, organization_id, account_id, role, status, joined_at
  ) values (
    v_membership_id, v_org_id, v_account_id, 'admin', 'active', now()
  );

  v_property_id := public.uuidv7();
  insert into public.properties (
    id, organization_id, name, address, city, state, status
  ) values (
    v_property_id, v_org_id, btrim(p_property_name),
    nullif(btrim(coalesce(p_property_address, '')), ''),
    nullif(btrim(coalesce(p_property_city,    '')), ''),
    nullif(btrim(coalesce(p_property_state,   '')), ''),
    'active'
  );

  if p_unit_label is not null and length(btrim(p_unit_label)) > 0 then
    v_unit_id := public.uuidv7();
    insert into public.units (id, property_id, label, status)
    values (v_unit_id, v_property_id, btrim(p_unit_label), 'active');
  end if;

  return query select v_org_id, v_person_id, v_property_id, v_unit_id, v_membership_id;
end;
$$;

comment on function public.setup_organization(text, text, text, text, text, text, text, text) is
  'Atomic first-signup setup: org + admin person + membership + first property (with location) + optional first unit. SECURITY DEFINER — the only permitted RLS bypass.';
