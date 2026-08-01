-- 마케터 신청(applications): 댓글 이벤트 포함 여부(true=포함, false=미포함,
-- null=미지정). 신규 마케터 구독 신청 폼에서 사용자가 직접 선택한다.
-- 8월 마케팅 변경 폼(monthly_channel_info.comments_included)과 같은 개념.
alter table public.applications
  add column if not exists comments_included boolean;

comment on column public.applications.comments_included is
  '마케터 신청: 댓글 이벤트 포함 여부(true=포함, false=미포함, null=미지정)';
