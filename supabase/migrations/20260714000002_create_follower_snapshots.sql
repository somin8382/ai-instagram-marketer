-- 유저별 팔로워/구독자 수 스냅샷 (날짜별 기록). email(소문자) 기준, service_role 전용.
-- 같은 날 같은 플랫폼은 하나만(재입력 시 갱신) → unique(email, platform, recorded_on).
create table if not exists public.follower_snapshots (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  platform    text not null check (platform in ('instagram', 'youtube')),
  count       integer not null check (count >= 0),
  recorded_on date not null,
  recorded_by text,
  created_at  timestamptz not null default now(),
  unique (email, platform, recorded_on)
);

alter table public.follower_snapshots enable row level security;

comment on table public.follower_snapshots is
  '유저별 인스타 팔로워/유튜브 구독자 수 날짜별 스냅샷. email 기준, service_role 전용.';
