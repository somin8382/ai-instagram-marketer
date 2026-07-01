alter table public.generated_posts
  add column if not exists overlay_text text;

alter table public.generated_posts
  add column if not exists overlay_style jsonb;

alter table public.generated_posts
  add column if not exists overlay_enabled boolean;

alter table public.generated_posts
  add column if not exists visual_prompt text;
