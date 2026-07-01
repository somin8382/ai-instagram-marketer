import { type NextRequest, NextResponse } from "next/server";
import {
  assertAdmin,
  getSupabaseServiceRoleClient,
  parseMonthsList,
} from "@/lib/server/admin";
import {
  getKoreaDateString,
  POST_GENERATOR_PLAN_TYPE,
} from "@/lib/post-generator/subscription";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function getGeneratorState(
  aiGenerator: boolean,
  generatorMonths: string | null,
  subscription: { start_date: string; end_date: string } | null,
  today: string,
  currentMonth: number
): string | null {
  if (!aiGenerator) return null;
  if (
    subscription &&
    subscription.start_date <= today &&
    subscription.end_date >= today
  ) {
    return "구독중";
  }
  const months = parseMonthsList(generatorMonths);
  if (months.length > 0) {
    const earliest = Math.min(...months);
    if (earliest > currentMonth) return `${earliest}월 진행 예정`;
  }
  return "미시작";
}

function getMarketerState(
  aiMarketer: boolean,
  marketerMonths: string | null,
  application: { main_content_url: string | null } | null,
  currentMonth: number
): string | null {
  if (!aiMarketer) return null;
  if (application?.main_content_url) return "제출완료";
  const months = parseMonthsList(marketerMonths);
  if (months.length > 0) {
    const earliest = Math.min(...months);
    if (earliest > currentMonth) return `${earliest}월 진행 예정`;
  }
  return "미제출";
}

