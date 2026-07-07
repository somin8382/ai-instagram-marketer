import { type NextRequest, NextResponse } from "next/server";
import { assertAdmin, getSupabaseServiceRoleClient } from "@/lib/server/admin";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

// GET /api/admin/inquiries — all inquiries, newest first
export async function GET(request: NextRequest) {
  const adminResult = await assertAdmin(extractBearerToken(request));
  if (!adminResult.ok) {
    return NextResponse.json({}, { status: adminResult.status });
  }

  try {
    const db = getSupabaseServiceRoleClient();
    const res = (await (
      db
        .from("inquiries")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200) as unknown
    )) as {
      data: Array<Record<string, unknown>> | null;
      error: { message: string } | null;
    };

    if (res.error) {
      // Table may not exist yet (migration pending) — return empty
      return NextResponse.json({ inquiries: [] });
    }
    return NextResponse.json({ inquiries: res.data ?? [] });
  } catch (error) {
    console.error("[/api/admin/inquiries] failed:", error);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/inquiries — save/replace the reply for one inquiry
export async function PATCH(request: NextRequest) {
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

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const reply = typeof body.reply === "string" ? body.reply.trim() : "";
  if (!id || !reply) {
    return NextResponse.json(
      { error: "id와 답변 내용이 필요합니다." },
      { status: 400 }
    );
  }

  try {
    const db = getSupabaseServiceRoleClient();
    const res = (await (
      db
        .from("inquiries")
        .update({
          admin_reply: reply.slice(0, 4000),
          replied_by: adminResult.email,
          replied_at: new Date().toISOString(),
          status: "answered",
          // A new/edited reply should re-trigger the user's unread indicator
          reply_read_at: null,
        } as never)
        .eq("id", id)
        .select("id") as unknown
    )) as {
      data: Array<{ id: string }> | null;
      error: { message: string } | null;
    };

    if (res.error) {
      return NextResponse.json({ error: res.error.message }, { status: 500 });
    }
    if (!res.data?.length) {
      return NextResponse.json(
        { error: "대상 문의를 찾을 수 없습니다." },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[/api/admin/inquiries] PATCH failed:", error);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
