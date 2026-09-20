-- ============================================================================
-- Migration 0008: shifts and shift_sessions
-- ============================================================================
-- Purpose:
--   Shift = a scheduled time slot at a specific gate, created by Admin.
--   Shift Session = one guard's actual participation in a shift.
--
--   Design A (confirmed):
--     Admin creates shift: gate + time window → shift_code generated.
--     Guard arrives at gate: enters shift_code + guard_code → session starts.
--     Capacity is per-gate and counts all active sessions at that gate.
--
--   Lifecycle (handoff §22):
--     Shift:     SCHEDULED → ACTIVE → COMPLETED
--                exceptional CANCELLED / INTERRUPTED
--     Session:   ACTIVE → COMPLETED
--                exceptional INTERRUPTED
--
--   Business rules embedded (flagged for confirmation):
--     1. Early-start grace: p_early_minutes before scheduled_start (default 30)
--     2. Late cutoff: cannot start after scheduled_end
--     3. Capacity counts active sessions across all shifts at the gate
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. shifts
-- ----------------------------------------------------------------------------

create table public.shifts (
  id               uuid primary key default public.uuidv7(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  gate_id          uuid not null references public.gates(id) on delete restrict,
  shift_code       text not null,
  scheduled_start  timestamptz not null,
  scheduled_end    timestamptz not null,
  status           text not null default 'scheduled'
                   check (status in ('scheduled', 'active', 'completed', 'cancelled', 'interrupted')),
  started_at       timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  cancelled_by     uuid references public.accounts(id) on delete set null,
  cancel_reason    text,
  created_by       uuid references public.accounts(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint shifts_scheduled_order check (scheduled_end > scheduled_start)
);

comment on table public.shifts is
  'Scheduled time slot at a gate, created by Admin.';

comment on column public.shifts.shift_code is
  'Random unique code (SH-XXXXXX). Guard enters this + guard_code to start.';

comment on column public.shifts.started_at is
  'Set when the first session on this shift begins. Distinct from scheduled_start.';

create trigger shifts_set_updated_at
  before update on public.shifts
  for each row execute function public.set_updated_at();

create index shifts_organization_id on public.shifts(organization_id);
create index shifts_gate_id on public.shifts(gate_id);
create index shifts_organization_scheduled_start on public.shifts(organization_id, scheduled_start);
create index shifts_open_lookup on public.shifts(gate_id, status)
  where status in ('scheduled', 'active');

-- shift_code is unique per organization.
create unique index shifts_unique_code_per_org
  on public.shifts(organization_id, shift_code);

-- ----------------------------------------------------------------------------
-- 2. shift_sessions
-- ----------------------------------------------------------------------------

create table public.shift_sessions (
  id                uuid primary key default public.uuidv7(),
  shift_id          uuid not null references public.shifts(id) on delete restrict,
  guard_profile_id  uuid not null references public.guard_profiles(id) on delete restrict,
  status            text not null default 'active'
                    check (status in ('active', 'completed', 'interrupted')),
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  ended_by          uuid references public.accounts(id) on delete set null,
  end_reason        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint shift_sessions_end_consistency
    check (
      (status in ('completed', 'interrupted') and ended_at is not null)
      or (status = 'active' and ended_at is null)
    )
);

comment on table public.shift_sessions is
  'One guard''s actual participation in a shift. Tracks actual start/end.';

create trigger shift_sessions_set_updated_at
  before update on public.shift_sessions
  for each row execute function public.set_updated_at();

-- One active session per guard (handoff §23).
create unique index shift_sessions_one_active_per_guard
  on public.shift_sessions(guard_profile_id)
  where status = 'active';

-- Guard cannot have two active sessions on the same shift.
create unique index shift_sessions_one_active_per_shift_per_guard
  on public.shift_sessions(shift_id, guard_profile_id)
  where status = 'active';

create index shift_sessions_shift_id on public.shift_sessions(shift_id);
create index shift_sessions_guard_profile_id on public.shift_sessions(guard_profile_id);
create index shift_sessions_active_by_shift
  on public.shift_sessions(shift_id)
  where status = 'active';

-- ----------------------------------------------------------------------------
-- 3. Trigger: auto-generate shift_code on insert
-- ----------------------------------------------------------------------------

create or replace function public.set_shift_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.shift_code is null or new.shift_code = '' then
    new.shift_code := public.generate_code_for_org(
      'SH-', 6, 'shifts', 'shift_code', new.organization_id
    );
  end if;
  return new;
end;
$$;

comment on function public.set_shift_code() is
  'Trigger function: assigns shift_code on insert if not already set.';

create trigger shifts_set_code
  before insert on public.shifts
  for each row execute function public.set_shift_code();

-- ----------------------------------------------------------------------------
-- 4. Atomic: start_shift_session
-- ----------------------------------------------------------------------------
-- Validates everything in one transaction. Locks the gate row so concurrent
-- starts cannot both pass the capacity check.
--
-- Errors raised (strings the application maps to result codes):
--   SHIFT_NOT_FOUND, SHIFT_NOT_OPEN, SHIFT_ENDED
--   GUARD_NOT_FOUND, GUARD_NOT_ACTIVE
--   GATE_NOT_ACTIVE, GATE_CAPACITY_REACHED
--   GUARD_ALREADY_ON_SHIFT
--
-- Auth note: SECURITY DEFINER so guards can call this without direct INSERT
-- rights on shift_sessions. Caller must supply a valid organization_id;
-- proper authentication of the caller is wired in Phase 7.

create or replace function public.start_shift_session(
  p_organization_id uuid,
  p_shift_code      text,
  p_guard_code      text,
  p_early_minutes   int default 30
)
returns table (
  session_id uuid,
  shift_id   uuid,
  gate_id    uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift       record;
  v_guard       record;
  v_gate        record;
  v_active_cnt  int;
  v_existing    uuid;
  v_session_id  uuid;
begin
  -- Locate shift
  select * into v_shift
  from public.shifts
  where organization_id = p_organization_id
    and shift_code = p_shift_code;

  if v_shift is null then
    raise exception 'SHIFT_NOT_FOUND';
  end if;

  if v_shift.status not in ('scheduled', 'active') then
    raise exception 'SHIFT_NOT_OPEN';
  end if;

  if now() > v_shift.scheduled_end then
    raise exception 'SHIFT_ENDED';
  end if;

  if now() < v_shift.scheduled_start - make_interval(mins => p_early_minutes) then
    raise exception 'SHIFT_NOT_OPEN';
  end if;

  -- Locate guard
  select * into v_guard
  from public.guard_profiles
  where organization_id = p_organization_id
    and guard_code = p_guard_code;

  if v_guard is null then
    raise exception 'GUARD_NOT_FOUND';
  end if;

  if v_guard.status <> 'active' then
    raise exception 'GUARD_NOT_ACTIVE';
  end if;

  -- Lock the gate row and check capacity
  select * into v_gate
  from public.gates
  where id = v_shift.gate_id
  for update;

  if v_gate is null or v_gate.status <> 'active' then
    raise exception 'GATE_NOT_ACTIVE';
  end if;

  select count(*) into v_active_cnt
  from public.shift_sessions s
  join public.shifts sh on sh.id = s.shift_id
  where sh.gate_id = v_gate.id
    and s.status = 'active';

  if v_active_cnt >= v_gate.max_active_guards then
    raise exception 'GATE_CAPACITY_REACHED';
  end if;

  -- Guard must have no other active session
  select id into v_existing
  from public.shift_sessions
  where guard_profile_id = v_guard.id
    and status = 'active';

  if v_existing is not null then
    raise exception 'GUARD_ALREADY_ON_SHIFT';
  end if;

  -- Create the session
  insert into public.shift_sessions (shift_id, guard_profile_id, status, started_at)
  values (v_shift.id, v_guard.id, 'active', now())
  returning id into v_session_id;

  -- Mark shift active on first join
  if v_shift.status = 'scheduled' then
    update public.shifts
    set status = 'active', started_at = now()
    where id = v_shift.id;
  end if;

  return query select v_session_id, v_shift.id, v_gate.id;
end;
$$;

comment on function public.start_shift_session(uuid, text, text, int) is
  'Atomically validates and starts a shift session. Locks gate row for capacity.';

-- ----------------------------------------------------------------------------
-- 5. end_shift_session
-- ----------------------------------------------------------------------------
-- Ends one guard's session. Does NOT auto-complete the shift; the shift is
-- completed separately (by admin, or when no active sessions remain).

create or replace function public.end_shift_session(
  p_organization_id uuid,
  p_session_id      uuid,
  p_reason          text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_shift   record;
begin
  select s.* into v_session
  from public.shift_sessions s
  join public.shifts sh on sh.id = s.shift_id
  where s.id = p_session_id
    and sh.organization_id = p_organization_id;

  if v_session is null then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if v_session.status <> 'active' then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;

  update public.shift_sessions
  set status = 'completed',
      ended_at = now(),
      ended_by = public.current_account_id(),
      end_reason = p_reason
  where id = p_session_id;

  -- If no active sessions remain on the shift, mark the shift completed.
  select sh.* into v_shift
  from public.shifts sh
  where sh.id = v_session.shift_id;

  if not exists (
    select 1 from public.shift_sessions
    where shift_id = v_shift.id
      and status = 'active'
  ) then
    update public.shifts
    set status = 'completed', completed_at = now()
    where id = v_shift.id;
  end if;
end;
$$;

comment on function public.end_shift_session(uuid, uuid, text) is
  'Ends a guard session. Auto-completes the shift if no active sessions remain.';

-- ----------------------------------------------------------------------------
-- 6. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.shifts          enable row level security;
alter table public.shift_sessions  enable row level security;

-- shifts: admins see all in org; a guard sees shifts they have sessions on.
create policy shifts_select_admin on public.shifts
  for select
  using (public.is_org_admin(organization_id));

create policy shifts_select_guard_own on public.shifts
  for select
  using (
    exists (
      select 1 from public.shift_sessions s
      where s.shift_id = shifts.id
        and s.guard_profile_id = public.current_guard_profile_id()
    )
  );

create policy shifts_insert_admin on public.shifts
  for insert
  with check (public.is_org_admin(organization_id));

create policy shifts_update_admin on public.shifts
  for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- shift_sessions: admins see all in org; guard sees own.
create policy shift_sessions_select_admin_or_own on public.shift_sessions
  for select
  using (
    guard_profile_id = public.current_guard_profile_id()
    or exists (
      select 1 from public.shifts sh
      where sh.id = shift_sessions.shift_id
        and public.is_org_admin(sh.organization_id)
    )
  );

create policy shift_sessions_insert_admin on public.shift_sessions
  for insert
  with check (
    exists (
      select 1 from public.shifts sh
      where sh.id = shift_id
        and public.is_org_admin(sh.organization_id)
    )
  );

create policy shift_sessions_update_admin on public.shift_sessions
  for update
  using (
    exists (
      select 1 from public.shifts sh
      where sh.id = shift_sessions.shift_id
        and public.is_org_admin(sh.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.shifts sh
      where sh.id = shift_sessions.shift_id
        and public.is_org_admin(sh.organization_id)
    )
  );

-- No DELETE — sessions are completed or interrupted, never deleted.
