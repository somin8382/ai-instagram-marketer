-- 월별 마케터 채널/메인 게시물 정보 (예: 8월 정보 변경). 기존 신청서(applications,
-- 7월 정보)와 별개로 월 단위 저장. 유저가 직접 입력하므로 RLS 허용.
create table if not exists public.monthly_channel_info (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  email             text,
  month             text not null,              -- 예: '2026-08'
  marketing_channel text,                        -- 'instagram' | 'youtube'
  channel_url       text,
  instagram_id      text,
  main_content_url  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, month)
);

alter table public.monthly_channel_info enable row level security;

drop policy if exists mci_own_sel on public.monthly_channel_info;
create policy mci_own_sel on public.monthly_channel_info
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists mci_own_ins on public.monthly_channel_info;
create policy mci_own_ins on public.monthly_channel_info
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists mci_own_upd on public.monthly_channel_info;
create policy mci_own_upd on public.monthly_channel_info
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
