import { type NextRequest, NextResponse } from "next/server";
import { assertAdmin, getSupabaseServiceRoleClient } from "@/lib/server/admin";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

const TOSS_STATUSES = ["wait", "in_progress"];

// PUT /api/admin/users/toss — set a user's 토스 진행 상태 (email 기준 upsert).
// note 컬럼은 건드리지 않고 toss_status만 갱신한다.
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
  const status = typeof body.status === "string" ? body.status : "";

  if (!email) {
    return NextResponse.json({ error: "email이 필요합니다." }, { status: 400 });
  }
  if (!TOSS_STATUSES.includes(status)) {
    return NextResponse.json({ error: "상태값이 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const db = getSupabaseServiceRoleClient();
    const res = (await (
      db.from("admin_user_notes").upsert(
        {
          email,
          toss_status: status,
          updated_by: adminResult.email,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "email" }
      ) as unknown
    )) as { error: { message: string } | null };

    if (res.error) {
      console.error("[/api/admin/users/toss] upsert failed:", res.error.message);
      return NextResponse.json({ error: "저장에 실패했습니다." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    console.error("[/api/admin/users/toss] failed:", error);
    return NextResponse.json(
      { error: "저장 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
