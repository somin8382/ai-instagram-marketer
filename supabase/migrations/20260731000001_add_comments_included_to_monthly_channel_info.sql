-- 8월 마케팅 입력 폼: 댓글 이벤트 포함 여부(true=포함, false=미포함, null=미지정).
-- 댓글은 하루 이벤트로 불특정 다수가 작성하므로 내용 지정 불가 → 사용자가
-- 포함/미포함을 직접 선택한다.
alter table public.monthly_channel_info
  add column if not exists comments_included boolean;

comment on column public.monthly_channel_info.comments_included is
  '8월 마케팅: 댓글 이벤트 포함 여부(true=포함, false=미포함, null=미지정)';
