import { type NextRequest, NextResponse } from "next/server";
import { assertAdmin, getSupabaseServiceRoleClient } from "@/lib/server/admin";
import { checkSocialUrl } from "@/lib/client/social-url";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

const APPS_CAP = 20000;

type AppRow = {
  id: string;
  user_id: string | null;
  email: string | null;
  manager_name: string | null;
  marketing_channel: string | null;
  channel_url: string | null;
  main_content_url: string | null;
  created_at: string | null;
};

// URL-bearing fields on a marketer submission, with a Korean label.
const URL_FIELDS: Array<{ field: "channel_url" | "main_content_url"; label: string }> = [
  { field: "channel_url", label: "채널 URL" },
  { field: "main_content_url", label: "대표 콘텐츠 URL" },
];

// GET /api/admin/marketer-urls — only the INVALID URLs across all submitted
// marketer applications, one entry per (submission, field). Reuses the same
// checkSocialUrl validation the generator/onboarding UI uses.
export async function GET(request: NextRequest) {
  const adminResult = await assertAdmin(extractBearerToken(request));
  if (!adminResult.ok) {
    return NextResponse.json({}, { status: adminResult.status });
  }

  try {
    const db = getSupabaseServiceRoleClient();
    const appsRes = (await (
      db
        .from("applications")
        .select(
          "id, user_id, email, manager_name, marketing_channel, channel_url, main_content_url, created_at"
        )
        .order("created_at", { ascending: false })
        .limit(APPS_CAP) as unknown
    )) as {
      data: AppRow[] | null;
      error: { message: string } | null;
    };

    if (appsRes.error) {
      console.error(
        "[/api/admin/marketer-urls] applications query failed:",
        appsRes.error.message
      );
      return NextResponse.json(
        { error: "데이터를 불러오지 못했습니다." },
        { status: 500 }
      );
    }

    const invalid: Array<{
      applicationId: string;
      userId: string | null;
      email: string | null;
      managerName: string | null;
      createdAt: string | null;
      field: string;
      fieldLabel: string;
      platform: "instagram" | "youtube";
      value: string;
      reason: string;
    }> = [];

    let submissionsScanned = 0;

    for (const app of appsRes.data ?? []) {
      const platform: "instagram" | "youtube" =
        app.marketing_channel === "youtube" ? "youtube" : "instagram";
      let hasAnyUrl = false;

      for (const { field, label } of URL_FIELDS) {
        const raw = app[field];
        if (!raw || !raw.trim()) continue;
        hasAnyUrl = true;
        const check = checkSocialUrl(raw, platform);
        // Only surface clear format errors — "check" (확인 필요) is not listed
        // here to avoid noise; those may be legitimate.
        if (check && check.status === "invalid") {
          invalid.push({
            applicationId: app.id,
            userId: app.user_id,
            email: app.email,
            managerName: app.manager_name,
            createdAt: app.created_at,
            field,
            fieldLabel: label,
            platform,
            value: raw,
            reason: check.message,
          });
        }
      }

      if (hasAnyUrl) submissionsScanned += 1;
    }

    return NextResponse.json({
      invalid,
      submissionsScanned,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[/api/admin/marketer-urls] failed:", error);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
