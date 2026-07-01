alter table public.profiles
  add column if not exists brand_name text;

alter table public.profiles
  add column if not exists marketing_channel text;

alter table public.profiles
  add column if not exists industry text;

alter table public.profiles
  add column if not exists product_service text;

alter table public.profiles
  add column if not exists account_onboarded_at timestamptz;
