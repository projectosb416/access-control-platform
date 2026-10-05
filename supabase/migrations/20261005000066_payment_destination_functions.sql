-- ============================================================================
-- Migration 0066: payment_destination functions
-- ============================================================================
-- Purpose:
--   Three SECURITY DEFINER functions for managing bank transfer
--   destinations. Platform-admin only. All three write audit events
--   with NULL organization_id — destinations are platform-scoped, not
--   tenant-scoped. audit_events.organization_id is nullable (verified),
--   and log_audit_event passes NULL through without guard. The
--   existing RLS policy pair ensures only platform admins see these
--   audit rows: audit_events_select_org_admin explicitly excludes
--   NULL org, audit_events_select_platform_admin does not filter by org.
--
-- Functions:
--   upsert_payment_destination(...)    — create (p_id null) or edit
--   set_active_payment_destination(id) — activate; deactivates any
--                                        currently active row first
--   deactivate_payment_destination(id) — deactivate; zero-active is
--                                        allowed (customer page handles)
--
-- Required-fields gate:
--   To be activated, a destination must have non-null, non-blank:
--     business_name, bank_account_name, bank_name, bank_account_number
--   bank_transfer_note is optional.
--   The gate applies at two points: set_active_payment_destination,
--   and upsert when the target row is currently active (editing an
--   active destination must not silently make it incomplete).
--
-- Error codes (docs/phase-7/error-http-mapping.md):
--   NOT_AUTHENTICATED       — 401
--   NOT_PLATFORM_ADMIN      — 403
--   DESTINATION_NOT_FOUND   — 404  (new; doc update follows)
--   INCOMPLETE_DESTINATION  — 409  (new; doc update follows)
--   LABEL_REQUIRED          — 400  (new; doc update follows)
--
-- Ambiguity discipline (§11):
--   Every column reference inside these bodies is qualified with a
--   table alias. Same rule that has surfaced in 0032, 0040, 0047,
--   0048, 0057, 0060, 0064.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. upsert_payment_destination
-- ----------------------------------------------------------------------------
-- Create when p_id is null; edit when p_id is provided. Edit accepts
-- the same field set as create. The four required fields are checked
-- if (and only if) the target row is currently active — editing an
-- active destination must not silently leave it incomplete.

