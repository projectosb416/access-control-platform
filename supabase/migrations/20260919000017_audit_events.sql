-- ============================================================================
-- Migration 0017: audit_events
-- ============================================================================
-- Purpose:
--   Append-oriented record of sensitive platform/admin/governance actions
--   (handoff §3, §22). Distinct from access_events:
--
--     access_events  = physical access attempts (Person → Credential → Gate)
--     audit_events   = governance actions (who did what, to what, why)
--
--   Append-only: no UPDATE, no DELETE. Every sensitive action is recorded
--   once and never rewritten (§38).
--
-- Tenant scope — deliberate refinement of Phase 4 matrix:
--   The matrix placed audit events under "inherited scope via actor's org."
--   That breaks when a platform admin acts on a customer without having a
--   membership there. This schema carries organization_id directly:
--
--     organization_id = the org AFFECTED by the action (nullable)
--     actor_account_id = who performed the action
--
--   Truly platform-level actions (granting a platform admin, editing Plan
--   catalog) have organization_id = NULL.
-- ============================================================================


create table public.audit_events (
  id                 uuid primary key default public.uuidv7(),

  -- The org affected by this action. NULL for platform-level actions.
  organization_id    uuid references public.organizations(id) on delete restrict,

  -- Who performed the action. NULL for system-triggered actions.
  actor_account_id   uuid references public.accounts(id) on delete set null,

  -- What happened. Namespaced by domain so queries can filter by prefix.
  -- Examples: 'organization.created', 'authorization.revoked',
  --           'platform_admin.granted', 'occupancy.ended'.
  action             text not null,

  -- What entity was acted on.
  target_type        text not null,
  target_id          uuid,

  -- Why — required for sensitive actions, optional for routine ones.
  reason             text,

  -- Structured context. Never contains secrets (§31 logging rule).
  metadata           jsonb not null default '{}'::jsonb,

  -- Immutable. No updated_at.
  recorded_at        timestamptz not null default now(),

  constraint audit_events_action_not_blank
    check (length(btrim(action)) > 0),

  constraint audit_events_target_type_not_blank
    check (length(btrim(target_type)) > 0)
);

comment on table public.audit_events is
  'Append-only governance audit log. Never updated, never deleted.';

comment on column public.audit_events.organization_id is
  'Org affected by the action. NULL for platform-level actions.';

comment on column public.audit_events.actor_account_id is
  'Who performed the action. NULL for system-triggered actions.';

comment on column public.audit_events.action is
  'Namespaced action code, e.g. "authorization.revoked". Stable — not reworded over time.';

comment on column public.audit_events.metadata is
  'Structured context for investigation. Never raw secrets or PINs.';

-- No updated_at trigger — events are immutable.

-- Fast "what happened in this org, newest first".
create index audit_events_org_recorded_at
  on public.audit_events(organization_id, recorded_at desc)
  where organization_id is not null;

-- Fast "what did this account do".
create index audit_events_actor_recorded_at
  on public.audit_events(actor_account_id, recorded_at desc)
  where actor_account_id is not null;

-- Fast "history of this entity" (e.g., all audit rows for authorization X).
create index audit_events_target
  on public.audit_events(target_type, target_id, recorded_at desc)
  where target_id is not null;

-- Fast filter by action type.
create index audit_events_action_recorded_at
  on public.audit_events(action, recorded_at desc);

-- Platform-level events (organization_id is null) — for platform admin views.
create index audit_events_platform_recorded_at
  on public.audit_events(recorded_at desc)
  where organization_id is null;


-- ----------------------------------------------------------------------------
-- Helper: log_audit_event
-- ----------------------------------------------------------------------------
-- Same shape as log_access_event — reduces repetition, generates id
-- internally, keeps events append-only.

create or replace function public.log_audit_event(
  p_organization_id  uuid,
  p_actor_account_id uuid,
  p_action           text,
  p_target_type      text,
  p_target_id        uuid,
  p_reason           text default null,
  p_metadata         jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  v_id := public.uuidv7();

  insert into public.audit_events (
    id, organization_id, actor_account_id,
    action, target_type, target_id, reason, metadata
  ) values (
    v_id, p_organization_id, p_actor_account_id,
    p_action, p_target_type, p_target_id, p_reason,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return v_id;
end;
$$;

comment on function public.log_audit_event(
  uuid, uuid, text, text, uuid, text, jsonb
) is
  'Internal helper: writes one audit event with a fresh uuidv7 id. Returns the new id.';


-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------

alter table public.audit_events enable row level security;

-- Org admins read their own org's audit history.
create policy audit_events_select_org_admin on public.audit_events
  for select
  using (
    organization_id is not null
    and public.is_org_admin(organization_id)
  );

-- Platform admins read everything, including platform-level events
-- (organization_id is null).
create policy audit_events_select_platform_admin on public.audit_events
  for select
  using (public.is_platform_admin());

-- No INSERT policy — events are written only by service-role code and by
-- SECURITY DEFINER helpers (log_audit_event).
-- No UPDATE policy — immutable.
-- No DELETE policy — immutable.
