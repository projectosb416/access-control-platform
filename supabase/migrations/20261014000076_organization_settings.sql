-- ============================================================================
-- Migration 0076: organization settings
-- ============================================================================
-- Purpose:
--   Three changes:
--     1. Drop the row-scoped organizations_update_admin policy. RLS
--        policies are row-scoped, not column-scoped — a policy cannot
--        restrict WHICH columns an UPDATE changes. An org admin could
--        therefore flip status='active' without paying, rewrite
--        created_at, or set organization_type to any value. This is
--        the same class as 0053, 0055, #18, 0057 (continuity §6).
--     2. Add update_organization_settings() — a column-whitelisted
--        SECURITY DEFINER RPC that becomes the only path for editing
--        the user-facing subset of org fields.
--     3. Add a CHECK constraint on organization_type. Matches the
--        locked architectural decision (continuity §6: status columns
--        as text with CHECK, not native enums). The wizard has
--        validated this in the app layer since inception; the DB now
--        enforces it too.
--
-- User-editable subset (v1):
--   name, display_name, organization_type.
--   name and display_name are set to the same value — matching the
--   wizard's setup_organization() behavior. Split is deferred.
--
-- System-managed, not exposed:
--   status (payment lifecycle), created_at, updated_at (trigger).
--
-- Not present as columns (deferred):
--   timezone, notification_prefs, branding.
--
-- Ambiguity discipline (§11):
--   Every column reference inside the function body is qualified.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Close the row-scoped UPDATE hole.
-- ----------------------------------------------------------------------------

drop policy if exists organizations_update_admin on public.organizations;


-- ----------------------------------------------------------------------------
-- 2. Enforce the enum at the DB layer.
-- ----------------------------------------------------------------------------

alter table public.organizations
  add constraint organizations_organization_type_check
  check (organization_type in ('residential', 'workplace', 'other'));

comment on constraint organizations_organization_type_check
  on public.organizations is
  'Matches the wizard''s org-type options and the locked decision to use text + CHECK rather than native enums (continuity §6).';


-- ----------------------------------------------------------------------------
-- 3. Column-whitelisted write path.
-- ----------------------------------------------------------------------------

create or replace function public.update_organization_settings(
  p_organization_id   uuid,
  p_name              text,
  p_organization_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_org_admin(p_organization_id) then
    raise exception 'NOT_ORG_ADMIN';
  end if;

  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'ORG_NAME_REQUIRED';
  end if;

  if p_organization_type is null
     or p_organization_type not in ('residential', 'workplace', 'other') then
    raise exception 'INVALID_ORG_TYPE';
  end if;

  update public.organizations o
     set name              = btrim(p_name),
         display_name      = btrim(p_name),
         organization_type = p_organization_type
   where o.id = p_organization_id;
end;
$$;

comment on function public.update_organization_settings(uuid, text, text) is
  'Org-admin only. Updates the user-editable subset of organizations: name, display_name (mirrored from name), organization_type. status and created_at are not touched; updated_at is set by the organizations_set_updated_at trigger. This is the replacement path for the dropped organizations_update_admin policy (row-scoped RLS was a bug — see continuity §6).';
