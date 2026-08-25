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
