-- ─────────────────────────────────────────────────────────────────────────────
-- PENDING MIGRATIONS BUNDLE — paste this whole file into the Supabase SQL
-- editor and run once. All statements are idempotent (safe to re-run).
-- Covers: login_events, credit_grants, generation_logs, inquiries,
--         profiles.generation_prefs
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 20260708000000_create_login_events.sql ──
-- Complete login/visit history per user (admin support tooling).
-- 'login' = credential sign-in via /auth; 'visit' = returning browser session
-- with a persisted Supabase session (deduped per browser session client-side).
create table if not exists public.login_events (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  email       text,
  event_type  text        not null default 'login'
              check (event_type in ('login', 'visit')),
  occurred_at timestamptz not null default timezone('utc', now())
);

create index if not exists login_events_user_id_occurred_at_idx
  on public.login_events (user_id, occurred_at desc);

create index if not exists login_events_occurred_at_idx
  on public.login_events (occurred_at desc);

alter table public.login_events enable row level security;

-- Users may record their own events; only the service role reads them.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'login_events'
      and policyname = 'login_events_insert_own'
  ) then
    create policy "login_events_insert_own" on public.login_events
      for insert
      to authenticated
      with check (auth.uid() = user_id);
  end if;
end $$;

-- ── 20260709000000_create_credit_grants.sql ──
-- Admin-issued bonus generation credits with a user-facing one-time popup.
create table if not exists public.credit_grants (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  email        text,
  amount       integer     not null check (amount > 0),
  reason       text,        -- admin-only note
  message      text,        -- shown to the user in the popup
  granted_by   text,        -- admin email
  created_at   timestamptz not null default timezone('utc', now()),
  confirmed    boolean     not null default false,
  confirmed_at timestamptz
);

create index if not exists credit_grants_user_id_idx
  on public.credit_grants (user_id, created_at desc);

alter table public.credit_grants enable row level security;

-- Users can read their own grants (popup) and mark them confirmed.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'credit_grants'
      and policyname = 'credit_grants_select_own'
  ) then
    create policy "credit_grants_select_own" on public.credit_grants
      for select to authenticated
      using (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'credit_grants'
      and policyname = 'credit_grants_update_own'
  ) then
    create policy "credit_grants_update_own" on public.credit_grants
      for update to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

-- ── 20260709000001_create_generation_logs.sql ──
-- Every AI generation attempt (success and failure), for admin support.
-- Written server-side (service role) from /api/ai; no user policies.
create table if not exists public.generation_logs (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        references auth.users(id) on delete set null,
  usage_mode  text        not null default 'free_trial',
  outcome     text        not null,
  duration_ms integer,
  user_prompt text,
  image_count integer     not null default 0,
  image_model text,
  text_model  text,
  created_at  timestamptz not null default timezone('utc', now())
);

create index if not exists generation_logs_user_id_idx
  on public.generation_logs (user_id, created_at desc);

create index if not exists generation_logs_created_at_idx
  on public.generation_logs (created_at desc);

alter table public.generation_logs enable row level security;
-- service-role only: no policies

-- ── 20260709000002_create_inquiries.sql ──
-- User inquiries / error reports with admin replies.
create table if not exists public.inquiries (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  email         text,
  message       text        not null,
  page_path     text,
  status        text        not null default 'open'
                check (status in ('open', 'answered')),
  admin_reply   text,
  replied_by    text,
  replied_at    timestamptz,
  reply_read_at timestamptz,
  created_at    timestamptz not null default timezone('utc', now())
);

create index if not exists inquiries_user_id_idx
  on public.inquiries (user_id, created_at desc);

create index if not exists inquiries_status_idx
  on public.inquiries (status, created_at desc);

alter table public.inquiries enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'inquiries'
      and policyname = 'inquiries_insert_own'
  ) then
    create policy "inquiries_insert_own" on public.inquiries
      for insert to authenticated
      with check (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'inquiries'
      and policyname = 'inquiries_select_own'
  ) then
    create policy "inquiries_select_own" on public.inquiries
      for select to authenticated
      using (auth.uid() = user_id);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'inquiries'
      and policyname = 'inquiries_update_own'
  ) then
    create policy "inquiries_update_own" on public.inquiries
      for update to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

-- ── 20260710000000_add_profile_generation_prefs.sql ──
-- Per-user saved generation preferences (tone / emoji / image style).
-- Written by the user from the tools page; read back on next visit so the
-- brand voice stays consistent across generations and devices.
alter table public.profiles
  add column if not exists generation_prefs jsonb;

