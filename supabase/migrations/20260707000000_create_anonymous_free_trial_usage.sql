create extension if not exists pgcrypto;

-- Backing store for the anonymous (no-account) free-trial rate limit.
-- One row is inserted per consumed free-trial generation, keyed by a hashed
-- client IP so no raw IP (PII) is ever stored.
create table if not exists public.anonymous_free_trial_usage (
  id       uuid        primary key default gen_random_uuid(),
  ip_hash  text        not null,
  used_at  timestamptz not null default timezone('utc', now())
);

create index if not exists anonymous_free_trial_usage_ip_hash_used_at_idx
  on public.anonymous_free_trial_usage (ip_hash, used_at);

-- Enable RLS with NO policies so the anon/authenticated clients that ship to the
-- browser can neither read nor write this table. Only the server-side service
-- role (which bypasses RLS) may access it, via /api/ai.
alter table public.anonymous_free_trial_usage enable row level security;
