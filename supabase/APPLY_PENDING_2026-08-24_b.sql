-- ─────────────────────────────────────────────────────────────────────────────
-- 추가 마이그레이션 (2026-08-24 #2) — Supabase SQL 편집기에 붙여넣고 한 번 실행.
-- 월별 마케팅 정보에 유튜브·인스타그램을 함께 담기 위한 컬럼 추가 + 기존 값 백필.
-- 멱등(재실행 안전)이며 기존 컬럼/데이터는 그대로 둡니다.
-- ─────────────────────────────────────────────────────────────────────────────

-- 월별 마케팅 정보에 '두 플랫폼 동시 운영'을 담을 수 있게 확장한다.
-- 기존 구조는 marketing_channel(단일) + channel_url + main_content_url 이라
-- 유튜브와 인스타그램을 한 달에 함께 진행하는 경우를 표현할 수 없었다.
--
-- 기존 컬럼은 그대로 두고(과거 데이터·기존 코드 보존), 플랫폼별 컬럼을 새로
-- 추가한 뒤 현재 값을 해당 플랫폼 칸으로 복사한다.
alter table public.monthly_channel_info
  add column if not exists youtube_channel_url   text,
  add column if not exists youtube_content_url   text,
  add column if not exists instagram_channel_url text,
  add column if not exists instagram_content_url text;

-- 백필: marketing_channel 기준으로 기존 값을 플랫폼 칸에 채운다.
-- 이미 채워진 행은 건드리지 않아 재실행해도 안전하다.
update public.monthly_channel_info
   set youtube_channel_url = coalesce(youtube_channel_url, channel_url),
       youtube_content_url = coalesce(youtube_content_url, main_content_url)
 where marketing_channel = 'youtube';

update public.monthly_channel_info
   set instagram_channel_url = coalesce(
         instagram_channel_url,
         channel_url,
         case
           when instagram_id is not null and instagram_id <> ''
           then 'https://www.instagram.com/' || ltrim(instagram_id, '@')
         end
       ),
       instagram_content_url = coalesce(instagram_content_url, main_content_url)
 where marketing_channel = 'instagram' or marketing_channel is null;

comment on column public.monthly_channel_info.youtube_channel_url is
  '해당 월 유튜브 채널 주소 (인스타와 동시 운영 가능)';
comment on column public.monthly_channel_info.instagram_channel_url is
  '해당 월 인스타그램 계정 주소 (유튜브와 동시 운영 가능)';
