-- ============================================================================
-- Migration 0027: create_authorization_with_credential
-- ============================================================================
-- Purpose:
--   Atomically create an authorization and its initial credential.
--
--   Two callers, two scopes:
--     - Org admin  → org-wide authorization (scope_unit_id = NULL) or unit-scoped
--     - Primary Resident → unit-scoped only, for their occupied unit
--
--   Split of responsibilities (locked in Phase 7 boundary doc):
--     Worker side: compute PHC string and lookup_key using the pepper.
--     Postgres side: validate everything, insert authorization + credential,
--                    write audit — all in one transaction.
--
--   The raw PIN never reaches this function. It receives:
--     p_credential  — the PHC string produced by PBKDF2 in the Worker
--     p_lookup_key  — the HMAC lookup key produced in the Worker
--
-- Error codes (Worker maps to HTTP statuses):
--   NOT_AUTHENTICATED
--   SUBSCRIPTION_INACTIVE
--   NOT_AUTHORIZED
--   PERSON_NOT_IN_ORG
--   PERSON_NOT_ACTIVE
--   UNIT_NOT_IN_ORG
--   UNIT_NOT_ACTIVE
--   APPOINTMENT_NOT_IN_ORG
--   HOST_NOT_IN_ORG
--   INVALID_ACCESS_TYPE
--   INVALID_AUTHORIZATION_TYPE
--   INVALID_VALIDITY_WINDOW
--   PURPOSE_REQUIRED
--   INVALID_CREDENTIAL_FORMAT
--   INVALID_LOOKUP_KEY
--   PIN_COLLISION
-- ============================================================================

