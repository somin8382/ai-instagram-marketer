-- 8월 마케팅 진행 확인(유지/변경) 선택 기록. 유저가 본인 선택을 직접 기록하므로 RLS 허용.
create table if not exists public.marketing_confirmations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  email      text,
  month      text not null,               -- 예: '2026-08'
  choice     text not null check (choice in ('keep', 'change')),
  created_at timestamptz not null default now(),
  unique (user_id, month)
);

alter table public.marketing_confirmations enable row level security;

-- 본인 것만 조회/기록 가능 (관리자 API는 service_role로 RLS 우회)
drop policy if exists marketing_confirmations_own_select on public.marketing_confirmations;
create policy marketing_confirmations_own_select
  on public.marketing_confirmations for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists marketing_confirmations_own_insert on public.marketing_confirmations;
create policy marketing_confirmations_own_insert
  on public.marketing_confirmations for insert to authenticated
  with check (auth.uid() = user_id);
