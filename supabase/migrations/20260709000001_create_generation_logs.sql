-- Every AI generation attempt (success and failure), for admin support.
-- Written server-side (service role) from /api/ai; no user policies.
create table if not exists public.generation_logs (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        references auth.users(id) on delete set null,
  usage_mode  text        not null default 'free_trial',
  outcome     text        not null,
  duration_ms integer,
  user_prompt text,
  image_count integer     not null default 0,
  image_model text,
  text_model  text,
  created_at  timestamptz not null default timezone('utc', now())
);

create index if not exists generation_logs_user_id_idx
  on public.generation_logs (user_id, created_at desc);

create index if not exists generation_logs_created_at_idx
  on public.generation_logs (created_at desc);

alter table public.generation_logs enable row level security;
-- service-role only: no policies
