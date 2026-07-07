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
