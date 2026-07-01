alter table public.profiles
  add column if not exists instagram_url text;

alter table public.profiles
  add column if not exists youtube_url text;

alter table public.profiles
  add column if not exists company_name text;
