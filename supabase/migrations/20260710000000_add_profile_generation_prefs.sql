-- Per-user saved generation preferences (tone / emoji / image style).
-- Written by the user from the tools page; read back on next visit so the
-- brand voice stays consistent across generations and devices.
alter table public.profiles
  add column if not exists generation_prefs jsonb;
