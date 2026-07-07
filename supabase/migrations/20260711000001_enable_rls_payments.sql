-- Enable RLS on payments (depositor names, amounts, account references).
-- Client-side access is read-only and always for the user's OWN application
-- (payment-status check before subscription start + mypage snapshot), so
-- SELECT is scoped via ownership of the parent application. All writes go
-- through the service role (/api/applications/submit, admin), which bypasses
-- RLS — no INSERT/UPDATE policies on purpose.
alter table public.payments enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payments'
      and policyname = 'payments_select_own_application'
  ) then
    create policy "payments_select_own_application" on public.payments
      for select to authenticated
      using (
        exists (
          select 1 from public.applications a
          where a.id = payments.application_id
            and (
              a.user_id = auth.uid()
              or (a.user_id is null and lower(a.email) = lower(auth.email()))
            )
        )
      );
  end if;
end $$;
