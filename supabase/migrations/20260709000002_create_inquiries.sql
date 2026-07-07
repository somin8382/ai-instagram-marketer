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
