import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export function getSupabaseServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Service role client not configured");
  }
  return createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Neutralize characters that would break a value interpolated into a PostgREST
 * `.or()` / filter string: the list separators and grouping (`,` `(` `)`) and
 * the LIKE / PostgREST wildcards (`%` `_` `*` `\`). Names and emails never
 * legitimately contain these, so replacing them with spaces keeps search
 * literal and prevents malformed-filter 500s or unintended wildcard matches.
 */
export function escapePostgrestFilterValue(value: string): string {
  return value.replace(/[,()%_*\\]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Propagate an admin-side change of grant credits to the user's live
 * subscription. Grant credits are copied into subscriptions.remaining_credits
 * only at redeem time, so editing a grant after the user has an active
 * subscription would otherwise never reach the user. Applies the DELTA
 * (new - old) rather than overwriting, to preserve consumption history.
 * Returns "synced" | "no_subscription" | "inactive" | "error".
 */
export async function applyGrantCreditDelta({
  db,
  appliedUserId,
  oldCredits,
  newCredits,
  todayKr,
}: {
  db: ReturnType<typeof getSupabaseServiceRoleClient>;
  appliedUserId: string;
  oldCredits: number;
  newCredits: number;
  todayKr: string;
}): Promise<"synced" | "no_subscription" | "inactive" | "error"> {
  const delta = newCredits - oldCredits;
  if (delta === 0) return "synced";

  const subRes = (await (
    db
      .from("subscriptions")
      .select("id, start_date, end_date, remaining_credits")
      .eq("user_id", appliedUserId)
      .eq("plan_type", "post_generator")
      .maybeSingle() as unknown
  )) as {
    data: {
      id: string;
      start_date: string;
      end_date: string;
      remaining_credits: number;
    } | null;
    error: { message: string } | null;
  };

  if (subRes.error) {
    console.error(
      "[admin] grant credit sync: subscription lookup failed:",
      subRes.error.message
    );
    return "error";
  }
  if (!subRes.data) return "no_subscription";

  const sub = subRes.data;
  const isActive = sub.start_date <= todayKr && sub.end_date >= todayKr;
  if (!isActive) return "inactive";

  // Atomic adjust via RPC (no read-modify-write race with concurrent
  // consumption); floors at 0.
  const adjustRes = (await (db.rpc("adjust_post_generator_credits" as never, {
    p_user_id: appliedUserId,
    p_delta: delta,
  } as never) as unknown)) as {
    data: number | null;
    error: { message: string } | null;
  };

  if (adjustRes.error) {
    console.error(
      "[admin] grant credit sync: adjust RPC failed:",
      adjustRes.error.message
    );
    return "error";
  }

  console.info(
    "[admin] grant credit sync applied:",
    JSON.stringify({ userId: appliedUserId, delta, nextCredits: adjustRes.data })
  );
  return "synced";
}

// Reused in overview/route.ts for state derivation
export function parseMonthsList(months: string | null | undefined): number[] {
  if (!months) return [];
  return months
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export async function assertAdmin(
  accessToken: string
): Promise<{ ok: true; email: string } | { ok: false; status: 401 | 403 | 500 }> {
  const adminEmailsEnv = process.env.ADMIN_EMAILS;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Missing config → 500 (never echo env var names/values in the response)
  if (!adminEmailsEnv || !serviceRoleKey) {
    return { ok: false, status: 500 };
  }

  // Refinement 1: trim+lowercase EACH entry in ADMIN_EMAILS (env value may have spaces after commas)
  const allowedEmails = adminEmailsEnv
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (!accessToken) {
    return { ok: false, status: 401 };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return { ok: false, status: 500 };
  }

  // Verify the token using the same pattern as app/api/ai/route.ts
  const supabase = createClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  let userEmail: string | null = null;
  try {
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user?.email) {
      return { ok: false, status: 401 };
    }
    userEmail = data.user.email;
  } catch {
    return { ok: false, status: 401 };
  }

  // Refinement 1: trim+lowercase the caller's email too
  const normalizedEmail = userEmail.trim().toLowerCase();
  if (!allowedEmails.includes(normalizedEmail)) {
    return { ok: false, status: 403 };
  }

  return { ok: true, email: normalizedEmail };
}
