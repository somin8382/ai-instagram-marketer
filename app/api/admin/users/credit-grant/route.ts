import { type NextRequest, NextResponse } from "next/server";
import { assertAdmin, getSupabaseServiceRoleClient } from "@/lib/server/admin";
import {
  addMonthsToKoreaDateString,
  getKoreaDateString,
} from "@/lib/post-generator/subscription";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

// POST /api/admin/users/credit-grant — grant bonus generation credits.
// Credits are applied directly to subscriptions.remaining_credits (the single
// source of truth used by both the user UI and the generation gate). If the
// user has no active subscription, a 1-month subscription is created carrying
// the granted credits so the bonus is usable immediately.
export async function POST(request: NextRequest) {
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

  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const amount = Number(body.amount);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!userId) {
    return NextResponse.json({ error: "userId가 필요합니다." }, { status: 400 });
  }
  if (!Number.isInteger(amount) || amount <= 0 || amount > 1000) {
    return NextResponse.json(
      { error: "지급 수량은 1~1000 사이의 정수여야 합니다." },
      { status: 400 }
    );
  }

  try {
    const db = getSupabaseServiceRoleClient();
    const todayKr = getKoreaDateString();

    // 1. Apply credits to the live subscription (or create one)
    const subRes = (await (
      db
        .from("subscriptions")
        .select("id, start_date, end_date, remaining_credits")
        .eq("user_id", userId)
        .eq("plan_type", "post_generator")
        .maybeSingle() as unknown
    )) as {
      data: {
        id: string;
        start_date: string;
        end_date: string;
        remaining_credits: number;
      } | null;
      error: { message: string } | null;
    };

    if (subRes.error) {
      return NextResponse.json(
        { error: "구독 정보를 확인하지 못했습니다." },
        { status: 500 }
      );
    }

    const sub = subRes.data;
    const isActive =
      !!sub && sub.start_date <= todayKr && sub.end_date >= todayKr;

    let applied: "added" | "subscription_created";
    if (isActive && sub) {
      // Atomic adjust via RPC (no race with concurrent consumption)
      const adjustRes = (await (db.rpc("adjust_post_generator_credits" as never, {
        p_user_id: userId,
        p_delta: amount,
      } as never) as unknown)) as {
        data: number | null;
        error: { message: string } | null;
      };
      if (adjustRes.error) {
        return NextResponse.json(
          { error: "크레딧 적용에 실패했습니다." },
          { status: 500 }
        );
      }
      applied = "added";
    } else {
      // Expired or missing subscription: (re)issue a 1-month window carrying
      // exactly the granted amount, without touching payment records.
      const upsertRes = (await (
        db.from("subscriptions").upsert(
          {
            user_id: userId,
            plan_type: "post_generator",
            start_date: todayKr,
            end_date: addMonthsToKoreaDateString(todayKr, 1),
            remaining_credits: amount,
            daily_usage_count: 0,
            last_usage_date: null,
          } as never,
          { onConflict: "user_id,plan_type" }
        ) as unknown
      )) as { error: { message: string } | null };
      if (upsertRes.error) {
        return NextResponse.json(
          { error: "구독 생성에 실패했습니다." },
          { status: 500 }
        );
      }
      applied = "subscription_created";
    }

    // 2. Record the grant (drives the one-time user popup + audit history)
    const insertRes = (await (
      db.from("credit_grants").insert({
        user_id: userId,
        email: email || null,
        amount,
        reason: reason || null,
        message: message || null,
        granted_by: adminResult.email,
      } as never) as unknown
    )) as { error: { message: string } | null };

    if (insertRes.error) {
      // Credits were applied; surface the record failure honestly
      console.error(
        "[/api/admin/users/credit-grant] history insert failed:",
        insertRes.error.message
      );
      return NextResponse.json(
        {
          ok: true,
          applied,
          warning: "크레딧은 지급되었으나 지급 이력 저장에 실패했습니다.",
        },
        { status: 200 }
      );
    }

    console.info(
      "[/api/admin/users/credit-grant] granted:",
      JSON.stringify({ userId, amount, applied, by: adminResult.email })
    );
    return NextResponse.json({ ok: true, applied });
  } catch (error) {
    console.error("[/api/admin/users/credit-grant] failed:", error);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
