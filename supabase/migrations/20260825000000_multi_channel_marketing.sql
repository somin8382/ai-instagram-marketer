-- 한 달에 여러 채널(인스타 N개 + 유튜브 M개)을 운영할 수 있도록 구조를 바꾼다.
--
-- 기존 monthly_channel_info 는 (user_id, month) 유니크라 한 달에 채널 1개만
-- 담을 수 있었다. 어제 추가한 플랫폼별 컬럼으로 '유튜브 1 + 인스타 1'까지는
-- 되지만 '인스타 2개'는 여전히 불가능하다.
--
-- 여기서는 '채널 1개 = 행 1개' 구조를 새로 만들고 기존 데이터를 옮긴다.
-- 기존 표(monthly_channel_info)는 지우지 않는다 — 되돌릴 여지를 남긴다.

-- ── ① 월별 채널 표 ──────────────────────────────────────────────────────────
create table if not exists public.monthly_marketing_channels (
  id                uuid primary key default gen_random_uuid(),
  email             text not null,
  user_id           uuid,
  month             text not null,                      -- 'YYYY-MM'
  slot              integer not null default 1,         -- 같은 달 안에서의 순번(1,2,3…)
  platform          text not null check (platform in ('instagram', 'youtube')),
  channel_url       text,
  account_id        text,                               -- @handle
  main_content_url  text,
  comments_included boolean,
  status            text not null default 'active'
                    check (status in ('active', 'pending', 'paused')),
  memo              text,
  created_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (email, month, slot)
);

create index if not exists mmc_month_idx on public.monthly_marketing_channels (month);
create index if not exists mmc_email_idx on public.monthly_marketing_channels (lower(email), month);
create index if not exists mmc_user_idx  on public.monthly_marketing_channels (user_id, month);

alter table public.monthly_marketing_channels enable row level security;

drop policy if exists mmc_select_own on public.monthly_marketing_channels;
create policy mmc_select_own
  on public.monthly_marketing_channels for select
  using (
    auth.uid() = user_id
    or (user_id is null and lower(email) = lower(auth.email()))
  );
-- 쓰기 정책 없음 → service_role 전용.

-- ── ② 백필: monthly_channel_info(월별 제출) → 채널 행 ───────────────────────
-- 주 플랫폼을 slot 1, 나머지 플랫폼이 있으면 slot 2로 넣는다.
insert into public.monthly_marketing_channels
  (email, user_id, month, slot, platform, channel_url, account_id,
   main_content_url, comments_included, created_by)
select
  m.email, m.user_id, m.month, 1,
  coalesce(nullif(m.marketing_channel, ''), 'instagram'),
  case when coalesce(m.marketing_channel,'instagram') = 'youtube'
       then coalesce(m.youtube_channel_url, m.channel_url)
       else coalesce(m.instagram_channel_url, m.channel_url) end,
  m.instagram_id,
  case when coalesce(m.marketing_channel,'instagram') = 'youtube'
       then coalesce(m.youtube_content_url, m.main_content_url)
       else coalesce(m.instagram_content_url, m.main_content_url) end,
  m.comments_included,
  'backfill:monthly_channel_info'
from public.monthly_channel_info m
where m.email is not null
on conflict (email, month, slot) do nothing;

-- 보조 플랫폼(주 플랫폼이 아닌 쪽)에 값이 있으면 slot 2로 추가
insert into public.monthly_marketing_channels
  (email, user_id, month, slot, platform, channel_url,
   main_content_url, comments_included, created_by)
select
  m.email, m.user_id, m.month, 2,
  case when coalesce(m.marketing_channel,'instagram') = 'youtube'
       then 'instagram' else 'youtube' end,
  case when coalesce(m.marketing_channel,'instagram') = 'youtube'
       then m.instagram_channel_url else m.youtube_channel_url end,
  case when coalesce(m.marketing_channel,'instagram') = 'youtube'
       then m.instagram_content_url else m.youtube_content_url end,
  m.comments_included,
  'backfill:monthly_channel_info(2nd)'
from public.monthly_channel_info m
where m.email is not null
  and coalesce(
        case when coalesce(m.marketing_channel,'instagram') = 'youtube'
             then m.instagram_channel_url else m.youtube_channel_url end,
        case when coalesce(m.marketing_channel,'instagram') = 'youtube'
             then m.instagram_content_url else m.youtube_content_url end
      ) is not null
on conflict (email, month, slot) do nothing;

-- ── ③ 백필: applications(신청서) → 해당 월 채널 행 ──────────────────────────
-- 월별 제출이 없는 달(주로 7월, 그리고 8월 신규 신청)을 신청서로 채운다.
-- created_at 은 타임존 없이 UTC 저장이라 KST 로 변환해 월을 뽑는다.
insert into public.monthly_marketing_channels
  (email, user_id, month, slot, platform, channel_url, account_id,
   main_content_url, comments_included, created_by)
select distinct on (lower(a.email), to_char(a.created_at at time zone 'UTC' at time zone 'Asia/Seoul', 'YYYY-MM'))
  a.email, a.user_id,
  to_char(a.created_at at time zone 'UTC' at time zone 'Asia/Seoul', 'YYYY-MM'),
  1,
  coalesce(nullif(a.marketing_channel, ''), 'instagram'),
  coalesce(
    a.channel_url,
    case when a.instagram_id is not null and a.instagram_id <> ''
         then 'https://www.instagram.com/' || ltrim(a.instagram_id, '@') end
  ),
  a.instagram_id,
  a.main_content_url,
  a.comments_included,
  'backfill:applications'
from public.applications a
where a.email is not null
  and a.main_content_url is not null
order by
  lower(a.email),
  to_char(a.created_at at time zone 'UTC' at time zone 'Asia/Seoul', 'YYYY-MM'),
  a.created_at desc
on conflict (email, month, slot) do nothing;

-- ── ④ 성과를 채널별로 ──────────────────────────────────────────────────────
-- monthly_performance 도 (email, month) 유니크라 한 달에 1건뿐이었다.
-- slot 을 추가해 채널별로 기록할 수 있게 한다. 기존 행은 모두 slot 1.
alter table public.monthly_performance
  add column if not exists slot integer not null default 1;

alter table public.monthly_performance
  drop constraint if exists monthly_performance_email_month_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'monthly_performance_email_month_slot_key'
  ) then
    alter table public.monthly_performance
      add constraint monthly_performance_email_month_slot_key
      unique (email, month, slot);
  end if;
end $$;

comment on table public.monthly_marketing_channels is
  '월별 마케팅 채널 (채널 1개 = 행 1개). 한 달에 여러 채널 운영 가능.';
comment on column public.monthly_performance.slot is
  '같은 달 안에서 몇 번째 채널의 성과인지. monthly_marketing_channels.slot 과 짝.';

-- ※ 2026-08-25 현재 이 마이그레이션은 아직 실행하지 않았다.
--    모든 고객이 한 달에 채널 1개만 운영 중이라 급하지 않고,
--    실제로 2개 이상 운영하는 고객이 생길 때 실행하면 된다.
--    (코드에서 monthly_marketing_channels 를 참조하는 곳은 아직 없다.)