create or replace function public.upsert_payment_destination(
  p_id                  uuid,
  p_label               text,
  p_business_name       text,
  p_bank_account_name   text,
  p_bank_name           text,
  p_bank_account_number text,
  p_bank_transfer_note  text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id   uuid;
  v_dest_id      uuid;
  v_was_active   boolean := false;
  v_action       text;
begin
  -- 1. Auth + permission.
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN';
  end if;

  -- 2. Label is required and not blank.
  if p_label is null or length(btrim(p_label)) = 0 then
    raise exception 'LABEL_REQUIRED';
  end if;

  if p_id is null then
    -- ---- Create ----
    v_dest_id := public.uuidv7();

    insert into public.payment_destinations (
      id, label, business_name, bank_account_name, bank_name,
      bank_account_number, bank_transfer_note, is_active
    ) values (
      v_dest_id,
      btrim(p_label),
      nullif(btrim(coalesce(p_business_name, '')),       ''),
      nullif(btrim(coalesce(p_bank_account_name, '')),   ''),
      nullif(btrim(coalesce(p_bank_name, '')),           ''),
      nullif(btrim(coalesce(p_bank_account_number, '')), ''),
      nullif(btrim(coalesce(p_bank_transfer_note, '')),  ''),
      false
    );

    v_action := 'payment_destination.created';
  else
    -- ---- Edit ----
    select d.id, d.is_active
      into v_dest_id, v_was_active
      from public.payment_destinations d
     where d.id = p_id
     for update;

    if not found then
      raise exception 'DESTINATION_NOT_FOUND';
    end if;

    update public.payment_destinations d
       set label               = btrim(p_label),
           business_name       = nullif(btrim(coalesce(p_business_name, '')),       ''),
           bank_account_name   = nullif(btrim(coalesce(p_bank_account_name, '')),   ''),
           bank_name           = nullif(btrim(coalesce(p_bank_name, '')),           ''),
           bank_account_number = nullif(btrim(coalesce(p_bank_account_number, '')), ''),
           bank_transfer_note  = nullif(btrim(coalesce(p_bank_transfer_note, '')),  '')
     where d.id = p_id;

    v_action := 'payment_destination.updated';
  end if;

  -- 3. If the row is currently active, required fields must remain valid.
  if v_was_active then
    if exists (
      select 1 from public.payment_destinations d
       where d.id = v_dest_id
         and (d.business_name       is null
              or d.bank_account_name   is null
              or d.bank_name           is null
              or d.bank_account_number is null)
    ) then
      raise exception 'INCOMPLETE_DESTINATION';
    end if;
  end if;

  -- 4. Audit — NULL org, platform-scoped.
  perform public.log_audit_event(
    null,
    v_account_id,
    v_action,
    'payment_destination',
    v_dest_id,
    null,
    jsonb_build_object('label', btrim(p_label))
  );

  return v_dest_id;
end;
$$;

comment on function public.upsert_payment_destination(
  uuid, text, text, text, text, text, text
) is
  'Create (p_id null) or edit a bank transfer destination. Platform-admin only. Edits to an active destination must keep the four customer-facing fields non-null.';


-- ----------------------------------------------------------------------------
-- 2. set_active_payment_destination
-- ----------------------------------------------------------------------------
-- Deactivate any currently active row FIRST, then activate the target.
-- Partial unique index payment_destinations_one_active forbids two
-- active rows at the same instant — order matters.
--
-- Idempotent: activating an already-active row is a no-op after the
-- deactivate-then-activate sequence (net effect: still active).
-- Required fields are validated on the target.

create or replace function public.set_active_payment_destination(
  p_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_target     record;
begin
  -- 1. Auth + permission.
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN';
  end if;

  -- 2. Lock and validate the target.
  select d.id, d.label, d.business_name, d.bank_account_name,
         d.bank_name, d.bank_account_number, d.is_active
    into v_target
    from public.payment_destinations d
   where d.id = p_id
   for update;

  if not found then
    raise exception 'DESTINATION_NOT_FOUND';
  end if;

  -- 3. Required-fields gate.
  if v_target.business_name is null
     or v_target.bank_account_name is null
     or v_target.bank_name is null
     or v_target.bank_account_number is null then
    raise exception 'INCOMPLETE_DESTINATION';
  end if;

  -- 4. Idempotent no-op if already active.
  if v_target.is_active then
    return;
  end if;

  -- 5. Deactivate current active row (if any), then activate target.
  update public.payment_destinations d
     set is_active = false
   where d.is_active = true;

  update public.payment_destinations d
     set is_active = true
   where d.id = p_id;

  -- 6. Audit — NULL org.
  perform public.log_audit_event(
    null,
    v_account_id,
    'payment_destination.activated',
    'payment_destination',
    p_id,
    null,
    jsonb_build_object('label', v_target.label)
  );
end;
$$;

comment on function public.set_active_payment_destination(uuid) is
  'Activate a destination; deactivates any currently active row first. Platform-admin only. Rejects incomplete destinations.';


-- ----------------------------------------------------------------------------
-- 3. deactivate_payment_destination
-- ----------------------------------------------------------------------------
-- Flip is_active to false. Zero active is permitted — the
-- customer-facing billing page handles the empty state by hiding the
-- bank transfer option. Idempotent on already-inactive rows.

create or replace function public.deactivate_payment_destination(
  p_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_target     record;
begin
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if not public.is_platform_admin() then
    raise exception 'NOT_PLATFORM_ADMIN';
  end if;

  select d.id, d.label, d.is_active
    into v_target
    from public.payment_destinations d
   where d.id = p_id
   for update;

  if not found then
    raise exception 'DESTINATION_NOT_FOUND';
  end if;

  -- Idempotent no-op.
  if not v_target.is_active then
    return;
  end if;

  update public.payment_destinations d
     set is_active = false
   where d.id = p_id;

  perform public.log_audit_event(
    null,
    v_account_id,
    'payment_destination.deactivated',
    'payment_destination',
    p_id,
    null,
    jsonb_build_object('label', v_target.label)
  );
end;
$$;

comment on function public.deactivate_payment_destination(uuid) is
  'Deactivate a destination. Platform-admin only. Idempotent. Zero active destinations is a valid state.';
