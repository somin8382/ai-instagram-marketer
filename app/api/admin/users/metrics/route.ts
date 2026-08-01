import { type NextRequest, NextResponse } from "next/server";
import { assertAdmin, getSupabaseServiceRoleClient } from "@/lib/server/admin";
import { getKoreaDateString } from "@/lib/post-generator/subscription";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

// Metric keys stored in follower_snapshots.platform (지표 키로 재사용).
const METRIC_KEYS = [
  "instagram",
  "youtube",
  "youtube_views",
  "post_likes",
  "post_comments",
];

// PUT /api/admin/users/metrics — record a metric for a user, dated today (KST).
// Re-recording the same day/metric overwrites (upsert).
// Body: { email, platform: instagram|youtube|post_likes|post_comments, count }
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
  const platform = typeof body.platform === "string" ? body.platform : "";
  const count = Number(body.count);

  if (!email) {
    return NextResponse.json({ error: "email이 필요합니다." }, { status: 400 });
  }
  if (!METRIC_KEYS.includes(platform)) {
    return NextResponse.json({ error: "지표 종류가 올바르지 않습니다." }, { status: 400 });
  }
  if (!Number.isInteger(count) || count < 0 || count > 5_000_000_000) {
    return NextResponse.json(
      { error: "수치는 0 이상의 정수여야 합니다." },
      { status: 400 }
    );
  }

  const recordedOn = getKoreaDateString();

  try {
    const db = getSupabaseServiceRoleClient();
    const res = (await (
      db.from("follower_snapshots").upsert(
        {
          email,
          platform,
          count,
          recorded_on: recordedOn,
          recorded_by: adminResult.email,
        } as never,
        { onConflict: "email,platform,recorded_on" }
      ) as unknown
    )) as { error: { message: string } | null };

    if (res.error) {
      console.error("[/api/admin/users/metrics] upsert failed:", res.error.message);
      return NextResponse.json({ error: "저장에 실패했습니다." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, recordedOn });
  } catch (error) {
    console.error("[/api/admin/users/metrics] failed:", error);
    return NextResponse.json(
      { error: "저장 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
