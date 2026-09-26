-- ============================================================================
-- Migration 0041: remove_guard_profile
-- ============================================================================
-- Purpose:
--   Hard-delete a guard profile that was created in error and has no
--   operational history. Complements the existing deactivate path
--   (status = 'inactive'), which stays the default for guards who
--   actually worked.
--
-- Rules:
--   - Guard must exist in the caller's org
--   - Caller must be an org admin
--   - Org must be operational
--   - Guard must be 'inactive' — an active guard must be deactivated first
--   - Delete succeeds only if no shift_sessions or access_events reference
--     the guard (both have ON DELETE RESTRICT). Otherwise we raise
--     GUARD_HAS_HISTORY and nothing is deleted.
--
-- Cleanup of the associated person row:
--   The guard was created atomically with a person. If the guard is
--   removed cleanly, we attempt to remove the person too. If the person
--   is referenced elsewhere (visitor authorization, appointment), the
--   delete fails silently and the person row remains — they represent a
--   real human who has history on the platform.
--
-- Error codes:
--   NOT_AUTHENTICATED
--   NOT_AUTHORIZED
--   SUBSCRIPTION_INACTIVE
--   GUARD_NOT_FOUND
--   GUARD_NOT_INACTIVE
--   GUARD_HAS_HISTORY
-- ============================================================================

create or replace function public.remove_guard_profile(
  p_organization_id  uuid,
  p_guard_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_guard      record;
begin
  -- 1. Authenticated
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- 2. Admin of the target org
  if not public.is_org_admin(p_organization_id) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- 3. Org operational (SECURITY DEFINER bypasses RLS)
  if not public.is_org_operational(p_organization_id) then
    raise exception 'SUBSCRIPTION_INACTIVE';
  end if;

  -- 4. Guard exists in the org
  select gp.id, gp.person_id, gp.status into v_guard
    from public.guard_profiles gp
   where gp.id = p_guard_profile_id
     and gp.organization_id = p_organization_id;

  if not found then
    raise exception 'GUARD_NOT_FOUND';
  end if;

  -- 5. Guard must be inactive. An active guard must be deactivated first,
  --    so the admin explicitly goes through both steps.
  if v_guard.status <> 'inactive' then
    raise exception 'GUARD_NOT_INACTIVE';
  end if;

  -- 6. Delete the guard profile. FK from shift_sessions.guard_profile_id
  --    and access_events.guard_profile_id is ON DELETE RESTRICT.
  begin
    delete from public.guard_profiles where id = p_guard_profile_id;
  exception
    when foreign_key_violation then
      raise exception 'GUARD_HAS_HISTORY';
  end;

  -- 7. Best-effort person cleanup. If the person is referenced by any
  --    other table (authorization, appointment, access_event, etc.) the
  --    delete fails and we swallow the error — the person stays.
  begin
    delete from public.people where id = v_guard.person_id;
  exception
    when foreign_key_violation then
      null;
  end;
end;
$$;

comment on function public.remove_guard_profile(uuid, uuid) is
  'Hard-delete a guard profile with no history. Raises GUARD_HAS_HISTORY if the guard has ever worked a shift or processed an access event.';
