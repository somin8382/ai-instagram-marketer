-- Backing store for the anonymous generated-post save rate limit
-- (per-IP rolling 24h + global daily cap).
--
-- /api/generated-posts/save accepts anonymous saves (user_id null) for the
-- free-trial flow, so it takes writes with no credential at all. image_url is
-- capped at 500,000 characters because it may hold a data URL, which made an
-- unauthenticated caller able to insert ~500KB rows without limit.
--
-- One row per accepted anonymous save, keyed by a hashed client IP (no raw IP
-- / PII stored). Same shape and privacy model as
-- application_submission_usage; service-role only.
create extension if not exists pgcrypto;

create table if not exists public.generated_post_save_usage (
  id       uuid        primary key default gen_random_uuid(),
  ip_hash  text        not null,
  used_at  timestamptz not null default timezone('utc', now())
);

create index if not exists generated_post_save_usage_ip_hash_used_at_idx
  on public.generated_post_save_usage (ip_hash, used_at);

create index if not exists generated_post_save_usage_used_at_idx
  on public.generated_post_save_usage (used_at);

alter table public.generated_post_save_usage enable row level security;
-- No policies: only the service role (which bypasses RLS) may read/write.
