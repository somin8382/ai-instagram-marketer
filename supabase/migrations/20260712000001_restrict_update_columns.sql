-- Restrict which columns end users may UPDATE on their own rows.
-- RLS row policies (…_update_own) already gate WHICH rows, but RLS cannot
-- restrict WHICH columns — so a user could rewrite their own grant amount or
-- edit/erase an admin's inquiry reply. Column-level UPDATE privileges close
-- that: revoke blanket UPDATE, then grant only the columns the client writes.
-- The service role (admin routes, grant issuance, replies) bypasses these
-- privileges as the table owner.

-- credit_grants: users may only confirm their own grant popup.
revoke update on public.credit_grants from anon, authenticated;
grant update (confirmed, confirmed_at) on public.credit_grants to authenticated;

-- inquiries: users may only set the reply-read marker on their own inquiry.
revoke update on public.inquiries from anon, authenticated;
grant update (reply_read_at) on public.inquiries to authenticated;
