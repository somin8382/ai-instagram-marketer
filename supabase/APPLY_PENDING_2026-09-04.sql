-- ─────────────────────────────────────────────────────────────────────────────
-- 마이그레이션 (2026-09-04) — Supabase SQL 편집기에 붙여넣고 한 번 실행.
-- 익명 게시물 저장의 남용을 막을 레이트리밋 저장용 표를 만듭니다.
-- 멱등(재실행 안전).
-- ─────────────────────────────────────────────────────────────────────────────

-- /api/generated-posts/save 는 무료 체험 흐름을 위해 로그인 없이도 저장을
-- 받는다. 자격 증명이 전혀 없고 image_url 은 최대 500,000자(데이터 URL이
-- 들어올 수 있어서)라, 지금까지는 누구나 ~500KB 짜리 행을 무한히 넣을 수
-- 있었다. 이 표가 IP별(24시간)·전체(하루) 상한의 근거가 된다.
--
-- 원시 IP 는 저장하지 않는다(해시만). application_submission_usage 및
-- anonymous_free_trial_usage 와 동일한 구조·프라이버시 모델이고,
-- service_role 만 읽고 쓴다.
--
-- 이 표가 없어도 서비스는 정상 동작한다(리미터가 fail-open). 다만 적용해야
-- 실제로 보호가 걸린다.
create extension if not exists pgcrypto;

create table if not exists public.generated_post_save_usage (
  id       uuid        primary key default gen_random_uuid(),
  ip_hash  text        not null,
  used_at  timestamptz not null default timezone('utc', now())
);

create index if not exists generated_post_save_usage_ip_hash_used_at_idx
  on public.generated_post_save_usage (ip_hash, used_at);

create index if not exists generated_post_save_usage_used_at_idx
  on public.generated_post_save_usage (used_at);

alter table public.generated_post_save_usage enable row level security;
-- 정책 없음: RLS 를 우회하는 service_role 만 접근한다.
