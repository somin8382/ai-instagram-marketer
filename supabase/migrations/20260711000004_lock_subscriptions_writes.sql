-- Make subscriptions server-authoritative: remove the browser write path.
-- Deploy AFTER /api/subscriptions/start and the RPC-based consume are live.
-- Reads stay owner-scoped (subscriptions_select_own kept); all writes now go
-- through the service role (start endpoint, /api/ai consume RPC, admin grant
-- routes), so a user can no longer set their own remaining_credits.
drop policy if exists "subscriptions_insert_own" on public.subscriptions;
drop policy if exists "subscriptions_update_own" on public.subscriptions;
