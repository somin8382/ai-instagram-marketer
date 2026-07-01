import { type NextRequest, NextResponse } from "next/server";
import { assertAdmin, getSupabaseServiceRoleClient } from "@/lib/server/admin";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

// PATCH /api/admin/grants — edit a single grant by id
export async function PATCH(request: NextRequest) {
  const token = extractBearerToken(request);
  const adminResult = await assertAdmin(token);
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

  // Build update payload — only editable fields (never touch status/applied_user_id/applied_at/email)
  const update: Record<string, unknown> = {};
  if ("applicant_name" in body) update.applicant_name = body.applicant_name ?? null;
  if ("phone" in body) update.phone = body.phone ?? null;
  if ("host_org" in body) update.host_org = body.host_org ?? null;
  if ("mentor_org" in body) update.mentor_org = body.mentor_org ?? null;
  if ("ai_marketer" in body) update.ai_marketer = Boolean(body.ai_marketer);
  if ("ai_generator" in body) update.ai_generator = Boolean(body.ai_generator);
  if ("marketer_quantity" in body)
    update.marketer_quantity =
      body.marketer_quantity != null ? Number(body.marketer_quantity) || null : null;
  if ("marketer_months" in body)
    update.marketer_months = body.marketer_months || null;
  if ("generator_months" in body)
    update.generator_months = body.generator_months || null;
  if ("generator_credits" in body)
    update.generator_credits = Number(body.generator_credits) || 40;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "변경할 항목이 없습니다." }, { status: 400 });
  }

  try {
    const db = getSupabaseServiceRoleClient();
    const res = (await (
      db
        .from("service_grants")
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
      return NextResponse.json({ error: "대상 행을 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/grants — delete a single grant by id
export async function DELETE(request: NextRequest) {
  const token = extractBearerToken(request);
  const adminResult = await assertAdmin(token);
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

  try {
    const db = getSupabaseServiceRoleClient();
    const res = (await (
      db
        .from("service_grants")
        .delete()
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
      return NextResponse.json({ error: "대상 행을 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
