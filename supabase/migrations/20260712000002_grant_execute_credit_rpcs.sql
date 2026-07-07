-- Fix: grant EXECUTE on the credit RPCs to service_role.
-- 20260711000003_credit_rpcs.sql revoked EXECUTE from public/anon/authenticated
-- but never granted it to service_role, so the server routes (which call these
-- with the service-role key) hit "permission denied for function" at runtime
-- (e.g. /api/ai → "사용량 차감 처리에 실패했습니다").
-- Granting to service_role restores server access while keeping browsers
-- (anon/authenticated) blocked. Idempotent — re-running is a no-op.
grant execute on function public.consume_post_generator_credit(uuid, date) to service_role;
grant execute on function public.adjust_post_generator_credits(uuid, integer) to service_role;
