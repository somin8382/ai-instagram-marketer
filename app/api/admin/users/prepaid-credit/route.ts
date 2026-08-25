import { type NextRequest, NextResponse } from "next/server";
import { assertAdmin, getSupabaseServiceRoleClient } from "@/lib/server/admin";
import { getKoreaDateString } from "@/lib/post-generator/subscription";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

const KINDS = ["charge", "deduct", "adjust"];
const METHODS = ["bank_transfer", "card", "other"];
// 1원 = 1크레딧. 한 건에 1억(=1억원)을 넘길 일은 없어 오입력 방어선으로 둔다.
const MAX_ABS_AMOUNT = 100_000_000;

// GET /api/admin/users/prepaid-credit?email=... — 잔액 + 내역
export async function GET(request: NextRequest) {
  const adminResult = await assertAdmin(extractBearerToken(request));
  if (!adminResult.ok) {
    return NextResponse.json({}, { status: adminResult.status });
  }
  const email = (request.nextUrl.searchParams.get("email") ?? "").trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "email이 필요합니다." }, { status: 400 });
  }

  try {
    const db = getSupabaseServiceRoleClient();
    const res = (await (
      db
        .from("prepaid_credit_entries")
        .select("id, amount, kind, method, memo, occurred_on, created_by, created_at")
        .eq("email", email)
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false }) as unknown
    )) as {
      data: Array<{ amount: number }> | null;
      error: { message: string } | null;
    };

    if (res.error) {
      // 테이블 미생성 시에도 화면이 죽지 않도록 빈 값으로 응답한다.
      return NextResponse.json({ balance: 0, entries: [], available: false });
    }
    const entries = res.data ?? [];
    const balance = entries.reduce((sum, e) => sum + (e.amount ?? 0), 0);
    return NextResponse.json({ balance, entries, available: true });
  } catch (error) {
    console.error("[/api/admin/users/prepaid-credit] GET failed:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}

// POST /api/admin/users/prepaid-credit — 충전/차감/조정 1건 기록
// Body: { email, amount, kind, method?, memo?, occurredOn? }
export async function POST(request: NextRequest) {
  const adminResult = await assertAdmin(extractBearerToken(request));
  if (!adminResult.ok) {
    return NextResponse.json({}, { status: adminResult.status });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const kind = typeof body.kind === "string" ? body.kind : "charge";
  const method = typeof body.method === "string" ? body.method : null;
  const memo = typeof body.memo === "string" ? body.memo.trim() : "";
  const occurredOn =
    typeof body.occurredOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.occurredOn)
      ? body.occurredOn
      : getKoreaDateString();
  const rawAmount = Number(body.amount);

  if (!email) {
    return NextResponse.json({ error: "email이 필요합니다." }, { status: 400 });
  }
  if (!KINDS.includes(kind)) {
    return NextResponse.json({ error: "구분값이 올바르지 않습니다." }, { status: 400 });
  }
  if (method && !METHODS.includes(method)) {
    return NextResponse.json({ error: "결제수단이 올바르지 않습니다." }, { status: 400 });
  }
  if (!Number.isInteger(rawAmount) || rawAmount === 0 || Math.abs(rawAmount) > MAX_ABS_AMOUNT) {
    return NextResponse.json(
      { error: "금액은 0이 아닌 정수여야 합니다." },
      { status: 400 }
    );
  }
  // 부호는 구분에 맞춰 서버에서 정규화한다 (관리자가 −를 빼먹어도 안전하게).
  const amount =
    kind === "charge"
      ? Math.abs(rawAmount)
      : kind === "deduct"
        ? -Math.abs(rawAmount)
        : rawAmount;

  try {
    const db = getSupabaseServiceRoleClient();

    // 이메일로 계정을 찾아 user_id를 함께 채운다(마이페이지 RLS가 user_id 우선).
    const profRes = (await (
      db.from("profiles").select("id").eq("email", email).maybeSingle() as unknown
    )) as { data: { id: string } | null };

    const insertRes = (await (
      db.from("prepaid_credit_entries").insert({
        email,
        user_id: profRes.data?.id ?? null,
        amount,
        kind,
        method: method || null,
        memo: memo || null,
        occurred_on: occurredOn,
        created_by: adminResult.email,
      } as never) as unknown
    )) as { error: { message: string } | null };

    if (insertRes.error) {
      console.error("[/api/admin/users/prepaid-credit] insert failed:", insertRes.error.message);
      return NextResponse.json({ error: "저장에 실패했습니다." }, { status: 500 });
    }

    const listRes = (await (
      db
        .from("prepaid_credit_entries")
        .select("amount")
        .eq("email", email) as unknown
    )) as { data: Array<{ amount: number }> | null };
    const balance = (listRes.data ?? []).reduce((s, e) => s + (e.amount ?? 0), 0);

    return NextResponse.json({ ok: true, amount, balance });
  } catch (error) {
    console.error("[/api/admin/users/prepaid-credit] POST failed:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
