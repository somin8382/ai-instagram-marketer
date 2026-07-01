alter table public.applications
  add column if not exists marketing_channel text;

alter table public.applications
  add column if not exists channel_url text;

alter table public.applications
  add column if not exists main_content_url text;
