-- 관리자용 유저 메모(특이사항). 가입/미가입 모두 커버하도록 email(소문자) 기준으로 저장.
-- 관리자 API는 service_role로 접근(RLS 우회)하므로 public 정책은 두지 않아 일반 사용자는 접근 불가.
create table if not exists public.admin_user_notes (
  email      text primary key,
  note       text not null default '',
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.admin_user_notes enable row level security;

comment on table public.admin_user_notes is
  '관리자용 유저 메모(특이사항). email(소문자) 기준, service_role 전용.';
