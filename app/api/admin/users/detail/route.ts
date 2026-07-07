import { type NextRequest, NextResponse } from "next/server";
import { assertAdmin, getSupabaseServiceRoleClient } from "@/lib/server/admin";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

// Earliest (min) of several ISO timestamps, ignoring null/invalid.
function earliestIso(...values: Array<string | null | undefined>): string | null {
  let min: string | null = null;
  let minT = Infinity;
  for (const v of values) {
    if (!v) continue;
    const t = new Date(v).getTime();
    if (Number.isFinite(t) && t < minT) {
      minT = t;
      min = v;
    }
  }
  return min;
}

type ProfileRow = Record<string, unknown>;
type ApplicationRow = Record<string, unknown>;
type SubscriptionRow = Record<string, unknown>;
type GeneratedPostRow = Record<string, unknown>;

export async function GET(request: NextRequest) {
  const adminResult = await assertAdmin(extractBearerToken(request));
  if (!adminResult.ok) {
    return NextResponse.json({}, { status: adminResult.status });
  }

  const userId = request.nextUrl.searchParams.get("userId");
  const email = request.nextUrl.searchParams.get("email");

  if (!userId && !email) {
    return NextResponse.json({ error: "userId or email required" }, { status: 400 });
  }

  try {
    const db = getSupabaseServiceRoleClient();

    // Fetch profile
    const profileRes = (await (
      userId
        ? db.from("profiles").select("*").eq("id", userId).maybeSingle()
        : db
            .from("profiles")
            .select("*")
            .ilike("email", email || "")
            .maybeSingle()
    ) as unknown) as { data: ProfileRow; error: { message: string } | null };

    const profile = profileRes.error ? null : profileRes.data;

    // Fetch subscriptions (by resolved userId)
    const actualUserId = userId || (profile as ProfileRow)?.id;
    let subscription: SubscriptionRow | null = null;

    if (actualUserId) {
      const subRes = (await (
        db
          .from("subscriptions")
          .select("*")
          .eq("user_id", actualUserId)
          .eq("plan_type", "post_generator")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle() as unknown
      )) as { data: SubscriptionRow; error: { message: string } | null };
      subscription = subRes.error ? null : subRes.data;
    }

    // Fetch applications (by email or user_id)
    const emailToSearch = (profile as ProfileRow)?.email || email;
    const appRes = (await (
      db
        .from("applications")
        .select("*")
        .or(
          actualUserId
            ? `user_id.eq.${actualUserId}`
            : emailToSearch
              ? `email.ilike.${emailToSearch}`
              : ""
        )
        .order("created_at", { ascending: false })
        .limit(5) as unknown
    )) as { data: ApplicationRow[]; error: { message: string } | null };

    const applications = appRes.error ? [] : appRes.data || [];

    // Fetch generated posts (by resolved userId). count is exact so usage
    // totals stay correct even though the returned list is capped at 50.
    let posts: GeneratedPostRow[] = [];
    let postsTotalCount = 0;
    if (actualUserId) {
      const postsRes = (await (
        db
          .from("generated_posts")
          .select("*", { count: "exact" })
          .eq("user_id", actualUserId)
          .order("created_at", { ascending: false })
          .limit(50) as unknown
      )) as {
        data: GeneratedPostRow[];
        count: number | null;
        error: { message: string } | null;
      };
      posts = postsRes.error ? [] : postsRes.data || [];
      postsTotalCount = postsRes.error ? 0 : (postsRes.count ?? posts.length);
    }

    // Login history (full, newest first) + auth metadata for first/latest login
    let loginHistory: Array<{ occurredAt: string; eventType: string }> = [];
    let loginCount = 0;
    let authLastSignInAt: string | null = null;
    let authCreatedAt: string | null = null;
    if (actualUserId) {
      const loginsRes = (await (
        db
          .from("login_events")
          .select("occurred_at, event_type", { count: "exact" })
          .eq("user_id", actualUserId)
          .order("occurred_at", { ascending: false })
          .limit(200) as unknown
      )) as {
        data: Array<{ occurred_at: string; event_type: string }> | null;
        count: number | null;
        error: { message: string } | null;
      };
      if (!loginsRes.error && loginsRes.data) {
        loginHistory = loginsRes.data.map((row) => ({
          occurredAt: row.occurred_at,
          eventType: row.event_type,
        }));
        loginCount = loginsRes.count ?? loginsRes.data.length;
      }

      try {
        const { data: authUser } = await db.auth.admin.getUserById(
          actualUserId as string
        );
        authLastSignInAt = authUser?.user?.last_sign_in_at ?? null;
        authCreatedAt = authUser?.user?.created_at ?? null;
      } catch {
        // Non-fatal: auth metadata simply omitted
      }
    }

    // 최초 접속일 (first-access, distinct from signup) + 접속 횟수.
    // Earliest across login/visit events, first generation, and first
    // application — accurate (dedicated asc queries), never the signup date.
    let firstAccessAt: string | null = null;
    const accessCount: number | null = loginCount > 0 ? loginCount : null;
    if (actualUserId) {
      const orFilter = emailToSearch
        ? `user_id.eq.${actualUserId},email.ilike.${emailToSearch}`
        : `user_id.eq.${actualUserId}`;
      const [earliestLoginRes, earliestPostRes, earliestAppRes] =
        await Promise.all([
          (db
            .from("login_events")
            .select("occurred_at")
            .eq("user_id", actualUserId)
            .order("occurred_at", { ascending: true })
            .limit(1)
            .maybeSingle() as unknown) as Promise<{
            data: { occurred_at: string | null } | null;
            error: { message: string } | null;
          }>,
          (db
            .from("generated_posts")
            .select("created_at")
            .eq("user_id", actualUserId)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle() as unknown) as Promise<{
            data: { created_at: string | null } | null;
            error: { message: string } | null;
          }>,
          (db
            .from("applications")
            .select("created_at")
            .or(orFilter)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle() as unknown) as Promise<{
            data: { created_at: string | null } | null;
            error: { message: string } | null;
          }>,
        ]);
      firstAccessAt = earliestIso(
        earliestLoginRes.error ? null : earliestLoginRes.data?.occurred_at,
        earliestPostRes.error ? null : earliestPostRes.data?.created_at,
        earliestAppRes.error ? null : earliestAppRes.data?.created_at
      );
    } else if (email) {
      // 미가입 lookup by email: application submission is the only evidence.
      const earliestAppRes = (await (
        db
          .from("applications")
          .select("created_at")
          .ilike("email", email)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle() as unknown
      )) as {
        data: { created_at: string | null } | null;
        error: { message: string } | null;
      };
      firstAccessAt = earliestAppRes.error
        ? null
        : (earliestAppRes.data?.created_at ?? null);
    }

    // Service grant (registration/org info) by email
    const grantEmail = ((profile as ProfileRow)?.email as string | null) || email;
    let grant: Record<string, unknown> | null = null;
    if (grantEmail) {
      const grantRes = (await (
        db
          .from("service_grants")
          .select("*")
          .ilike("email", grantEmail)
          .maybeSingle() as unknown
      )) as {
        data: Record<string, unknown> | null;
        error: { message: string } | null;
      };
      if (!grantRes.error) grant = grantRes.data;
    }

    // Credit grants + generation logs (tolerate missing tables pre-migration)
    let creditGrants: Array<Record<string, unknown>> = [];
    let generationLogs: Array<Record<string, unknown>> = [];
    if (actualUserId) {
      const [creditRes, logsRes] = await Promise.all([
        (db
          .from("credit_grants")
          .select("*")
          .eq("user_id", actualUserId)
          .order("created_at", { ascending: false })
          .limit(50) as unknown) as Promise<{
          data: Array<Record<string, unknown>> | null;
          error: { message: string } | null;
        }>,
        (db
          .from("generation_logs")
          .select("*")
          .eq("user_id", actualUserId)
          .order("created_at", { ascending: false })
          .limit(100) as unknown) as Promise<{
          data: Array<Record<string, unknown>> | null;
          error: { message: string } | null;
        }>,
      ]);
      if (!creditRes.error && creditRes.data) creditGrants = creditRes.data;
      if (!logsRes.error && logsRes.data) generationLogs = logsRes.data;
    }

    // Calculate metrics (free/paid split is derived from the 50 returned rows;
    // the total uses the exact count)
    const totalGenerations = postsTotalCount;
    const freeTrialGenerations = posts.filter((p) => p.is_free_trial).length;
    const paidGenerations = Math.max(totalGenerations - freeTrialGenerations, 0);
    const latestPost = posts[0] || null;
    const latestCreatedAt = latestPost?.created_at;

    const profileData = profile as ProfileRow;
    const subscriptionData = subscription as SubscriptionRow;
    const latestPostData = latestPost as GeneratedPostRow;

    return NextResponse.json({
      user: {
        id: actualUserId || null,
        email: (profileData?.email as string | null) || email || null,
        name: (profileData?.name as string | null) || null,
        createdAt: (profileData?.created_at as string | null) || null,
        companyName: (profileData?.company_name as string | null) || null,
        instagramUrl: (profileData?.instagram_url as string | null) || null,
        youtubeUrl: (profileData?.youtube_url as string | null) || null,
        accountOnboardedAt: (profileData?.account_onboarded_at as string | null) || null,
      },
      subscription: subscription ? {
        id: subscriptionData.id as string,
        startDate: subscriptionData.start_date as string,
        endDate: subscriptionData.end_date as string,
        remainingCredits: subscriptionData.remaining_credits as number,
        dailyUsageCount: subscriptionData.daily_usage_count as number,
        lastUsageDate: (subscriptionData.last_usage_date as string | null) || null,
        createdAt: subscriptionData.created_at as string,
        updatedAt: subscriptionData.updated_at as string,
        isActive: (subscriptionData.start_date as string) <= new Date().toISOString().split("T")[0] && (subscriptionData.end_date as string) >= new Date().toISOString().split("T")[0],
      } : null,
      applications,
      grant,
      creditGrants,
      generationLogs,
      loginStats: {
        count: loginCount,
        firstLoginAt:
          loginHistory.length > 0
            ? loginHistory[loginHistory.length - 1].occurredAt
            : authCreatedAt,
        lastLoginAt:
          [authLastSignInAt, loginHistory[0]?.occurredAt]
            .filter(Boolean)
            .sort()
            .pop() ?? null,
        authLastSignInAt,
        authCreatedAt,
      },
      accessStats: {
        firstAccessAt,
        accessCount,
      },
      loginHistory,
      aiUsage: {
        totalGenerations,
        freeTrialGenerations,
        paidGenerations,
        latestGeneratedAt: latestCreatedAt,
        latestTitle: (latestPostData?.title as string | null) || null,
      },
      posts: posts.map((p) => ({
        id: p.id as string,
        title: p.title as string,
        createdAt: p.created_at as string,
        isFreeTrial: p.is_free_trial as boolean,
      })),
    });
  } catch (error) {
    console.error("[/api/admin/users/detail] failed:", error);
    return NextResponse.json({ error: "Failed to fetch user details" }, { status: 500 });
  }
}
