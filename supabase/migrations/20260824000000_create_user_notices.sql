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
