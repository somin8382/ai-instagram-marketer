-- 팔로워/구독자 외에 '메인 게시물 좋아요/댓글' 수도 같은 스냅샷 테이블에 기록.
-- platform 컬럼을 지표 키로 재사용: instagram | youtube | post_likes | post_comments.
alter table public.follower_snapshots
  drop constraint if exists follower_snapshots_platform_check;

alter table public.follower_snapshots
  add constraint follower_snapshots_platform_check
  check (platform in ('instagram', 'youtube', 'post_likes', 'post_comments'));
