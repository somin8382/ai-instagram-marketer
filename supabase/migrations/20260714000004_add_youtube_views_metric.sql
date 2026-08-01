-- 유튜브 조회수(youtube_views) 지표 추가.
alter table public.follower_snapshots
  drop constraint if exists follower_snapshots_platform_check;

alter table public.follower_snapshots
  add constraint follower_snapshots_platform_check
  check (platform in ('instagram', 'youtube', 'youtube_views', 'post_likes', 'post_comments'));
