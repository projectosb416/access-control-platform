-- ============================================================================
-- Migration 0002: accounts and identity helpers
-- ============================================================================
-- Purpose:
--   Establish the authentication identity layer. One accounts row per human
--   who can log in. Linked 1:1 to Supabase auth.users.
--
--   accounts is NOT the same as people. accounts is the authentication
--   identity; people (migration 0005) is the real-world individual.
--
--   A new accounts row is created automatically when auth.users gains a row.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. accounts table
-- ----------------------------------------------------------------------------

create table public.accounts (
  id             uuid primary key default public.uuidv7(),
  auth_user_id   uuid not null unique references auth.users(id) on delete restrict,
  display_name   text not null,
  status         text not null default 'invited'
                 check (status in (
                   'invited',
                   'pending_activation',
                   'active',
                   'suspended',
                   'deactivated'
                 )),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.accounts is
  'Authentication identities. One row per human who can log in.';

comment on column public.accounts.auth_user_id is
  'Links to Supabase auth.users.id. Never cascade-deleted; accounts are deactivated, not deleted.';

comment on column public.accounts.status is
  'Lifecycle: invited → pending_activation → active → suspended → deactivated.';

-- Keep updated_at authoritative server-side.
create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Trigger: create an accounts row on auth.users insert
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER so it can insert into public.accounts even though the
-- signing-up user has no RLS access yet.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.accounts (auth_user_id, display_name, status)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      split_part(new.email, '@', 1)
    ),
    'pending_activation'
  );
  return new;
end;
$$;

comment on function public.handle_new_auth_user() is
  'Trigger function: creates a public.accounts row on auth.users insert.';

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ----------------------------------------------------------------------------
-- 3. Helper: current_account_id()
-- ----------------------------------------------------------------------------
-- Returns the accounts.id for the caller. Used by RLS policies on every
-- subsequent table. SECURITY DEFINER so it stays correct even if the accounts
-- RLS policy changes in the future.

create or replace function public.current_account_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.accounts where auth_user_id = auth.uid();
$$;

comment on function public.current_account_id() is
  'Returns accounts.id for the currently authenticated user. Core RLS helper.';

-- ----------------------------------------------------------------------------
-- 4. Row Level Security
-- ----------------------------------------------------------------------------

alter table public.accounts enable row level security;

-- Read own row.
create policy accounts_select_self on public.accounts
  for select
  using (auth_user_id = auth.uid());

-- No INSERT policy: rows are created only by the SECURITY DEFINER auth trigger.
-- No UPDATE policy: added later when profile-editing surface is designed.
-- No DELETE policy: accounts are never hard-deleted; deactivate via status.
