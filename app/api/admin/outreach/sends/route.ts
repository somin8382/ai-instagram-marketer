import { type NextRequest, NextResponse } from "next/server";
import { assertAdmin, getSupabaseServiceRoleClient } from "@/lib/server/admin";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

// GET /api/admin/outreach/sends?messageId=... — per-recipient rows for one campaign.
export async function GET(request: NextRequest) {
  const adminResult = await assertAdmin(extractBearerToken(request));
  if (!adminResult.ok) return NextResponse.json({}, { status: adminResult.status });

  const messageId = request.nextUrl.searchParams.get("messageId");
  if (!messageId) {
    return NextResponse.json({ error: "messageId required" }, { status: 400 });
  }

  try {
    const db = getSupabaseServiceRoleClient();
    const res = (await (
      db
        .from("outreach_sends")
        .select("recipient_email, recipient_phone, recipient_name, status, error, created_at")
        .eq("message_id", messageId)
        .order("created_at", { ascending: true })
        .limit(3000) as unknown
    )) as { data: Array<Record<string, unknown>> | null; error: { message: string } | null };

    if (res.error) return NextResponse.json({ sends: [] });
    return NextResponse.json({ sends: res.data ?? [] });
  } catch (error) {
    console.error("[/api/admin/outreach/sends] failed:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
