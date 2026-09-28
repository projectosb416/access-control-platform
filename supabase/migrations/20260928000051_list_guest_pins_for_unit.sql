-- ============================================================================
-- Migration 0051: list_guest_pins_for_unit
-- ============================================================================
-- Purpose:
--   Read-only list of guest PINs for a unit, filtered to the calling
--   resident's own creations (created_by = current_account_id).
--
--   Why this exists: people_select_admin_or_self in migration 0005 only
--   permits SELECT on people rows where account_id = current_account_id
--   OR is_org_admin(organization_id). Visitor person rows have account_id
--   NULL, so a resident cannot read visitor names through RLS. This
--   SECURITY DEFINER function performs the scoped join the resident
--   cannot do directly, and enforces the same residency check as 0050.
--
--   Returns:
--     - Currently active PINs (status active/in_progress AND valid_until
--       in the future). Includes PINs where a visitor is currently
--       inside (in_progress).
--     - Recently ended PINs (status completed/expired/revoked/cancelled
--       with recent activity, OR status active-but-expired where the
--       window just closed). Bounded by a 7-day lookback on
--       greatest(updated_at, valid_until).
--
--   entry_count is the number of successful ENTRY events on this
--   authorization. Lets a resident verify a reusable PIN was actually
--   used ("Used 3 times"). Required for the reusable-PIN UX to be
--   non-brick — see 4a.iii design notes.
--
-- Error codes (Worker maps to HTTP statuses per docs/phase-7/error-http-mapping.md):
--   NOT_AUTHENTICATED
--   UNIT_NOT_FOUND
--   NOT_AUTHORIZED
-- ============================================================================

create or replace function public.list_guest_pins_for_unit(p_unit_id uuid)
returns table (
  authorization_id    uuid,
  credential_id       uuid,
  visitor_full_name   text,
  visitor_phone       text,
  purpose             text,
  note                text,
  access_type         text,
  authorization_type  text,
  status              text,
  valid_from          timestamptz,
  valid_until         timestamptz,
  created_at          timestamptz,
  updated_at          timestamptz,
  entry_count         int,
  is_active           boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_org_id     uuid;
begin
  -- 1. Authenticated.
  v_account_id := public.current_account_id();
  if v_account_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- 2. Unit exists, capture its org for the residency check.
  select p.organization_id into v_org_id
    from public.units u
    join public.properties p on p.id = u.property_id
   where u.id = p_unit_id;

  if not found then
    raise exception 'UNIT_NOT_FOUND';
  end if;

  -- 3. Caller is the active primary resident of this unit.
  if not exists (
    select 1
      from public.occupancies o
     where o.unit_id = p_unit_id
       and o.account_id = v_account_id
       and o.status = 'active'
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- 4. Return the list. All references to columns that share a name with
  --    a returns-table OUT parameter are qualified to avoid plpgsql
  --    ambiguity (§11: migrations 0032, 0040).
  return query
    select
      a.id                 as authorization_id,
      c.id                 as credential_id,
      pe.full_name         as visitor_full_name,
      pe.phone             as visitor_phone,
      a.purpose            as purpose,
      a.note               as note,
      a.access_type        as access_type,
      a.authorization_type as authorization_type,
      a.status             as status,
      a.valid_from         as valid_from,
      a.valid_until        as valid_until,
      a.created_at         as created_at,
      a.updated_at         as updated_at,
      coalesce((
        select count(*)::int
          from public.access_events ae
         where ae.authorization_id = a.id
           and ae.direction       = 'entry'
           and ae.result_code     = 'GRANTED'
      ), 0)                as entry_count,
      (a.status in ('active','in_progress') and a.valid_until > now())
                           as is_active
    from public.authorizations a
    left join public.people pe
           on pe.id = a.person_id
    left join public.access_credentials c
           on c.authorization_id = a.id
    where a.scope_unit_id = p_unit_id
      and a.created_by    = v_account_id
      and (
        -- (A) Currently active and usable.
        (a.status in ('active','in_progress') and a.valid_until > now())
        or
        -- (B) Explicitly terminal with recent activity/window.
        (
          a.status in ('completed','expired','revoked','cancelled')
          and greatest(a.updated_at, a.valid_until) > now() - interval '7 days'
        )
        or
        -- (C) Still marked active but window just closed — the
        --     status-flip gap the retention note in 4a.v will document.
        (
          a.status in ('active','in_progress')
          and a.valid_until <= now()
          and a.valid_until >  now() - interval '7 days'
        )
      )
    order by a.created_at desc;
end;
$$;

comment on function public.list_guest_pins_for_unit(uuid) is
  'Read-only list of guest PINs for a unit, scoped to the calling resident''s own creations. Resident-only. SECURITY DEFINER to bypass people_select_admin_or_self, which cannot see visitor rows (account_id NULL).';
