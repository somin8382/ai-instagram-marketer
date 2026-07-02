import "server-only";
import { type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleClient } from "@/lib/server/admin";
import type { Database } from "@/lib/supabase/types";

export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return Response.json({ error: "서버 설정 오류" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!jwt) {
    return Response.json({ error: "인증이 필요합니다" }, { status: 401 });
  }

  // Verify JWT — same pattern as admin route's assertAdmin.
  const anonClient = createClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: { user }, error: authError } = await anonClient.auth.getUser(jwt);
  if (authError || !user) {
    return Response.json({ error: "유효하지 않은 토큰" }, { status: 401 });
  }

  let body: { emails?: unknown } = {};
  try {
    body = (await request.json()) as { emails?: unknown };
  } catch {
    // empty body is fine — return early with zero counts
  }

  const rawEmails = Array.isArray(body.emails) ? body.emails : [];
  const candidates: string[] = [
    ...new Set(
      rawEmails
        .filter((e): e is string => typeof e === "string")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];

  if (candidates.length === 0) {
    return Response.json({ linkedApplicationCount: 0, linkedGeneratedPostCount: 0, error: null });
  }

  const db = getSupabaseServiceRoleClient();
  const errors: string[] = [];
  const linkedApplicationIds = new Set<string>();
  let linkedApplicationCount = 0;
  let linkedGeneratedPostCount = 0;

  for (const email of candidates) {
    // UPDATE applications SET user_id WHERE email matches and row is still unlinked.
    const { data: updated, error: updateError } = await (db
      .from("applications")
      .update({ user_id: user.id } as never)
      .eq("email", email)
      .is("user_id", null)
      .select("id") as unknown as Promise<{
        data: Array<{ id?: string | null }> | null;
        error: { message: string } | null;
      }>);

    if (updateError) {
      errors.push(`applications:${updateError.message}`);
    } else {
      linkedApplicationCount += updated?.length ?? 0;
      for (const row of updated ?? []) {
        if (row.id) linkedApplicationIds.add(String(row.id));
      }
    }

    // SELECT all applications by email to collect IDs for generated_posts backfill.
    const { data: byEmail, error: selectError } = await (db
      .from("applications")
      .select("id")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(10) as unknown as Promise<{
        data: Array<{ id?: string | null }> | null;
        error: { message: string } | null;
      }>);

    if (selectError) {
      errors.push(`applications_lookup:${selectError.message}`);
    } else {
      for (const row of byEmail ?? []) {
        if (row.id) linkedApplicationIds.add(String(row.id));
      }
    }
  }

  // Backfill generated_posts for all linked application IDs.
  if (linkedApplicationIds.size > 0) {
    const { data: postsUpdated, error: postsError } = await (db
      .from("generated_posts")
      .update({ user_id: user.id } as never)
      .in("application_id", [...linkedApplicationIds])
      .is("user_id", null)
      .select("id") as unknown as Promise<{
        data: Array<{ id?: string | null }> | null;
        error: { message: string } | null;
      }>);

    if (postsError) {
      errors.push(`generated_posts:${postsError.message}`);
    } else {
      linkedGeneratedPostCount += postsUpdated?.length ?? 0;
    }
  }

  console.info(
    "[Supabase Link] 아이디(이메일) 기준 연결 결과:",
    JSON.stringify({
      userId: user.id,
      emails: candidates,
      linkedApplicationCount,
      linkedGeneratedPostCount,
      hasError: errors.length > 0,
    })
  );

  return Response.json({
    linkedApplicationCount,
    linkedGeneratedPostCount,
    error: errors.length ? errors.join(" / ") : null,
  });
}
