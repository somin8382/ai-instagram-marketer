-- Backing store for the anonymous application-submission rate limit
-- (per-IP rolling 24h + global daily cap). One row per accepted submission,
-- keyed by a hashed client IP (no raw IP / PII stored). Same shape and
-- privacy model as anonymous_free_trial_usage; service-role only.
create extension if not exists pgcrypto;

create table if not exists public.application_submission_usage (
  id       uuid        primary key default gen_random_uuid(),
  ip_hash  text        not null,
  used_at  timestamptz not null default timezone('utc', now())
);

create index if not exists application_submission_usage_ip_hash_used_at_idx
  on public.application_submission_usage (ip_hash, used_at);

create index if not exists application_submission_usage_used_at_idx
  on public.application_submission_usage (used_at);

alter table public.application_submission_usage enable row level security;
-- No policies: only the service role (which bypasses RLS) may read/write.
