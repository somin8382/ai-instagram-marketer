import { type NextRequest, NextResponse } from "next/server";
import { assertAdmin, getSupabaseServiceRoleClient } from "@/lib/server/admin";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

const TOSS_STATUSES = ["wait", "in_progress", "done"];
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// PUT /api/admin/users/monthly-toss — 월별 토스 상태 기록 (email+month 기준 upsert).
// Body: { email, month: 'YYYY-MM', status: wait|in_progress|done }
// 기존 /api/admin/users/toss(월 구분 없는 단일 상태)와 별개로 동작한다.
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
  const month = typeof body.month === "string" ? body.month.trim() : "";
  const status = typeof body.status === "string" ? body.status : "";

  if (!email) {
    return NextResponse.json({ error: "email이 필요합니다." }, { status: 400 });
  }
  if (!MONTH_PATTERN.test(month)) {
    return NextResponse.json(
      { error: "월 형식이 올바르지 않습니다. (YYYY-MM)" },
      { status: 400 }
    );
  }
  if (!TOSS_STATUSES.includes(status)) {
    return NextResponse.json(
      { error: "상태값이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  try {
    const db = getSupabaseServiceRoleClient();
    const res = (await (
      db.from("monthly_toss_status").upsert(
        {
          email,
          month,
          status,
          updated_by: adminResult.email,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "email,month" }
      ) as unknown
    )) as { error: { message: string } | null };

    if (res.error) {
      console.error(
        "[/api/admin/users/monthly-toss] upsert failed:",
        res.error.message
      );
      return NextResponse.json({ error: "저장에 실패했습니다." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, month, status });
  } catch (error) {
    console.error("[/api/admin/users/monthly-toss] failed:", error);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
