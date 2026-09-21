-- ============================================================================
-- Migration 0011: access_sessions and access_events
-- ============================================================================
-- Purpose:
--   Complete the canonical chain (handoff §15):
--     Person → Authorization → Credential → Session → Event
--
--   access_sessions: a visit's lifecycle. Opened by ENTRY, closed by EXIT.
--     Lifecycle (§22): OPEN → COMPLETED; exceptional UNRESOLVED.
--     A missing EXIT leaves the session UNRESOLVED forever (§18).
--     Admin may investigate and record resolution metadata — the status
--     does not change, and the original events are never rewritten.
--
--   access_events: append-only log of every attempt (§19), successful or
--     failed. Never updated, never deleted. Historical fact.
--
-- Design notes:
--   - Exit may occur through a different gate than entry (§18). We store
--     gate_entered_id and gate_exited_id separately.
--   - One reusable authorization cannot have multiple active sessions (§23).
--     Enforced via partial unique index on access_sessions.
--   - Idempotency key on every event — retry-safe (§23). Unique per org.
--   - access_session_id on an event is NULL for the opening ENTRY (session
--     doesn't exist yet at insert time). Set for EXIT and any subsequent
--     event. No event updates needed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. access_sessions
-- ----------------------------------------------------------------------------

create table public.access_sessions (
  id                      uuid primary key default public.uuidv7(),
  organization_id         uuid not null references public.organizations(id) on delete restrict,
  authorization_id        uuid not null references public.authorizations(id) on delete restrict,
  person_id               uuid not null references public.people(id) on delete restrict,

  -- Entry gate is required (session only exists if entry succeeded).
  gate_entered_id         uuid not null references public.gates(id) on delete restrict,
  -- Exit gate is optional (may differ from entry; set only when exit happens).
  gate_exited_id          uuid references public.gates(id) on delete restrict,

  -- The guard shift session that performed entry, and optionally exit.
  entered_shift_session_id uuid not null references public.shift_sessions(id) on delete restrict,
  exited_shift_session_id  uuid references public.shift_sessions(id) on delete restrict,

  -- Links back to the ENTRY event that opened this session, and the EXIT
  -- event that closed it (if any). No circular dependency: the ENTRY event
  -- is inserted first, then this row is inserted referencing it.
  opened_by_event_id      uuid not null,
  closed_by_event_id      uuid,

  status                  text not null default 'open'
                          check (status in ('open','completed','unresolved')),

  entered_at              timestamptz not null default now(),
  exited_at               timestamptz,

  -- Resolution metadata for UNRESOLVED sessions. Status remains 'unresolved';
  -- these columns record that an admin investigated and closed the case.
  resolved_at             timestamptz,
  resolved_by             uuid references public.accounts(id) on delete set null,
  resolution_reason       text,
  resolution_notes        text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint access_sessions_completed_consistency
    check (
      (status = 'completed' and exited_at is not null
        and gate_exited_id is not null
        and closed_by_event_id is not null)
      or (status <> 'completed')
    ),

  constraint access_sessions_resolution_consistency
    check (
      (resolved_at is not null) = (resolved_by is not null)
    )
);

comment on table public.access_sessions is
  'A visit lifecycle. Opened by ENTRY, closed by EXIT. Can become UNRESOLVED.';

comment on column public.access_sessions.gate_exited_id is
  'May differ from gate_entered_id — handoff §18 explicitly allows exit at a different gate.';

comment on column public.access_sessions.resolution_notes is
  'For UNRESOLVED sessions: admin investigation notes. Status remains UNRESOLVED — the session never exited.';

create trigger access_sessions_set_updated_at
  before update on public.access_sessions
  for each row execute function public.set_updated_at();

create index access_sessions_organization_id on public.access_sessions(organization_id);
create index access_sessions_authorization_id on public.access_sessions(authorization_id);
create index access_sessions_person_id on public.access_sessions(person_id);

-- Fast "who is currently inside" — only open sessions matter.
create index access_sessions_open_by_org
  on public.access_sessions(organization_id, entered_at)
  where status = 'open';

-- Fast "is there an active visit for this authorization?" — used by the
-- ENTRY engine to reject a second concurrent ENTRY on a reusable auth.
create index access_sessions_active_by_authorization
  on public.access_sessions(authorization_id)
  where status = 'open';

-- Non-negotiable concurrency rule (§23): one reusable authorization cannot
-- have two unresolved active sessions.
create unique index access_sessions_one_open_per_authorization
  on public.access_sessions(authorization_id)
  where status = 'open';

-- One active session per person (a person cannot be "inside" twice).
create unique index access_sessions_one_open_per_person
  on public.access_sessions(person_id)
  where status = 'open';

-- ----------------------------------------------------------------------------
-- 2. access_events
-- ----------------------------------------------------------------------------
-- Append-only. Every attempt, successful or failed. Never updated, never
-- deleted. Historical fact (§19, §38).

create table public.access_events (
  id                    uuid primary key default public.uuidv7(),
  organization_id       uuid not null references public.organizations(id) on delete restrict,

  direction             text not null check (direction in ('entry','exit')),

  -- Every result code from handoff §19.
  result_code           text not null
                        check (result_code in (
                          'GRANTED',
                          'DENIED',
                          'INVALID_PIN',
                          'EXPIRED_AUTHORIZATION',
                          'REVOKED_AUTHORIZATION',
                          'NO_ACTIVE_SESSION',
                          'ONE_TIME_ALREADY_CONSUMED',
                          'UNRESOLVED_VISIT',
                          'RATE_LIMITED',
                          'GATE_INACTIVE',
                          'GUARD_NOT_ON_ACTIVE_SHIFT',
                          'SYSTEM_UNAVAILABLE'
                        )),
  reason                text,

  -- Context. All nullable because failures may have missing context.
  authorization_id      uuid references public.authorizations(id) on delete restrict,
  credential_id         uuid references public.access_credentials(id) on delete restrict,
  person_id             uuid references public.people(id) on delete restrict,

  -- Required context — every attempt happens at a gate, by a guard.
  gate_id               uuid not null references public.gates(id) on delete restrict,
  guard_profile_id      uuid not null references public.guard_profiles(id) on delete restrict,

  -- Nullable: GUARD_NOT_ON_ACTIVE_SHIFT attempts have no active session.
  shift_session_id      uuid references public.shift_sessions(id) on delete restrict,

  -- Nullable: NULL for the opening ENTRY event (session does not yet exist).
  access_session_id     uuid references public.access_sessions(id) on delete restrict,

  -- Retry-safe (§23). Unique per org. Retries find the existing event.
  idempotency_key       text,

  -- Investigation metadata. Never contains the raw PIN or any secret.
  metadata              jsonb not null default '{}'::jsonb,

  -- Immutable — never updated.
  recorded_at           timestamptz not null default now()
);

comment on table public.access_events is
  'Append-only log of every access attempt. Never updated, never deleted.';

comment on column public.access_events.access_session_id is
  'NULL for the opening ENTRY event. Set for EXIT and subsequent events.';

comment on column public.access_events.idempotency_key is
  'Client-supplied retry key. Unique per org. Deduplicates retried requests.';

comment on column public.access_events.metadata is
  'System/error metadata for investigation. Never raw PINs or secrets (§19).';

-- No updated_at trigger — events are immutable.

create index access_events_organization_id on public.access_events(organization_id);
create index access_events_authorization_id on public.access_events(authorization_id)
  where authorization_id is not null;
create index access_events_person_id on public.access_events(person_id)
  where person_id is not null;
create index access_events_gate_id on public.access_events(gate_id);
create index access_events_guard_profile_id on public.access_events(guard_profile_id);
create index access_events_shift_session_id on public.access_events(shift_session_id)
  where shift_session_id is not null;
create index access_events_access_session_id on public.access_events(access_session_id)
  where access_session_id is not null;

-- Fast activity-feed queries: newest first, per org.
create index access_events_org_recorded_at
  on public.access_events(organization_id, recorded_at desc);

-- Fast failure-investigation queries (security reports, §26).
create index access_events_failures
  on public.access_events(organization_id, recorded_at desc)
  where result_code <> 'GRANTED';

-- Idempotency: one event per (org, key). Partial because key may be null.
create unique index access_events_unique_idempotency_key
  on public.access_events(organization_id, idempotency_key)
  where idempotency_key is not null;

-- Cross-link constraint: the access_session referenced by an event, if the
-- event is on the same org, must belong to the same org. Enforced at the
-- application layer for now; noted for future hardening.
-- (Composite FKs on (id, organization_id) deferred — see migration 0009 note.)

-- ----------------------------------------------------------------------------
-- 3. Row Level Security — access_sessions
-- ----------------------------------------------------------------------------

alter table public.access_sessions enable row level security;

create policy access_sessions_select_admin on public.access_sessions
  for select
  using (public.is_org_admin(organization_id));

-- Person involved reads their own sessions (visitor knows when they entered).
create policy access_sessions_select_person on public.access_sessions
  for select
  using (person_id = public.current_person_id(organization_id));

-- Primary Resident reads sessions for authorizations scoped to their unit.
create policy access_sessions_select_primary_resident on public.access_sessions
  for select
  using (
    exists (
      select 1 from public.authorizations a
      where a.id = access_sessions.authorization_id
        and a.scope_unit_id is not null
        and a.scope_unit_id = public.current_occupied_unit_id(access_sessions.organization_id)
    )
  );

-- Guard reads sessions they opened or closed.
create policy access_sessions_select_guard on public.access_sessions
  for select
  using (
    entered_shift_session_id in (
      select id from public.shift_sessions
      where guard_profile_id = public.current_guard_profile_id()
    )
    or exited_shift_session_id in (
      select id from public.shift_sessions
      where guard_profile_id = public.current_guard_profile_id()
    )
  );

-- No INSERT/UPDATE/DELETE policies — session writes happen only via
-- service-role functions (evaluate_entry, evaluate_exit, resolve_session).
-- Guard never writes directly; the Access Service handles it (Phase 7).

-- ----------------------------------------------------------------------------
-- 4. Row Level Security — access_events
-- ----------------------------------------------------------------------------

alter table public.access_events enable row level security;

create policy access_events_select_admin on public.access_events
  for select
  using (public.is_org_admin(organization_id));

create policy access_events_select_person on public.access_events
  for select
  using (person_id = public.current_person_id(organization_id));

create policy access_events_select_primary_resident on public.access_events
  for select
  using (
    authorization_id is not null
    and exists (
      select 1 from public.authorizations a
      where a.id = access_events.authorization_id
        and a.scope_unit_id is not null
        and a.scope_unit_id = public.current_occupied_unit_id(access_events.organization_id)
    )
  );

create policy access_events_select_guard on public.access_events
  for select
  using (guard_profile_id = public.current_guard_profile_id());

-- No INSERT/UPDATE/DELETE policies — events are written only by service-role
-- functions. Append-only, never updated, never deleted.

-- ============================================================================
-- Security note on event mutability:
--   The append-only property is enforced here by the absence of UPDATE and
--   DELETE policies, plus the absence of an updated_at column. Even the
--   service role has no trigger to update events. Any resolution of an
--   unresolved session is recorded on the SESSION (resolution_* fields),
--   never by editing the historical event (§18, §38).
-- ============================================================================
