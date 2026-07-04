import { type NextRequest, NextResponse } from "next/server";
import { assertAdmin, getSupabaseServiceRoleClient } from "@/lib/server/admin";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
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

    // Fetch generated posts (by resolved userId)
    let posts: GeneratedPostRow[] = [];
    if (actualUserId) {
      const postsRes = (await (
        db
          .from("generated_posts")
          .select("*")
          .eq("user_id", actualUserId)
          .order("created_at", { ascending: false })
          .limit(50) as unknown
      )) as { data: GeneratedPostRow[]; error: { message: string } | null };
      posts = postsRes.error ? [] : postsRes.data || [];
    }

    // Fetch free-trial usage (if we have an IP hash, we can't query it directly without the hash,
    // so we just report that this feature exists)
    // For now, just note that we'd need to add more detailed logging to capture block reasons.

    // Calculate metrics
    const totalGenerations = posts.length;
    const freeTrialGenerations = posts.filter((p) => p.is_free_trial).length;
    const paidGenerations = totalGenerations - freeTrialGenerations;
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
