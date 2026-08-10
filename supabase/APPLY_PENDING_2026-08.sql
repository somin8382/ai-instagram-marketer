-- ─────────────────────────────────────────────────────────────────────────────
-- PENDING MIGRATIONS BUNDLE (2026-08) — Supabase SQL 편집기에 통째로 붙여넣고
-- 한 번 실행하세요. 모든 구문은 멱등(재실행 안전)입니다.
-- 포함: monthly_performance(월별 달성 성과), monthly_toss_status(월별 토스 상태)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 20260807000000_create_monthly_performance.sql ──
-- 월별 마케팅 성과(달성 증가분). follower_snapshots가 '특정 날짜의 절대 수치'를
-- 기록하는 것과 달리, 이 테이블은 '해당 월에 달성한 증가분'을 기록한다.
--   예) 7월 성과 = 팔로워 537명 / 좋아요 1,094개 / 댓글 30개 달성
-- 한 유저가 한 달에 운영하는 채널은 1개이므로 unique(email, month).
-- 유저 마이페이지 표시 + 관리자 '월 마케팅 완료' 판정에 함께 쓰인다.
create table if not exists public.monthly_performance (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,
  user_id          uuid,
  month            text not null,                        -- 'YYYY-MM' (예: '2026-07')
  platform         text not null check (platform in ('instagram', 'youtube')),
  channel_url      text,
  post_url         text,
  -- 달성 증가분. 플랫폼별로 쓰는 칸이 다르다.
  --   instagram → followers_gained / likes_gained / comments_gained
  --   youtube   → followers_gained(구독자) / views_gained / comments_gained
  followers_gained integer check (followers_gained >= 0),
  likes_gained     integer check (likes_gained >= 0),
  views_gained     integer check (views_gained >= 0),
  comments_gained  integer check (comments_gained >= 0),
  note             text,                                  -- 예외 사유(예: 댓글 미달 시 대체 달성)
  recorded_by      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (email, month)
);

create index if not exists monthly_performance_month_idx
  on public.monthly_performance (month);
create index if not exists monthly_performance_email_idx
  on public.monthly_performance (lower(email));

alter table public.monthly_performance enable row level security;

-- SELECT: 본인 것만. applications와 동일하게 user_id 우선, 아직 연결되지 않은
-- 행(user_id IS NULL)은 세션 이메일로 매칭한다 (사전등록 유저가 마이페이지에서
-- 볼 수 있어야 하므로).
drop policy if exists monthly_performance_select_own on public.monthly_performance;
create policy monthly_performance_select_own
  on public.monthly_performance for select
  using (
    auth.uid() = user_id
    or (user_id is null and lower(email) = lower(auth.email()))
  );

-- 쓰기 정책 없음 → 기록은 service_role(관리자 API)로만 가능하다.

comment on table public.monthly_performance is
  '월별 마케팅 달성 성과(증가분). email+month 유니크, 기록은 service_role 전용.';

-- ── 20260809000000_create_monthly_toss_status.sql ──
-- 월별 토스 진행 상태. 기존 admin_user_notes.toss_status는 월 구분이 없고
-- 'wait' | 'in_progress' 두 값뿐이라 7월/8월을 따로 관리할 수 없었다.
-- 이 테이블은 (email, month) 단위로 상태를 따로 들고, '완료'(done)를 추가한다.
--   wait        대기
--   in_progress 진행중
--   done        진행 완료
-- 기존 admin_user_notes.toss_status는 건드리지 않는다(롤백 여지 + 과거 값 보존).
create table if not exists public.monthly_toss_status (
  email      text not null,
  month      text not null,                       -- 'YYYY-MM' (예: '2026-07')
  status     text not null default 'wait'
             check (status in ('wait', 'in_progress', 'done')),
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (email, month)
);

create index if not exists monthly_toss_status_month_idx
  on public.monthly_toss_status (month);

alter table public.monthly_toss_status enable row level security;

-- 정책 없음 → 관리자(service_role) 전용. 일반 유저에게는 노출되지 않는다.

comment on table public.monthly_toss_status is
  '월별 토스 진행 상태(대기/진행중/완료). email+month 유니크, service_role 전용.';
