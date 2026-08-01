import { type NextRequest, NextResponse } from "next/server";
import {
  assertAdmin,
  escapePostgrestFilterValue,
  getSupabaseServiceRoleClient,
} from "@/lib/server/admin";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

type UserSearchRow = {
  id: string;
  email: string | null;
  name: string | null;
  created_at: string | null;
  company_name: string | null;
};

export async function GET(request: NextRequest) {
  const adminResult = await assertAdmin(extractBearerToken(request));
  if (!adminResult.ok) {
    return NextResponse.json({}, { status: adminResult.status });
  }

  const q = request.nextUrl.searchParams.get("q") ?? "";
  // Escape PostgREST filter metacharacters before interpolating into .or().
  const trimmed = escapePostgrestFilterValue(q.trim().toLowerCase());

  if (!trimmed || trimmed.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const db = getSupabaseServiceRoleClient();

    // Search profiles by email or name (most common path)
    const profileRes = (await (
      db
        .from("profiles")
        .select("id, email, name, created_at, company_name")
        .or(
          `email.ilike.%${trimmed}%,name.ilike.%${trimmed}%`
        )
        .limit(20) as unknown
    )) as { data: UserSearchRow[] | null; error: { message: string } | null };

    const results: Array<{
      id: string;
      email: string | null;
      name: string | null;
      createdAt: string | null;
      source: "profile" | "application";
    }> = [];

    if (!profileRes.error && profileRes.data) {
      for (const row of profileRes.data) {
        results.push({
          id: row.id,
          email: row.email,
          name: row.name,
          createdAt: row.created_at,
          source: "profile",
        });
      }
    }

    // Also search applications by email (for users who haven't signed up yet)
    const appRes = (await (
      db
        .from("applications")
        .select("user_id, email, manager_name, created_at")
        .ilike("email", `%${trimmed}%`)
        .order("created_at", { ascending: false })
        .limit(20) as unknown
    )) as { data: Array<{user_id: string | null; email: string | null; manager_name: string | null; created_at: string | null}> | null; error: { message: string } | null };

    if (!appRes.error && appRes.data) {
      for (const row of appRes.data) {
        // Only add if we don't already have this as a signed-up user
        if (row.user_id && results.some((r) => r.id === row.user_id)) {
          continue;
        }
        if (!results.some((r) => r.email?.toLowerCase() === row.email?.toLowerCase())) {
          results.push({
            id: row.user_id || `app_${row.email}`,
            email: row.email,
            name: row.manager_name,
            createdAt: row.created_at,
            source: "application",
          });
        }
      }
    }

    return NextResponse.json({ results: results.slice(0, 20) });
  } catch (error) {
    console.error("[/api/admin/users/search] failed:", error);
    return NextResponse.json({ results: [] });
  }
}
