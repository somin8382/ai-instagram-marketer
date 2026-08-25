-- ─────────────────────────────────────────────────────────────────────────────
-- 마이그레이션 (2026-08-25) — Supabase SQL 편집기에 붙여넣고 한 번 실행.
-- 채널별 마케터 인원수 칸 추가. 목표 = 플랫폼 기준 × 마케터 수.
--   인스타 1계정에 마케터 2명 → 팔로워 1,000명
-- 기존 데이터는 마케터 1명으로 백필됩니다. 멱등(재실행 안전).
-- ─────────────────────────────────────────────────────────────────────────────

-- 월별 마케팅 정보에 '플랫폼별 마케터 인원수'를 담는다.
--
-- 목표치는 마케터 1명 기준(인스타 팔로워 500 / 유튜브 구독자 200)이고,
-- 한 채널에 마케터를 여러 명 투입하면 그만큼 목표가 올라간다.
--   예) 인스타 1개 계정에 마케터 2명 → 팔로워 1,000명
--
-- 지금까지는 service_grants.marketer_quantity(총 인원)만 있어 어느 플랫폼에
-- 몇 명이 붙었는지 알 수 없었다.
alter table public.monthly_channel_info
  add column if not exists youtube_marketer_count   integer,
  add column if not exists instagram_marketer_count integer;

-- 기존 행 백필: 주 플랫폼에 1명이 붙어 있던 것으로 본다.
update public.monthly_channel_info
   set youtube_marketer_count = coalesce(youtube_marketer_count, 1)
 where youtube_channel_url is not null or youtube_content_url is not null;

update public.monthly_channel_info
   set instagram_marketer_count = coalesce(instagram_marketer_count, 1)
 where instagram_channel_url is not null or instagram_content_url is not null;

comment on column public.monthly_channel_info.youtube_marketer_count is
  '해당 월 유튜브 채널에 투입된 마케터 수. 목표 = 200 × 이 값.';
comment on column public.monthly_channel_info.instagram_marketer_count is
  '해당 월 인스타그램 계정에 투입된 마케터 수. 목표 = 500 × 이 값.';
