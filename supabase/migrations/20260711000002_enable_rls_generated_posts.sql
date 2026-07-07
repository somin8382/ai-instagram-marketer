-- Enable RLS on generated_posts (user content).
-- Deploy AFTER the server save endpoint (/api/generated-posts/save) is live:
-- all inserts (incl. anonymous free-trial saves) go through the service role,
-- so no INSERT policy exists. Reads are owner-scoped directly (user_id) or
-- via ownership of the parent application (pre-signup saves read back after
-- login through the user's own applications).
alter table public.generated_posts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'generated_posts'
      and policyname = 'generated_posts_select_own'
  ) then
    create policy "generated_posts_select_own" on public.generated_posts
      for select to authenticated
      using (
        user_id = auth.uid()
        or exists (
          select 1 from public.applications a
          where a.id = generated_posts.application_id
            and (
              a.user_id = auth.uid()
              or (a.user_id is null and lower(a.email) = lower(auth.email()))
            )
        )
      );
  end if;
end $$;
