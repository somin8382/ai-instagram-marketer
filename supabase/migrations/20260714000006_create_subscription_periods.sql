-- 월 요금제 구독기간 관리: 유저(email)별·상품별 시작월 + 개월수.
-- 만료월/상태(구독중·만료임박·만료)는 이 값으로 계산한다.
create table if not exists public.subscription_periods (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  product     text not null check (product in ('marketer', 'generator')),
  start_month date not null,          -- 시작월 1일 (예: 2026-07-01)
  months      integer not null check (months >= 1),
  updated_by  text,
  updated_at  timestamptz not null default now(),
  unique (email, product)
);

alter table public.subscription_periods enable row level security;

comment on table public.subscription_periods is
  '월 요금제 구독기간(시작월+개월수). email 기준, service_role 전용.';
