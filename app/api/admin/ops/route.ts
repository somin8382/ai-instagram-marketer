import { type NextRequest, NextResponse } from "next/server";
import { assertAdmin, getSupabaseServiceRoleClient } from "@/lib/server/admin";
import { getFreeTrialConfig } from "@/lib/server/free-trial";
import { getKoreaDateString } from "@/lib/post-generator/subscription";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function startOfKoreaDayIso(dateString = getKoreaDateString()): string {
  return new Date(`${dateString}T00:00:00+09:00`).toISOString();
}

function estimatedUnitCostUsd(): number {
  const raw = process.env.AI_ESTIMATED_COST_PER_GENERATION_USD;
  const parsed = raw ? Number(raw) : NaN;
  // One post generation ≈ up to two gpt-4o-mini calls + one Gemini image call.
  // Deliberately a rough, configurable estimate for anomaly detection only.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.05;
}

type GeneratedPostRow = {
  user_id: string | null;
  created_at: string | null;
  is_free_trial: boolean | null;
};

type SubscriptionRow = {
  user_id: string | null;
  start_date: string | null;
  end_date: string | null;
  remaining_credits: number | null;
  created_at: string | null;
};

export async function GET(request: NextRequest) {
  const adminResult = await assertAdmin(extractBearerToken(request));
  if (!adminResult.ok) {
    return NextResponse.json({}, { status: adminResult.status });
  }

  try {
    const db = getSupabaseServiceRoleClient();
    const now = Date.now();
    const todayKr = getKoreaDateString();
    const todayStartIso = startOfKoreaDayIso(todayKr);
    const sevenDaysAgoIso = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgoIso = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

    // ── One dataset drives all generation-derived metrics ────────────────────
    const postsRes = (await (
      db
        .from("generated_posts")
        .select("user_id, created_at, is_free_trial")
        .gte("created_at", thirtyDaysAgoIso)
        .order("created_at", { ascending: false })
        .limit(10000) as unknown
    )) as { data: GeneratedPostRow[] | null; error: { message: string } | null };

    if (postsRes.error) {
      console.error("[/api/admin/ops] generated_posts query failed:", postsRes.error.message);
      return NextResponse.json({ error: "데이터를 불러오지 못했습니다." }, { status: 500 });
    }

    const posts = postsRes.data ?? [];
    const dau = new Set<string>();
    const wau = new Set<string>();
    const mau = new Set<string>();
    const trendMap = new Map<string, { total: number; free: number; paid: number }>();

    let genToday = 0;
    let gen7d = 0;
    let freeToday = 0;
    let paidToday = 0;
    let free30d = 0;
    let paid30d = 0;

    for (const post of posts) {
      if (!post.created_at) continue;
      const createdMs = new Date(post.created_at).getTime();
      const isFree = Boolean(post.is_free_trial);
      const withinToday = post.created_at >= todayStartIso;
      const within7d = createdMs >= now - 7 * 24 * 60 * 60 * 1000;

      if (isFree) free30d += 1;
      else paid30d += 1;

      if (post.user_id) {
        mau.add(post.user_id);
        if (within7d) wau.add(post.user_id);
        if (withinToday) dau.add(post.user_id);
      }

      if (withinToday) {
        genToday += 1;
        if (isFree) freeToday += 1;
        else paidToday += 1;
      }
      if (within7d) gen7d += 1;

      const bucket = getKoreaDateString(new Date(post.created_at));
      const entry = trendMap.get(bucket) ?? { total: 0, free: 0, paid: 0 };
      entry.total += 1;
      if (isFree) entry.free += 1;
      else entry.paid += 1;
      trendMap.set(bucket, entry);
    }

    // Last 7 Korea days, oldest → newest, zero-filled.
    const trend7d = Array.from({ length: 7 }).map((_, index) => {
      const date = getKoreaDateString(
        new Date(now - (6 - index) * 24 * 60 * 60 * 1000)
      );
      const entry = trendMap.get(date) ?? { total: 0, free: 0, paid: 0 };
      return { date, ...entry };
    });

    // ── Free-trial usage (authoritative anonymous attempts) ──────────────────
    const config = getFreeTrialConfig();
    const [freeTrialTodayRes, freeTrial7dRes] = await Promise.all([
      (db.from("anonymous_free_trial_usage").select("*", { count: "exact", head: true }).gte("used_at", todayStartIso) as unknown) as Promise<{ count: number | null; error: { message: string } | null }>,
      (db.from("anonymous_free_trial_usage").select("*", { count: "exact", head: true }).gte("used_at", sevenDaysAgoIso) as unknown) as Promise<{ count: number | null; error: { message: string } | null }>,
    ]);
    const freeTrialUsedToday = freeTrialTodayRes.error ? null : freeTrialTodayRes.count ?? 0;

    // ── Subscriptions ────────────────────────────────────────────────────────
    const subsRes = (await (
      db
        .from("subscriptions")
        .select("user_id, start_date, end_date, remaining_credits, created_at")
        .eq("plan_type", "post_generator") as unknown
    )) as { data: SubscriptionRow[] | null; error: { message: string } | null };
    const subs = subsRes.error ? [] : subsRes.data ?? [];
    let activeSubs = 0;
    let remainingCreditsSum = 0;
    let subsStartedToday = 0;
    let subsStarted7d = 0;
    for (const sub of subs) {
      const isActive =
        !!sub.start_date && !!sub.end_date && sub.start_date <= todayKr && sub.end_date >= todayKr;
      if (isActive) {
        activeSubs += 1;
        remainingCreditsSum += Math.max(Number(sub.remaining_credits ?? 0), 0);
      }
      if (sub.start_date === todayKr) subsStartedToday += 1;
      if (sub.created_at && sub.created_at >= sevenDaysAgoIso) subsStarted7d += 1;
    }

    // ── Signups (profiles) ───────────────────────────────────────────────────
    const [usersTotalRes, signupsTodayRes, signups7dRes] = await Promise.all([
      (db.from("profiles").select("*", { count: "exact", head: true }) as unknown) as Promise<{ count: number | null; error: { message: string } | null }>,
      (db.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", todayStartIso) as unknown) as Promise<{ count: number | null; error: { message: string } | null }>,
      (db.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", sevenDaysAgoIso) as unknown) as Promise<{ count: number | null; error: { message: string } | null }>,
    ]);

    const unitUsd = estimatedUnitCostUsd();

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      today: todayKr,
      activity: {
        dau: dau.size,
        wau: wau.size,
        mau: mau.size,
        totalUsers: usersTotalRes.error ? null : usersTotalRes.count ?? 0,
        newSignupsToday: signupsTodayRes.error ? null : signupsTodayRes.count ?? 0,
        newSignups7d: signups7dRes.error ? null : signups7dRes.count ?? 0,
      },
      aiUsage: {
        generationsToday: genToday,
        generations7d: gen7d,
        generations30d: posts.length,
        freeToday,
        paidToday,
        free30d,
        paid30d,
        capped: posts.length >= 10000,
      },
      freeTrial: {
        usedToday: freeTrialUsedToday,
        used7d: freeTrial7dRes.error ? null : freeTrial7dRes.count ?? 0,
        dailyBudget: config.globalDailyBudget,
        remainingBudget:
          freeTrialUsedToday === null
            ? null
            : Math.max(config.globalDailyBudget - freeTrialUsedToday, 0),
        perIpLimit: config.maxPerIpPerDay,
      },
      subscriptions: {
        active: activeSubs,
        remainingCreditsSum,
        startedToday: subsStartedToday,
        started7d: subsStarted7d,
      },
      cost: {
        unitUsd,
        estTodayUsd: Number((genToday * unitUsd).toFixed(2)),
        est30dUsd: Number((posts.length * unitUsd).toFixed(2)),
      },
      trend7d,
    });
  } catch (error) {
    console.error("[/api/admin/ops] failed:", error);
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
