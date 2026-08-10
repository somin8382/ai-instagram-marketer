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
