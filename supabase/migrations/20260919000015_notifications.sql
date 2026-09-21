-- ============================================================================
-- Migration 0015: notifications
-- ============================================================================
-- Purpose:
--   Targeted events a user should see (handoff §24). Distinct from the Live
--   Activity Feed (which is derived directly from access_events) and from
--   Alerts (actionable, migration 0016).
--
-- Design notes:
--   - Channel-agnostic. In-app is the only channel now; delivery-channel
--     tracking gets added when email/SMS/push exist.
--   - Sound and visual differentiation are DERIVED, not stored:
--       priority           → sound class (info / attention / high)
--       category           → visual class (access / security / ops / system / billing)
--       linked event's result_code → specific state (used, revoked, expired, etc.)
--     This means changing a sound is a client change, never a migration.
--   - Every notification may reference the underlying access_event. The
--     notification is a read-model convenience; the event remains the truth
--     (handoff §24: "Notification failure never erases the underlying event").
--   - group_key allows grouping bursts while retaining every underlying
--     notification row (§24).
--   - suppressible = false on security-critical notifications (§24).
-- ============================================================================


create table public.notifications (
  id                   uuid primary key default public.uuidv7(),
  organization_id      uuid not null references public.organizations(id) on delete restrict,

  -- Who should see this. recipient_account_id is required — only accounts
  -- (users who can log in) receive in-app notifications.
  recipient_account_id uuid not null references public.accounts(id) on delete restrict,

  category             text not null
                       check (category in (
                         'access','security','operations','system','billing'
                       )),
  priority             text not null default 'information'
                       check (priority in ('information','attention','high')),

  title                text not null,
  body                 text,

  -- Optional link to the underlying access event. When present, the client
  -- reads access_events.result_code for the specific state (used, revoked,
  -- expired, granted, etc.) and renders accordingly.
  access_event_id      uuid references public.access_events(id) on delete restrict,

  -- Optional references to other relevant entities, for deep-linking.
  authorization_id     uuid references public.authorizations(id) on delete restrict,
  person_id            uuid references public.people(id) on delete restrict,
  gate_id              uuid references public.gates(id) on delete restrict,
  alert_id             uuid,     -- FK to alerts added in migration 0016

  -- Grouping for burst suppression (§24). All notifications with the same
  -- group_key in the same window can be collapsed in the UI.
  group_key            text,

  -- Security-critical notifications cannot be suppressed (§24).
  suppressible         boolean not null default true,

  -- Read state is presentation-only. The notification exists regardless.
  read_at              timestamptz,

  -- Delivery state. Channel-agnostic for now — "in_app" is implied by the
  -- fact that only in-app delivery exists. When more channels are added,
  -- this becomes a related table, not a column.
  created_at           timestamptz not null default now(),

  constraint notifications_title_not_blank check (length(btrim(title)) > 0),
  constraint notifications_security_not_suppressible
    check (not (category = 'security' and suppressible = true))
);

comment on table public.notifications is
  'Targeted in-app notifications. Read/unread is presentation state.';

comment on column public.notifications.priority is
  'Drives sound class in the client: information / attention / high.';

comment on column public.notifications.access_event_id is
  'Underlying event. Client reads its result_code for specific state rendering.';

comment on column public.notifications.group_key is
  'Optional grouping key for burst collapsing in the UI (§24). Underlying rows are never merged.';

comment on column public.notifications.suppressible is
  'False for security-category notifications — they cannot be muted (§24).';

-- Fast "my notifications, newest first".
create index notifications_recipient_created
  on public.notifications(recipient_account_id, created_at desc);

-- Fast "my unread notifications".
create index notifications_recipient_unread
  on public.notifications(recipient_account_id, created_at desc)
  where read_at is null;

-- Fast "everything for this event" (drill-down from activity feed).
create index notifications_access_event_id
  on public.notifications(access_event_id)
  where access_event_id is not null;

-- Fast org-wide dashboards (admin view).
create index notifications_organization_created
  on public.notifications(organization_id, created_at desc);

-- Fast group collapsing.
create index notifications_group_key
  on public.notifications(organization_id, group_key, created_at desc)
  where group_key is not null;


-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------

alter table public.notifications enable row level security;

-- A user reads only their own notifications.
create policy notifications_select_self on public.notifications
  for select
  using (recipient_account_id = public.current_account_id());

-- Org admins can read all notifications in their org (for support and
-- oversight of what their staff and residents are being told).
create policy notifications_select_admin on public.notifications
  for select
  using (public.is_org_admin(organization_id));

-- A user can mark their own notifications as read (UPDATE on read_at only —
-- enforced at the application layer; no column-level RLS in Postgres).
-- Suppressible security notifications: the application layer must refuse
-- to update them if the underlying semantics require, but read_at changes
-- are still allowed (marking as read is not the same as suppressing).
create policy notifications_update_self_read on public.notifications
  for update
  using (recipient_account_id = public.current_account_id())
  with check (recipient_account_id = public.current_account_id());

-- No INSERT policy — notifications are created only by service-role code
-- (the Notification Service, listening to domain events).
-- No DELETE policy — notifications persist for audit.
