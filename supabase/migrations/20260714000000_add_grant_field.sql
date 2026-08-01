-- 사용자 분야(로컬/기술) 구분. 기관 사전등록(service_grants)에 저장하며,
-- 전체 유저 목록은 이메일로 grant를 매칭해 표시한다. 기본값은 '기술'.
alter table public.service_grants
  add column if not exists field text not null default 'tech';

comment on column public.service_grants.field is
  '분야 구분: local(로컬) | tech(기술). 기본 tech.';
