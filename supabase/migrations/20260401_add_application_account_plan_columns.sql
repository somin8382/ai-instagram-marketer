alter table public.applications
  add column if not exists account_direction text;

alter table public.applications
  add column if not exists account_bio text;

alter table public.applications
  add column if not exists account_concept text;
