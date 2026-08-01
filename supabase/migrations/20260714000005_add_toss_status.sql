-- 유저별 '토스' 진행 상태. 기본 'wait'(대기), 'in_progress'(진행중)로 전환.
alter table public.admin_user_notes
  add column if not exists toss_status text not null default 'wait';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'admin_user_notes_toss_status_check'
  ) then
    alter table public.admin_user_notes
      add constraint admin_user_notes_toss_status_check
      check (toss_status in ('wait', 'in_progress'));
  end if;
end $$;
