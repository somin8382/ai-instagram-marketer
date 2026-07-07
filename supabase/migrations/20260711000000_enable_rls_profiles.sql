-- Enable RLS on profiles (PII: emails, names, URLs, brand data).
-- All client access is owner-scoped: reads eq(id, auth.uid()), writes upsert
-- with id = session user id and no RETURNING. service_role bypasses RLS
-- (admin list/detail/search routes unaffected).
alter table public.profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_select_own'
  ) then
    create policy "profiles_select_own" on public.profiles
      for select to authenticated
      using (auth.uid() = id);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_insert_own'
  ) then
    create policy "profiles_insert_own" on public.profiles
      for insert to authenticated
      with check (auth.uid() = id);
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_update_own'
  ) then
    create policy "profiles_update_own" on public.profiles
      for update to authenticated
      using (auth.uid() = id)
      with check (auth.uid() = id);
  end if;
end $$;
