-- ─────────────────────────────────────────────────────────────────────────────
-- 추가 마이그레이션 (2026-08-24) — Supabase SQL 편집기에 통째로 붙여넣고 한 번 실행.
-- 모든 구문은 멱등(재실행 안전)입니다.
--   ① user_notices           : 마이페이지 상시 안내 카드
--   ② prepaid_credit_entries : 선결제 크레딧 원장 (1원=1크레딧)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── ① user_notices ──
-- 마이페이지에 상시 노출되는 관리자 안내 카드.
-- credit_grants는 '한 번 보고 닫는 팝업'이라 결제 완료 같은 상태 표시에는 맞지
-- 않아 별도로 둔다. 결제/입금 확인, 진행 보류 안내 등 유저에게 계속 보여야 하는
-- 문구를 관리자가 직접 넣는 용도.
create table if not exists public.user_notices (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  user_id    uuid,
  month      text,                                   -- 'YYYY-MM' (null = 월 무관 상시)
  title      text not null,                          -- 카드 제목 (뱃지로 표시)
  body       text,                                   -- 본문 설명
  tone       text not null default 'info'
             check (tone in ('info', 'success', 'warn')),
  sort_order integer not null default 0,             -- 작을수록 위
  active     boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_notices_email_idx
  on public.user_notices (lower(email));
create index if not exists user_notices_month_idx
  on public.user_notices (month);

alter table public.user_notices enable row level security;

-- SELECT: 본인 것만. applications와 동일하게 user_id 우선, 아직 연결되지 않은
-- 행은 세션 이메일로 매칭한다.
drop policy if exists user_notices_select_own on public.user_notices;
create policy user_notices_select_own
  on public.user_notices for select
  using (
    auth.uid() = user_id
    or (user_id is null and lower(email) = lower(auth.email()))
  );

-- 쓰기 정책 없음 → 관리자(service_role) 전용.

comment on table public.user_notices is
  '마이페이지 상시 안내 카드. active=true 인 행만 노출, service_role 전용 기록.';

-- ── ② prepaid_credit_entries ──
-- 선결제 크레딧 원장. 요금제 페이지 기준 1원 = 1크레딧인 '충전형 잔액'을 다룬다.
-- AI 생성기의 '생성 횟수'(subscriptions.remaining_credits)와는 완전히 별개다.
--   · 충전(charge)  : 계좌이체·카드결제 등으로 선결제한 금액 (+)
--   · 차감(deduct)  : 서비스 이용으로 사용한 금액 (−)
--   · 조정(adjust)  : 오입금 정정, 환불 등 (+/−)
-- 잔액 = 해당 유저 entries 의 amount 합계.
create table if not exists public.prepaid_credit_entries (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  user_id     uuid,
  amount      integer not null,                    -- 충전 +, 차감 − (1원 = 1크레딧)
  kind        text not null default 'charge'
              check (kind in ('charge', 'deduct', 'adjust')),
  method      text check (method in ('bank_transfer', 'card', 'other')),
  memo        text,
  occurred_on date not null default (now() at time zone 'Asia/Seoul')::date,
  created_by  text,
  created_at  timestamptz not null default now()
);

create index if not exists prepaid_credit_entries_email_idx
  on public.prepaid_credit_entries (lower(email), occurred_on desc);
create index if not exists prepaid_credit_entries_user_idx
  on public.prepaid_credit_entries (user_id, occurred_on desc);

-- 충전은 양수, 차감은 음수여야 한다 (부호 실수로 잔액이 뒤집히는 것을 막는다).
alter table public.prepaid_credit_entries
  drop constraint if exists prepaid_credit_entries_sign_check;
alter table public.prepaid_credit_entries
  add constraint prepaid_credit_entries_sign_check check (
    (kind = 'charge' and amount > 0)
    or (kind = 'deduct' and amount < 0)
    or (kind = 'adjust' and amount <> 0)
  );

alter table public.prepaid_credit_entries enable row level security;

-- SELECT: 본인 것만 (마이페이지 잔액/내역 표시).
drop policy if exists prepaid_credit_entries_select_own on public.prepaid_credit_entries;
create policy prepaid_credit_entries_select_own
  on public.prepaid_credit_entries for select
  using (
    auth.uid() = user_id
    or (user_id is null and lower(email) = lower(auth.email()))
  );

-- 쓰기 정책 없음 → 관리자(service_role) 전용.

comment on table public.prepaid_credit_entries is
  '선결제 크레딧 원장(1원=1크레딧). 생성기 생성 횟수와 별개. 잔액=amount 합계.';
