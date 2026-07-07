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
