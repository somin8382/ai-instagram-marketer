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
