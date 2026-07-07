import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleClient, parseMonthsList } from "@/lib/server/admin";
import {
  addMonthsToKoreaDateString,
  getKoreaDateString,
  POST_GENERATOR_MONTHLY_CREDITS,
  POST_GENERATOR_PLAN_TYPE,
} from "@/lib/post-generator/subscription";
import type { Database } from "@/lib/supabase/types";

// Subscription start endpoint (service role) — replaces the browser-side
// subscriptions upsert so credit amounts are decided ONLY on the server:
// - "grant_redeem": credits come from the caller's service_grants row
//   (ai_generator enabled + current Korea month in generator_months).
// - "monthly_start": the existing honor-system monthly start with the fixed
//   default credit amount (behavior preserved; payment remains manual).
// The browser write policies on subscriptions are dropped, so this endpoint
// is the only non-admin path that creates or refreshes a subscription.

type SubscriptionRow = {
  id: string;
  user_id: string;
  plan_type: string;
  start_date: string;
  end_date: string;
  remaining_credits: number;
  daily_usage_count: number;
  last_usage_date: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const SELECT_COLUMNS =
  "id, user_id, plan_type, start_date, end_date, remaining_credits, daily_usage_count, last_usage_date, created_at, updated_at";

export async function POST(request: NextRequest) {
  let body: { accessToken?: string | null; mode?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { subscription: null, error: "요청 형식이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const mode = body.mode === "grant_redeem" ? "grant_redeem" : "monthly_start";
  const accessToken =
    typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  if (!accessToken) {
    return NextResponse.json(
      { subscription: null, error: "로그인 후 구독을 시작해주세요." },
      { status: 401 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { subscription: null, error: "서비스 설정을 확인해주세요." },
      { status: 500 }
    );
  }
  const authClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(accessToken);
  if (authError || !user) {
    return NextResponse.json(
      { subscription: null, error: "로그인 정보가 만료되었습니다. 다시 로그인해주세요." },
      { status: 401 }
    );
  }

  try {
    const db = getSupabaseServiceRoleClient();
    const todayKr = getKoreaDateString();

    // Existing active subscription → benign no-op (same message as before)
    const currentRes = (await (
      db
        .from("subscriptions")
        .select(SELECT_COLUMNS)
        .eq("user_id", user.id)
        .eq("plan_type", POST_GENERATOR_PLAN_TYPE)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle() as unknown
    )) as { data: SubscriptionRow | null; error: { message: string } | null };

    if (currentRes.error) {
      return NextResponse.json(
        { subscription: null, error: "구독 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요." },
        { status: 500 }
      );
    }
    const current = currentRes.data;
    if (
      current &&
      current.start_date <= todayKr &&
      current.end_date >= todayKr
    ) {
      return NextResponse.json({
        subscription: current,
        error: "이미 활성화된 구독입니다. 남은 생성 횟수를 먼저 사용해주세요.",
      });
    }

    // Server decides the credit amount — never the client.
    let credits = POST_GENERATOR_MONTHLY_CREDITS;
    if (mode === "grant_redeem") {
      const email = (user.email ?? "").trim().toLowerCase();
      if (!email) {
        return NextResponse.json(
          { subscription: null, error: "등록된 이메일이 없습니다." },
          { status: 403 }
        );
      }
      const grantRes = (await (
        db
          .from("service_grants")
          .select("ai_generator, generator_months, generator_credits")
          .ilike("email", email)
          .maybeSingle() as unknown
      )) as {
        data: {
          ai_generator: boolean;
          generator_months: string | null;
          generator_credits: number;
        } | null;
        error: { message: string } | null;
      };
      const grant = grantRes.error ? null : grantRes.data;
      const currentMonth = Number(todayKr.split("-")[1]);
      if (
        !grant ||
        !grant.ai_generator ||
        !parseMonthsList(grant.generator_months).includes(currentMonth)
      ) {
        return NextResponse.json(
          { subscription: null, error: "이용 가능한 제공 내역이 없습니다." },
          { status: 403 }
        );
      }
      credits = Math.max(Number(grant.generator_credits) || 0, 0) ||
        POST_GENERATOR_MONTHLY_CREDITS;
    }

    const upsertRes = (await (
      db
        .from("subscriptions")
        .upsert(
          {
            user_id: user.id,
            plan_type: POST_GENERATOR_PLAN_TYPE,
            start_date: todayKr,
            end_date: addMonthsToKoreaDateString(todayKr, 1),
            remaining_credits: credits,
            daily_usage_count: 0,
            last_usage_date: null,
          } as never,
          { onConflict: "user_id,plan_type" }
        )
        .select(SELECT_COLUMNS)
        .single() as unknown
    )) as { data: SubscriptionRow | null; error: { message: string } | null };

    if (upsertRes.error || !upsertRes.data) {
      console.error(
        "[/api/subscriptions/start] upsert failed:",
        upsertRes.error?.message
      );
      return NextResponse.json(
        { subscription: null, error: "구독을 시작하지 못했습니다. 잠시 후 다시 시도해주세요." },
        { status: 500 }
      );
    }

    console.info(
      "[/api/subscriptions/start] started:",
      JSON.stringify({ userId: user.id, mode, credits })
    );
    return NextResponse.json({ subscription: upsertRes.data, error: null });
  } catch (error) {
    console.error("[/api/subscriptions/start] failed:", error);
    return NextResponse.json(
      { subscription: null, error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
