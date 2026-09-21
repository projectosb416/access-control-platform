-- ============================================================================
-- Migration 0016: alerts + FK from notifications
-- ============================================================================
-- Purpose:
--   Actionable operational/security conditions requiring investigation,
--   acknowledgement, or resolution (handoff §24).
--
--   Distinct from notifications:
--     - Notification = "here is something you should know"
--     - Alert        = "here is something you must act on"
--
--   Lifecycle (handoff §22): OPEN → ACKNOWLEDGED → RESOLVED;
--   optional DISMISSED.
--
--   Also: closes the loop on notifications.alert_id, which was left as a
--   bare uuid in migration 0015 because alerts didn't exist yet.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. alerts
-- ----------------------------------------------------------------------------

create table public.alerts (
  id                  uuid primary key default public.uuidv7(),
  organization_id     uuid not null references public.organizations(id) on delete restrict,

  category            text not null
                      check (category in (
                        'access','security','operations','system','billing'
                      )),
  severity            text not null default 'attention'
                      check (severity in ('information','attention','high')),

  title               text not null,
  body                text,

  -- Optional context — what triggered this alert.
  access_event_id     uuid references public.access_events(id) on delete restrict,
  authorization_id    uuid references public.authorizations(id) on delete restrict,
  access_session_id   uuid references public.access_sessions(id) on delete restrict,
  gate_id             uuid references public.gates(id) on delete restrict,
  guard_profile_id    uuid references public.guard_profiles(id) on delete restrict,

  -- Burst grouping: repeated identical alerts collapse in the UI but every
  -- underlying row persists (§24).
  group_key           text,

  status              text not null default 'open'
                      check (status in ('open','acknowledged','resolved','dismissed')),

  acknowledged_at     timestamptz,
  acknowledged_by     uuid references public.accounts(id) on delete set null,

  resolved_at         timestamptz,
  resolved_by         uuid references public.accounts(id) on delete set null,
  resolution_notes    text,

  dismissed_at        timestamptz,
  dismissed_by        uuid references public.accounts(id) on delete set null,
  dismiss_reason      text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint alerts_title_not_blank check (length(btrim(title)) > 0),

  constraint alerts_ack_consistency
    check ((acknowledged_at is not null) = (acknowledged_by is not null)),

  constraint alerts_resolved_consistency
    check ((resolved_at is not null) = (resolved_by is not null)),

  constraint alerts_dismissed_consistency
    check ((dismissed_at is not null) = (dismissed_by is not null)),

  -- A resolved alert must carry its acknowledgement trail.
  constraint alerts_resolved_implies_acknowledged
    check (
      status <> 'resolved'
      or (acknowledged_at is not null and resolved_at is not null)
    ),

  -- Dismissal requires a reason — dismissing without one hides information.
  constraint alerts_dismissed_requires_reason
    check (status <> 'dismissed' or dismiss_reason is not null)
);

comment on table public.alerts is
  'Actionable operational/security conditions. Distinct from notifications.';

comment on column public.alerts.group_key is
  'Optional grouping key for burst collapsing. Underlying rows are never merged.';

comment on column public.alerts.dismiss_reason is
  'Required when dismissed — dismissing an alert is a decision that must be explained.';

create trigger alerts_set_updated_at
  before update on public.alerts
  for each row execute function public.set_updated_at();

-- Fast "everything open for this org" — the Attention Center (§25).
create index alerts_org_status
  on public.alerts(organization_id, status, created_at desc);

-- Fast "open alerts for my org".
create index alerts_org_open
  on public.alerts(organization_id, created_at desc)
  where status = 'open';

-- Fast drill-downs from events and sessions.
create index alerts_access_event_id
  on public.alerts(access_event_id)
  where access_event_id is not null;
create index alerts_access_session_id
  on public.alerts(access_session_id)
  where access_session_id is not null;
create index alerts_guard_profile_id
  on public.alerts(guard_profile_id)
  where guard_profile_id is not null;

-- Fast group collapsing.
create index alerts_group_key
  on public.alerts(organization_id, group_key, created_at desc)
  where group_key is not null;


-- ----------------------------------------------------------------------------
-- 2. Close the loop: FK from notifications.alert_id
-- ----------------------------------------------------------------------------

alter table public.notifications
  add constraint notifications_alert_id_fkey
    foreign key (alert_id) references public.alerts(id) on delete restrict;

comment on column public.notifications.alert_id is
  'Optional link to the alert this notification is about.';


-- ----------------------------------------------------------------------------
-- 3. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.alerts enable row level security;

-- Admins see all alerts in their org.
create policy alerts_select_admin on public.alerts
  for select
  using (public.is_org_admin(organization_id));

-- Guards see alerts they are personally implicated in (e.g., operational
-- anomalies about their shift). This keeps a guard aware of issues that
-- touch their own work without exposing the whole org's alert stream.
create policy alerts_select_guard_own on public.alerts
  for select
  using (guard_profile_id = public.current_guard_profile_id());

-- Admins acknowledge, resolve, dismiss.
create policy alerts_update_admin on public.alerts
  for update
  using (public.is_org_admin(organization_id))
  with check (public.is_org_admin(organization_id));

-- No INSERT policy — alerts are created only by service-role code (the
-- Alerting Service, deriving conditions from domain events).
-- No DELETE policy — alerts persist for audit, even after resolution.