create or replace function public.create_authorization_with_credential(
  p_organization_id     uuid,
  p_person_id           uuid,
  p_scope_unit_id       uuid,
  p_appointment_id      uuid,
  p_access_type         text,
  p_purpose             text,
  p_note                text,
  p_host_person_id      uuid,
  p_authorization_type  text,
  p_valid_from          timestamptz,
  p_valid_until         timestamptz,
  p_credential          text,
  p_lookup_key          text,
  p_pepper_version      text default 'v1'
)
returns table (
  authorization_id uuid,
  credential_id    uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id      uuid;
  v_auth_id         uuid;
  v_cred_id         uuid;
  v_person          record;
  v_unit            record;
begin
  -- 1. Caller must be authenticated.
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- 2. Subscription lock. SECURITY DEFINER bypasses the RLS lock added
  --    in migration 0022, so enforce here.
  if not public.is_org_operational(p_organization_id) then
    raise exception 'SUBSCRIPTION_INACTIVE';
  end if;

  -- 3. Permission based on scope.
  if p_scope_unit_id is null then
    if not public.is_org_admin(p_organization_id) then
      raise exception 'NOT_AUTHORIZED';
    end if;
  else
    if not (
      public.is_org_admin(p_organization_id)
      or p_scope_unit_id = public.current_occupied_unit_id(p_organization_id)
    ) then
      raise exception 'NOT_AUTHORIZED';
    end if;
  end if;

  -- 4. Person validation.
  select * into v_person
    from public.people
   where id = p_person_id
     and organization_id = p_organization_id;

  if not found then
    raise exception 'PERSON_NOT_IN_ORG';
  end if;

  if v_person.status <> 'active' then
    raise exception 'PERSON_NOT_ACTIVE';
  end if;

  -- 5. Scope unit validation (if provided).
  if p_scope_unit_id is not null then
    select u.* into v_unit
      from public.units u
      join public.properties p on p.id = u.property_id
     where u.id = p_scope_unit_id
       and p.organization_id = p_organization_id;

    if not found then
      raise exception 'UNIT_NOT_IN_ORG';
    end if;

    if v_unit.status <> 'active' then
      raise exception 'UNIT_NOT_ACTIVE';
    end if;
  end if;

  -- 6. Appointment validation (if provided).
  if p_appointment_id is not null then
    if not exists (
      select 1 from public.appointments
       where id = p_appointment_id
         and organization_id = p_organization_id
    ) then
      raise exception 'APPOINTMENT_NOT_IN_ORG';
    end if;
  end if;

  -- 7. Host person validation (if provided).
  if p_host_person_id is not null then
    if not exists (
      select 1 from public.people
       where id = p_host_person_id
         and organization_id = p_organization_id
    ) then
      raise exception 'HOST_NOT_IN_ORG';
    end if;
  end if;

  -- 8. Enum validation — clean errors before the table CHECK fires.
  if p_access_type is null
     or p_access_type not in ('visitor','vendor','contractor','client','employee','family_member','other') then
    raise exception 'INVALID_ACCESS_TYPE';
  end if;

  if p_authorization_type is null
     or p_authorization_type not in ('one_time','reusable') then
    raise exception 'INVALID_AUTHORIZATION_TYPE';
  end if;

  -- 9. Validity window.
  if p_valid_from is null or p_valid_until is null or p_valid_until <= p_valid_from then
    raise exception 'INVALID_VALIDITY_WINDOW';
  end if;

  -- 10. Purpose.
  if p_purpose is null or length(btrim(p_purpose)) = 0 then
    raise exception 'PURPOSE_REQUIRED';
  end if;

  -- 11. Credential format — PHC strings start with '$'.
  if p_credential is null
     or length(btrim(p_credential)) = 0
     or p_credential not like '$%' then
    raise exception 'INVALID_CREDENTIAL_FORMAT';
  end if;

  -- 12. Lookup key non-blank.
  if p_lookup_key is null or length(btrim(p_lookup_key)) = 0 then
    raise exception 'INVALID_LOOKUP_KEY';
  end if;

  -- 13. PIN collision pre-check. Matches the exact predicate of the
  --     partial unique index access_credentials_unique_live_lookup_key.
  if exists (
    select 1 from public.access_credentials
     where organization_id = p_organization_id
       and lookup_key = p_lookup_key
       and status in ('created','active','in_use')
  ) then
    raise exception 'PIN_COLLISION';
  end if;

  -- 14. Create the authorization.
  v_auth_id := public.uuidv7();

  insert into public.authorizations (
    id, organization_id, person_id, scope_unit_id, appointment_id,
    access_type, purpose, note, host_person_id,
    authorization_type, valid_from, valid_until, status, created_by
  ) values (
    v_auth_id, p_organization_id, p_person_id, p_scope_unit_id, p_appointment_id,
    p_access_type, btrim(p_purpose), p_note, p_host_person_id,
    p_authorization_type, p_valid_from, p_valid_until, 'active', v_account_id
  );

  -- 15. Create the credential.
  v_cred_id := public.uuidv7();

  insert into public.access_credentials (
    id, organization_id, authorization_id,
    credential, lookup_key, lookup_key_version, pepper_version,
    status, created_by
  ) values (
    v_cred_id, p_organization_id, v_auth_id,
    p_credential, p_lookup_key, p_pepper_version, p_pepper_version,
    'active', v_account_id
  );

  -- 16. Audit — same transaction as the state change.
  perform public.log_audit_event(
    p_organization_id,
    v_account_id,
    'authorization.created',
    'authorization',
    v_auth_id,
    null,
    jsonb_build_object(
      'person_id',          p_person_id,
      'authorization_type', p_authorization_type,
      'access_type',        p_access_type,
      'scope_unit_id',      p_scope_unit_id,
      'credential_id',      v_cred_id
    )
  );

  return query select v_auth_id, v_cred_id;
end;
$$;

comment on function public.create_authorization_with_credential(
  uuid, uuid, uuid, uuid, text, text, text, uuid, text, timestamptz, timestamptz, text, text, text
) is
  'Atomically creates an authorization + its PHC credential + audit entry. Permission, org, subscription, and PIN collision all validated inside the transaction.';
