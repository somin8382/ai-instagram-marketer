import { type NextRequest, NextResponse } from "next/server";
import { assertAdmin, getSupabaseServiceRoleClient } from "@/lib/server/admin";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

// PUT /api/admin/users/note — set (upsert) an admin memo for a user, keyed by
// email (works for both signed-up and 미가입 users). Empty note is allowed.
export async function PUT(request: NextRequest) {
  const adminResult = await assertAdmin(extractBearerToken(request));
  if (!adminResult.ok) {
    return NextResponse.json({}, { status: adminResult.status });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const note = typeof body.note === "string" ? body.note.slice(0, 4000) : "";
  if (!email) {
    return NextResponse.json({ error: "email이 필요합니다." }, { status: 400 });
  }

  try {
    const db = getSupabaseServiceRoleClient();
    const res = (await (
      db.from("admin_user_notes").upsert(
        {
          email,
          note,
          updated_by: adminResult.email,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "email" }
      ) as unknown
    )) as { error: { message: string } | null };

    if (res.error) {
      return NextResponse.json(
        { error: "메모 저장에 실패했습니다." },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[/api/admin/users/note] failed:", error);
    return NextResponse.json(
      { error: "메모 저장 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
