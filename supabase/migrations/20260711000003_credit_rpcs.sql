-- Atomic credit operations for post_generator subscriptions.
-- Executed only by the service role (server routes); EXECUTE is revoked from
-- anon/authenticated so browsers cannot call them.

-- Atomic consume: single UPDATE gates on the active window AND a positive
-- balance, eliminating the read-modify-write race. Returns no row when the
-- subscription is inactive or exhausted.
create or replace function public.consume_post_generator_credit(
  p_user_id uuid,
  p_today date
)
returns table (remaining_credits integer, daily_usage_count integer)
language sql
as $$
  update public.subscriptions s
     set remaining_credits = s.remaining_credits - 1,
         daily_usage_count = case
           when s.last_usage_date = p_today then s.daily_usage_count + 1
           else 1
         end,
         last_usage_date = p_today
   where s.user_id = p_user_id
     and s.plan_type = 'post_generator'
     and s.start_date <= p_today
     and s.end_date >= p_today
     and s.remaining_credits > 0
  returning s.remaining_credits, s.daily_usage_count;
$$;

-- Atomic adjust (admin grants / grant-edit delta sync); floor at 0.
create or replace function public.adjust_post_generator_credits(
  p_user_id uuid,
  p_delta integer
)
returns integer
language sql
as $$
  update public.subscriptions s
     set remaining_credits = greatest(s.remaining_credits + p_delta, 0)
   where s.user_id = p_user_id
     and s.plan_type = 'post_generator'
  returning s.remaining_credits;
$$;

revoke execute on function public.consume_post_generator_credit(uuid, date)
  from public, anon, authenticated;
revoke execute on function public.adjust_post_generator_credits(uuid, integer)
  from public, anon, authenticated;
