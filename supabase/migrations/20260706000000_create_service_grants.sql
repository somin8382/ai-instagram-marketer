create extension if not exists pgcrypto;

create table if not exists public.service_grants (
  id                uuid        primary key default gen_random_uuid(),
  email             text        not null,
  applicant_name    text,
  phone             text,
  host_org          text,
  mentor_org        text,
  ai_marketer       boolean     not null default false,
  ai_generator      boolean     not null default false,
  marketer_quantity integer,
  marketer_months   text,
  generator_months  text,
  generator_credits integer     not null default 40,
  status            text        not null default 'pending'
                    check (status in ('pending', 'applied', 'revoked')),
  applied_user_id   uuid        references auth.users(id) on delete set null,
  created_at        timestamptz not null default timezone('utc', now()),
  applied_at        timestamptz
);

create unique index if not exists service_grants_email_lower_idx
  on public.service_grants (lower(email));

alter table public.service_grants enable row level security;

-- Only the matching user can read their own grant row
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'service_grants'
      and policyname = 'service_grants_select_own'
  ) then
    create policy "service_grants_select_own" on public.service_grants
      for select
      to authenticated
      using (lower(email) = lower(auth.email()));
  end if;
end $$;

-- Only the matching user can update their own grant row (for redeem)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'service_grants'
      and policyname = 'service_grants_update_own'
  ) then
    create policy "service_grants_update_own" on public.service_grants
      for update
      to authenticated
      using  (lower(email) = lower(auth.email()))
      with check (lower(email) = lower(auth.email()));
  end if;
end $$;
