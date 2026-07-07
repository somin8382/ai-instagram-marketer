import { type NextRequest, NextResponse } from "next/server";
import { assertAdmin, getSupabaseServiceRoleClient } from "@/lib/server/admin";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

// Marketer-submission fields an admin may correct on behalf of a user.
// Identity/payment columns (email, user_id, depositor, invoice…) stay locked.
const EDITABLE_FIELDS = [
  "marketing_channel",
  "channel_url",
  "main_content_url",
  "instagram_id",
  "industry",
  "product_service",
  "account_direction",
  "account_bio",
  "account_concept",
  "manager_name",
  "phone",
] as const;

// PATCH /api/admin/users/application — edit one application (marketer submission)
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
  if (!id) {
    return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  for (const field of EDITABLE_FIELDS) {
    if (field in body) {
      const value = body[field];
      update[field] =
        typeof value === "string" ? value.trim() || null : (value ?? null);
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "변경할 항목이 없습니다." },
      { status: 400 }
    );
  }

  try {
    const db = getSupabaseServiceRoleClient();
    const res = (await (
      db
        .from("applications")
        .update(update as never)
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
        { error: "대상 행을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    console.info(
      "[/api/admin/users/application] updated:",
      JSON.stringify({ id, fields: Object.keys(update), by: adminResult.email })
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[/api/admin/users/application] failed:", error);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