export async function GET(request: NextRequest) {
  const token = extractBearerToken(request);
  const adminResult = await assertAdmin(token);
  if (!adminResult.ok) {
    return NextResponse.json({}, { status: adminResult.status });
  }

  try {
    const db = getSupabaseServiceRoleClient();
    const today = getKoreaDateString();
    const currentMonth = Number(today.split("-")[1]);

    // 1. All service_grants
    const grantsRes = (await (
      db
        .from("service_grants")
        .select(
          "id, email, applicant_name, phone, host_org, mentor_org, ai_marketer, ai_generator, marketer_quantity, marketer_months, generator_months, generator_credits, status, applied_user_id, applied_at, created_at"
        )
        .order("created_at", { ascending: true }) as unknown
    )) as {
      data: Array<{
        id: string;
        email: string;
        applicant_name: string | null;
        phone: string | null;
        host_org: string | null;
        mentor_org: string | null;
        ai_marketer: boolean;
        ai_generator: boolean;
        marketer_quantity: number | null;
        marketer_months: string | null;
        generator_months: string | null;
        generator_credits: number;
        status: string;
        applied_user_id: string | null;
        applied_at: string | null;
        created_at: string;
      }> | null;
      error: { message: string } | null;
    };

    if (grantsRes.error) {
      return NextResponse.json(
        { error: "데이터를 불러오지 못했습니다." },
        { status: 500 }
      );
    }

    const grants = grantsRes.data ?? [];
    if (grants.length === 0) {
      return NextResponse.json({ rows: [] });
    }

    const normalizedGrantEmails = grants.map((g) =>
      g.email.trim().toLowerCase()
    );
    const appliedUserIds = grants
      .map((g) => g.applied_user_id)
      .filter((id): id is string => typeof id === "string");

    // 2. Profiles — signup check (Supabase Auth normalizes emails to lowercase)
    const profileEmailSet = new Set<string>();
    const profilesRes = (await (
      db
        .from("profiles")
        .select("email")
        .in("email", normalizedGrantEmails) as unknown
    )) as {
      data: Array<{ email: string | null }> | null;
      error: { message: string } | null;
    };
    for (const row of profilesRes.data ?? []) {
      if (row.email) profileEmailSet.add(row.email.trim().toLowerCase());
    }

    // 3. Subscriptions — generator active state
    const subscriptionMap = new Map<
      string,
      { start_date: string; end_date: string }
    >();
    if (appliedUserIds.length > 0) {
      const subsRes = (await (
        db
          .from("subscriptions")
          .select("user_id, start_date, end_date")
          .in("user_id", appliedUserIds)
          .eq("plan_type", POST_GENERATOR_PLAN_TYPE) as unknown
      )) as {
        data: Array<{
          user_id: string;
          start_date: string;
          end_date: string;
        }> | null;
        error: { message: string } | null;
      };
      for (const row of subsRes.data ?? []) {
        subscriptionMap.set(row.user_id, {
          start_date: row.start_date,
          end_date: row.end_date,
        });
      }
    }

    // 4. Applications — marketer state + submission detail
    //    Ordered newest-first so the first row seen per email = most recent.
    type AppRow = {
      email: string | null;
      created_at: string | null;
      marketing_channel: string | null;
      channel_url: string | null;
      main_content_url: string | null;
      industry: string | null;
      product_service: string | null;
      selected_plan: number | null;
      selected_duration: number | null;
      instagram_id: string | null;
      account_direction: string | null;
      account_bio: string | null;
      account_concept: string | null;
      manager_name: string | null;
      phone: string | null;
    };
    // submittedAppMap: most-recent application WITH main_content_url per email
    const submittedAppMap = new Map<string, AppRow>();
    // anyAppMap: most-recent application (submitted or not) per email — fallback
    const anyAppMap = new Map<string, AppRow>();
    const appsRes = (await (
      db
        .from("applications")
        .select(
          "email, created_at, marketing_channel, channel_url, main_content_url, industry, product_service, selected_plan, selected_duration, instagram_id, account_direction, account_bio, account_concept, manager_name, phone"
        )
        .in("email", normalizedGrantEmails)
        .order("created_at", { ascending: false }) as unknown
    )) as {
      data: Array<AppRow> | null;
      error: { message: string } | null;
    };
    for (const row of appsRes.data ?? []) {
      if (!row.email) continue;
      const key = row.email.trim().toLowerCase();
      if (!anyAppMap.has(key)) anyAppMap.set(key, row);
      if (row.main_content_url && !submittedAppMap.has(key)) submittedAppMap.set(key, row);
    }

    // Shape response — return only the fields the admin UI needs
    const rows = grants.map((grant) => {
      const emailKey = grant.email.trim().toLowerCase();
      const subscription = grant.applied_user_id
        ? (subscriptionMap.get(grant.applied_user_id) ?? null)
        : null;
      const submittedApp = submittedAppMap.get(emailKey) ?? null;
      const bestApp = submittedApp ?? (anyAppMap.get(emailKey) ?? null);
      // "가입": either applied_user_id is set (signed up + redeemed) OR a profiles row exists
      const isSignedUp =
        grant.applied_user_id !== null || profileEmailSet.has(emailKey);

      return {
        id: grant.id,
        email: grant.email,
        applicant_name: grant.applicant_name,
        phone: grant.phone,
        host_org: grant.host_org,
        mentor_org: grant.mentor_org,
        ai_marketer: grant.ai_marketer,
        ai_generator: grant.ai_generator,
        marketer_quantity: grant.marketer_quantity,
        marketer_months: grant.marketer_months,
        generator_months: grant.generator_months,
        generator_credits: grant.generator_credits,
        status: grant.status,
        applied_user_id: grant.applied_user_id,
        applied_at: grant.applied_at,
        created_at: grant.created_at,
        signup: isSignedUp ? "가입" : "미가입",
        generatorState: getGeneratorState(
          grant.ai_generator,
          grant.generator_months,
          subscription,
          today,
          currentMonth
        ),
        marketerState: getMarketerState(
          grant.ai_marketer,
          grant.marketer_months,
          bestApp,
          currentMonth
        ),
        marketer_submitted_at: submittedApp?.created_at ?? null,
        marketer_detail: bestApp
          ? {
              created_at: bestApp.created_at,
              marketing_channel: bestApp.marketing_channel,
              channel_url: bestApp.channel_url,
              main_content_url: bestApp.main_content_url,
              industry: bestApp.industry,
              product_service: bestApp.product_service,
              selected_plan: bestApp.selected_plan,
              selected_duration: bestApp.selected_duration,
              instagram_id: bestApp.instagram_id,
              account_direction: bestApp.account_direction,
              account_bio: bestApp.account_bio,
              account_concept: bestApp.account_concept,
              manager_name: bestApp.manager_name,
              phone: bestApp.phone,
            }
          : null,
      };
    });

    return NextResponse.json({ rows });
  } catch {
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
