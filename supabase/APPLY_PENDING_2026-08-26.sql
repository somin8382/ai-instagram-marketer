-- ─────────────────────────────────────────────────────────────────────────────
-- 마이그레이션 (2026-08-26) — Supabase SQL 편집기에 붙여넣고 한 번 실행.
-- 결제 건별 성과 표(payment_results) 생성. 기존 표·데이터는 건드리지 않습니다.
-- 멱등(재실행 안전).
-- ─────────────────────────────────────────────────────────────────────────────

-- 결제 한 건으로 진행한 마케팅 결과.
--
-- monthly_performance 는 '월'이 키라 기간을 담을 수 없다. 선결제 90만 크레딧처럼
-- 월 중간(8/21~8/31)에 시작해 끝나는 건은 월 단위로 넣으면 '8월 전체 성과'가
-- 되어버려 실제와 어긋난다.
--
-- 여기서는 선결제 원장(prepaid_credit_entries)의 결제 한 건에 결과를 매단다.
--   · 어느 결제로 만든 결과인지가 직접 연결된다
--   · 기간(period_start ~ period_end)을 그대로 보관한다
--   · 플랫폼별로 한 행씩 (인스타 1행 + 유튜브 1행)
create table if not exists public.payment_results (
  id               uuid primary key default gen_random_uuid(),
  entry_id         uuid not null
                   references public.prepaid_credit_entries(id) on delete cascade,
  email            text not null,
  user_id          uuid,
  platform         text not null check (platform in ('instagram', 'youtube')),
  channel_url      text,
  post_url         text,
  followers_gained integer check (followers_gained >= 0),  -- 팔로워 / 구독자
  likes_gained     integer check (likes_gained >= 0),      -- 인스타 좋아요
  views_gained     integer check (views_gained >= 0),      -- 유튜브 조회수
  comments_gained  integer check (comments_gained >= 0),
  period_start     date,
  period_end       date,
  note             text,
  created_by       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (entry_id, platform)
);

create index if not exists payment_results_entry_idx on public.payment_results (entry_id);
create index if not exists payment_results_email_idx on public.payment_results (lower(email));

alter table public.payment_results enable row level security;

-- SELECT: 본인 것만 (마이페이지 결제 이력에서 함께 표시).
drop policy if exists payment_results_select_own on public.payment_results;
create policy payment_results_select_own
  on public.payment_results for select
  using (
    auth.uid() = user_id
    or (user_id is null and lower(email) = lower(auth.email()))
  );
-- 쓰기 정책 없음 → 관리자(service_role) 전용.

comment on table public.payment_results is
  '결제 건별 마케팅 결과. prepaid_credit_entries 의 결제 한 건에 매달린다.';
