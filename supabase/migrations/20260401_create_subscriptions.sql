create extension if not exists pgcrypto;

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_type text not null,
  start_date date not null,
  end_date date not null,
  remaining_credits integer not null default 0,
  daily_usage_count integer not null default 0,
  last_usage_date date,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint subscriptions_plan_type_check
    check (plan_type in ('post_generator')),
  constraint subscriptions_remaining_credits_check
    check (remaining_credits >= 0),
  constraint subscriptions_daily_usage_count_check
    check (daily_usage_count >= 0),
  constraint subscriptions_user_plan_unique
    unique (user_id, plan_type)
);

create index if not exists subscriptions_user_id_idx
  on public.subscriptions (user_id);

create index if not exists subscriptions_plan_type_idx
  on public.subscriptions (plan_type);

create or replace function public.set_subscriptions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;

create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row
execute function public.set_subscriptions_updated_at();

alter table public.subscriptions enable row level security;

create policy "subscriptions_select_own"
on public.subscriptions
for select
to authenticated
using (auth.uid() = user_id);

create policy "subscriptions_insert_own"
on public.subscriptions
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "subscriptions_update_own"
on public.subscriptions
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
