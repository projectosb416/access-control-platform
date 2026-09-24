-- ============================================================================
-- Migration 0033: subscription expiry check
-- ============================================================================
-- Purpose:
--   Daily job that (a) sends renewal reminders during the final 30 days of
--   an active subscription, and (b) transitions lapsed subscriptions to
--   'expired'.
--
-- Reminder cadence — 7 touchpoints during the final month:
--   30, 23, 16, 9, 5, 3, 1 days before current_period_end
--   Frequency increases as expiry nears.
--
-- No grace period. The subscription is fully active through its paid period.
-- On the day current_period_end passes, status flips to 'expired' and the
-- subscription lock (migration 0022) fires on the next INSERT attempt.
--
-- Design notes:
--   - Idempotent. A reminder is sent at most once per (subscription, threshold)
--     enforced by a unique key. Expiry only fires on 'active' rows, so a
--     second run is a no-op.
--   - Reminders use "crossing" semantics, not exact-day matching. If the job
--     is down for a day, the reminder fires the next run — copy uses the
--     actual expiry date, so it remains accurate.
--   - Only the smallest unsent threshold fires per run. If the job was down
--     for two weeks, one relevant reminder fires, not three.
--   - The states 'past_due' and 'grace_period' remain defined in the
--     subscriptions CHECK constraint but are not used by this flow. They are
--     reserved for future scenarios (payment processor outages, enterprise
--     negotiation) that don't warrant a schema change today.
--   - Trials are NOT handled by this function. Trial expiry uses
--     trial_ends_at, which is a separate concern.
--
-- Caller: a Cloudflare Cron Worker (migration 0034) running daily. Also
-- callable manually via Supabase SQL Editor for testing.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. subscription_reminders — idempotency tracking
-- ----------------------------------------------------------------------------
-- One row per (subscription, threshold) that has been sent. The unique key
-- enforces the "at most once" guarantee without the function needing to
-- check-and-lock explicitly.

create table public.subscription_reminders (
  id                    uuid primary key default public.uuidv7(),
  subscription_id       uuid not null references public.subscriptions(id) on delete restrict,
  reminder_days_before  int not null
                        check (reminder_days_before in (30, 23, 16, 9, 5, 3, 1)),
  sent_at               timestamptz not null default now(),

  constraint subscription_reminders_unique
    unique (subscription_id, reminder_days_before)
);

comment on table public.subscription_reminders is
  'Idempotency tracking for subscription renewal reminders. One row per threshold sent.';

create index subscription_reminders_subscription_id
  on public.subscription_reminders(subscription_id);

alter table public.subscription_reminders enable row level security;
-- No policies. Service-role only via SECURITY DEFINER function.


-- ----------------------------------------------------------------------------
-- 2. run_subscription_expiry_check — daily job
-- ----------------------------------------------------------------------------

create or replace function public.run_subscription_expiry_check()
returns table (
  reminders_sent        int,
  subscriptions_expired int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reminders_sent int := 0;
  v_expired_count  int := 0;

  v_sub            record;
  v_admin          record;

  v_days_remaining int;
  v_reminder_day   int;
  v_expiry_date    text;
  v_priority       text;
begin
  -- ==========================================================================
  -- Phase 1: Send reminders for active subscriptions within 30 days of expiry
  -- ==========================================================================
  for v_sub in
    select s.id,
           s.organization_id,
           s.current_period_end,
           o.display_name as org_name
      from public.subscriptions s
      join public.organizations o on o.id = s.organization_id
     where s.status = 'active'
       and s.current_period_end > now()
       and s.current_period_end <= now() + interval '30 days'
  loop
    v_days_remaining := floor(
      extract(epoch from (v_sub.current_period_end - now())) / 86400
    )::int;

    -- Windowed match: each threshold owns a window (next_lower, threshold].
    -- A reminder fires at most once, in correct order, and stays correct if
    -- the cron job misses a day. Guarantees no descending reminders.
    select t.threshold into v_reminder_day
      from (values
        (30, 23),
        (23, 16),
        (16, 9),
        (9, 5),
        (5, 3),
        (3, 1),
        (1, 0)
      ) as t(threshold, lower_bound)
     where v_days_remaining > t.lower_bound
       and v_days_remaining <= t.threshold
       and not exists (
         select 1 from public.subscription_reminders sr
          where sr.subscription_id = v_sub.id
            and sr.reminder_days_before = t.threshold
       )
     limit 1;

    if v_reminder_day is null then
      continue;   -- nothing to send this run
    end if;

    -- Idempotency guard: insert tracking row. If a concurrent run
    -- already inserted, the unique constraint raises — but that is
    -- impossible inside this serial loop for the same subscription.
    insert into public.subscription_reminders (subscription_id, reminder_days_before)
    values (v_sub.id, v_reminder_day);

    -- Priority escalates as expiry nears.
    v_priority := case
      when v_reminder_day <= 3 then 'high'
      when v_reminder_day <= 9 then 'attention'
      else 'information'
    end;

    v_expiry_date := to_char(v_sub.current_period_end, 'FMDD Mon YYYY');

    -- Notify every active admin of the org.
    for v_admin in
      select account_id
        from public.organization_memberships
       where organization_id = v_sub.organization_id
         and role = 'admin'
         and status = 'active'
    loop
      insert into public.notifications (
        organization_id, recipient_account_id,
        category, priority, title, body
      ) values (
        v_sub.organization_id,
        v_admin.account_id,
        'billing',
        v_priority,
        'Subscription renewal reminder',
        'Your subscription for ' || v_sub.org_name
          || ' expires on ' || v_expiry_date
          || '. Renew to keep gate operations running.'
      );
    end loop;

    v_reminders_sent := v_reminders_sent + 1;
  end loop;

  -- ==========================================================================
  -- Phase 2: Expire subscriptions whose period has ended
  -- ==========================================================================
  for v_sub in
    select s.id,
           s.organization_id,
           s.current_period_end,
           o.display_name as org_name
      from public.subscriptions s
      join public.organizations o on o.id = s.organization_id
     where s.status = 'active'
       and s.current_period_end <= now()
  loop
    -- State transition.
    update public.subscriptions
       set status = 'expired'
     where id = v_sub.id;

    -- Audit — system-triggered, no actor.
    perform public.log_audit_event(
      v_sub.organization_id,
      null,
      'subscription.expired',
      'subscription',
      v_sub.id,
      null,
      jsonb_build_object(
        'current_period_end', v_sub.current_period_end
      )
    );

    -- Notify admins.
    for v_admin in
      select account_id
        from public.organization_memberships
       where organization_id = v_sub.organization_id
         and role = 'admin'
         and status = 'active'
    loop
      insert into public.notifications (
        organization_id, recipient_account_id,
        category, priority, title, body
      ) values (
        v_sub.organization_id,
        v_admin.account_id,
        'billing',
        'high',
        'Subscription expired',
        'Your subscription for ' || v_sub.org_name
          || ' has expired. Gate operations are now restricted. Renew to restore access.'
      );
    end loop;

    v_expired_count := v_expired_count + 1;
  end loop;

  return query select v_reminders_sent, v_expired_count;
end;
$$;

comment on function public.run_subscription_expiry_check() is
  'Daily job: sends renewal reminders in the final 30 days, expires lapsed subscriptions. Idempotent. Called by the subscription-cron Worker.';
