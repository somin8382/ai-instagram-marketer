-- ─────────────────────────────────────────────────────────────────────────────
-- 마이그레이션 (2026-08-27) — Supabase SQL 편집기에 붙여넣고 한 번 실행.
-- 프로필에 '모두의창업 참여자' 표시 칸(partner_program)을 추가합니다.
-- 기존 사용자는 지원 이력(service_grants 연결)으로 자동 백필됩니다.
-- 멱등(재실행 안전).
-- ─────────────────────────────────────────────────────────────────────────────

-- 사용자가 '모두의창업' 참여자인지 프로필에서 바로 구분한다.
--
-- 지금까지 이 구분은 service_grants 에 그 사용자로 연결된(applied_user_id) 행이
-- 있는지로만 알 수 있었다. 화면마다 그 조인을 반복해야 했고, 로그아웃 상태나
-- 일반 가입자에게도 '모두의창업 이용자 전용 혜택' 안내가 그대로 노출됐다.
--
-- host_org 에는 기관명(서울창조경제혁신센터 등)이 들어 있고 '모두의창업'은
-- 그 기관들이 함께 운영하는 프로그램 이름이라, 기관명으로는 판별할 수 없다.
-- 지원 이력(service_grants 연결) 자체가 참여 여부다.
--
-- boolean 대신 text 로 둔 이유: 값이 곧 어느 프로그램인지를 말해 주고,
-- 다른 제휴 프로그램이 생겨도 컬럼을 더 만들지 않아도 된다.
--   null       = 일반 사용자
--   '모두의창업' = 해당 프로그램 참여자
alter table public.profiles
  add column if not exists partner_program text;

comment on column public.profiles.partner_program is
  '제휴 프로그램 참여자 표시. null 이면 일반 사용자, ''모두의창업'' 이면 해당 프로그램 참여자. service_grants 연결 시 자동으로 채워진다.';

-- 기존 사용자 백필: 이미 지원 이력이 연결된 프로필을 참여자로 본다.
update public.profiles p
   set partner_program = '모두의창업'
 where p.partner_program is null
   and exists (
     select 1
       from public.service_grants g
      where g.applied_user_id = p.id
   );

-- 참여자 목록 조회가 잦으므로 부분 인덱스만 둔다(일반 사용자는 null 이라 제외).
create index if not exists profiles_partner_program_idx
  on public.profiles (partner_program)
  where partner_program is not null;
