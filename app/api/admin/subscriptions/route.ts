import { type NextRequest, NextResponse } from "next/server";
import { assertAdmin, getSupabaseServiceRoleClient } from "@/lib/server/admin";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

// "7,8" → [7, 8] (상품별 이용 개월 목록). 공백·빈값 안전.
function parseMonths(list: string | null): number[] {
  if (!list) return [];
  return String(list)
    .split(/[,\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12)
    .sort((a, b) => a - b);
}

// GET /api/admin/subscriptions — AI 마케터/생성기 이용자의 상품별 이용 개월.
// 저장 모델을 grant의 marketer_months/generator_months(개월 목록)로 통일 —
// 전체 유저·사전등록과 같은 기준을 쓴다.
export async function GET(request: NextRequest) {
  const adminResult = await assertAdmin(extractBearerToken(request));
  if (!adminResult.ok) {
    return NextResponse.json({}, { status: adminResult.status });
  }

  try {
    const db = getSupabaseServiceRoleClient();

    const grantsRes = (await (
      db
        .from("service_grants")
        .select(
          "id, email, applicant_name, host_org, ai_marketer, ai_generator, marketer_months, generator_months"
        )
        .or("ai_marketer.eq.true,ai_generator.eq.true") as unknown
    )) as {
      data: Array<{
        id: string;
        email: string;
        applicant_name: string | null;
        host_org: string | null;
        ai_marketer: boolean;
        ai_generator: boolean;
        marketer_months: string | null;
        generator_months: string | null;
      }> | null;
      error: { message: string } | null;
    };
    if (grantsRes.error) {
      return NextResponse.json(
        { error: "데이터를 불러오지 못했습니다." },
        { status: 500 }
      );
    }

    // Dedupe grants by email (a person could have >1 grant row)
    const seen = new Set<string>();
    const rows = (grantsRes.data ?? [])
      .filter((g) => {
        const k = (g.email || "").trim().toLowerCase();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((g) => ({
        id: g.id,
        email: g.email,
        name: g.applicant_name,
        hostOrg: g.host_org,
        hasMarketer: g.ai_marketer,
        hasGenerator: g.ai_generator,
        // 상품을 실제로 가진 경우에만 개월 노출
        marketerMonths: g.ai_marketer ? parseMonths(g.marketer_months) : [],
        generatorMonths: g.ai_generator ? parseMonths(g.generator_months) : [],
      }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    return NextResponse.json({ rows });
  } catch (error) {
    console.error("[/api/admin/subscriptions GET] failed:", error);
    return NextResponse.json({ error: "오류가 발생했습니다." }, { status: 500 });
  }
}

// PUT /api/admin/subscriptions — set a user's usage months for one product.
// Body: { email, product: "marketer"|"generator", months: number[] }
// 개월 목록을 grant의 marketer_months/generator_months에 직접 저장(통일 모델).
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
  if (!email) {
    return NextResponse.json({ error: "email이 필요합니다." }, { status: 400 });
  }
  if (
    typeof body.product !== "string" ||
    !["marketer", "generator"].includes(body.product)
  ) {
    return NextResponse.json(
      { error: "상품이 올바르지 않습니다." },
      { status: 400 }
    );
  }
  const product = body.product;

  // months: 중복 제거·정렬·1~12 정수만 허용.
  const months = Array.from(
    new Set(
      (Array.isArray(body.months) ? body.months : [])
        .map((m) => Number(m))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12)
    )
  ).sort((a, b) => a - b);

  try {
    const db = getSupabaseServiceRoleClient();
    const field = product === "marketer" ? "marketer_months" : "generator_months";
    const res = (await (
      db
        .from("service_grants")
        .update({ [field]: months.join(",") } as never)
        .ilike("email", email) as unknown
    )) as { error: { message: string } | null };

    if (res.error) {
      console.error(
        "[/api/admin/subscriptions PUT] update failed:",
        res.error.message
      );
      return NextResponse.json({ error: "저장에 실패했습니다." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, months });
  } catch (error) {
    console.error("[/api/admin/subscriptions PUT] failed:", error);
    return NextResponse.json(
      { error: "저장 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
