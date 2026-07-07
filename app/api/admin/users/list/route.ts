import { type NextRequest, NextResponse } from "next/server";
import { assertAdmin, getSupabaseServiceRoleClient } from "@/lib/server/admin";
import { getKoreaDateString } from "@/lib/post-generator/subscription";

function extractBearerToken(request: NextRequest): string {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

// Earliest (min) of several ISO timestamps, ignoring null/invalid. Used to
// derive 최초 접속일 from all available access evidence.
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

const POSTS_CAP = 20000;
const LOGIN_EVENTS_CAP = 50000;

type ProfileRow = {
  id: string;
  email: string | null;
  name: string | null;
  company_name: string | null;
  brand_name: string | null;
  industry: string | null;
  created_at: string | null;
  account_onboarded_at: string | null;
};

type SubscriptionRow = {
  user_id: string;
  start_date: string;
  end_date: string;
  remaining_credits: number;
};

type GrantRow = {
  id: string;
  email: string;
  applicant_name: string | null;
  phone: string | null;
  host_org: string | null;
  mentor_org: string | null;
  ai_marketer: boolean;
  ai_generator: boolean;
  created_at: string | null;
};

// GET /api/admin/users/list — every signed-up user PLUS pre-registered
// (grant-only, 미가입) emails, with operational stats. One aggregated payload;
// filtering/sorting happens client-side (user counts are in the hundreds).
export async function GET(request: NextRequest) {
  const adminResult = await assertAdmin(extractBearerToken(request));
  if (!adminResult.ok) {
    return NextResponse.json({}, { status: adminResult.status });
  }

  try {
    const db = getSupabaseServiceRoleClient();
    const todayKr = getKoreaDateString();

    const [
      profilesRes,
      subsRes,
      postsRes,
      loginsRes,
      grantsRes,
      appsRes,
      paymentsRes,
      inquiriesRes,
    ] = await Promise.all([
      (db
        .from("profiles")
        .select(
          "id, email, name, company_name, brand_name, industry, created_at, account_onboarded_at"
        ) as unknown) as Promise<{
        data: ProfileRow[] | null;
        error: { message: string } | null;
      }>,
      (db
        .from("subscriptions")
        .select("user_id, start_date, end_date, remaining_credits")
        .eq("plan_type", "post_generator") as unknown) as Promise<{
        data: SubscriptionRow[] | null;
        error: { message: string } | null;
      }>,
      (db
        .from("generated_posts")
        .select("user_id, created_at, is_free_trial")
        .not("user_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(POSTS_CAP) as unknown) as Promise<{
        data: Array<{
          user_id: string | null;
          created_at: string | null;
          is_free_trial: boolean | null;
        }> | null;
        error: { message: string } | null;
      }>,
      (db
        .from("login_events")
        .select("user_id, occurred_at")
        .order("occurred_at", { ascending: false })
        .limit(LOGIN_EVENTS_CAP) as unknown) as Promise<{
        data: Array<{ user_id: string; occurred_at: string }> | null;
        error: { message: string } | null;
      }>,
      (db
        .from("service_grants")
        .select(
          "id, email, applicant_name, phone, host_org, mentor_org, ai_marketer, ai_generator, created_at"
        ) as unknown) as Promise<{
        data: GrantRow[] | null;
        error: { message: string } | null;
      }>,
      (db
        .from("applications")
        .select("id, user_id, email, main_content_url, created_at")
        .order("created_at", { ascending: false })
        .limit(POSTS_CAP) as unknown) as Promise<{
        data: Array<{
          id: string;
          user_id: string | null;
          email: string | null;
          main_content_url: string | null;
          created_at: string | null;
        }> | null;
        error: { message: string } | null;
      }>,
      (db
        .from("payments")
        .select("application_id, payment_status")
        .eq("payment_status", "confirmed") as unknown) as Promise<{
        data: Array<{ application_id: string | null }> | null;
        error: { message: string } | null;
      }>,
      // Tolerate a missing inquiries table (migration not applied yet)
      (db
        .from("inquiries")
        .select("user_id, status") as unknown) as Promise<{
        data: Array<{ user_id: string; status: string }> | null;
        error: { message: string } | null;
      }>,
    ]);

    if (profilesRes.error) {
      console.error(
        "[/api/admin/users/list] profiles query failed:",
        profilesRes.error.message
      );
      return NextResponse.json(
        { error: "데이터를 불러오지 못했습니다." },
        { status: 500 }
      );
    }

    // Auth metadata: last_sign_in_at is the authoritative latest login even
    // before login_events accumulates history. Non-fatal if unavailable.
    const authLastSignIn = new Map<string, string | null>();
    try {
      let page = 1;
      for (;;) {
        const { data, error } = await db.auth.admin.listUsers({
          page,
          perPage: 1000,
        });
        if (error || !data?.users?.length) break;
        for (const u of data.users) {
          authLastSignIn.set(u.id, u.last_sign_in_at ?? null);
        }
        if (data.users.length < 1000) break;
        page += 1;
      }
    } catch (error) {
      console.warn("[/api/admin/users/list] listUsers failed:", error);
    }

    const subsByUser = new Map<string, SubscriptionRow>();
    for (const sub of subsRes.data ?? []) {
      subsByUser.set(sub.user_id, sub);
    }

    const postStats = new Map<
      string,
      { total: number; free: number; last: string | null; first: string | null }
    >();
    for (const post of postsRes.data ?? []) {
      if (!post.user_id) continue;
      const entry =
        postStats.get(post.user_id) ??
        { total: 0, free: 0, last: null, first: null };
      entry.total += 1;
      if (post.is_free_trial) entry.free += 1;
      // rows are ordered newest-first, so the first one seen is the latest and
      // the last one seen (final overwrite) is the earliest.
      if (!entry.last) entry.last = post.created_at;
      if (post.created_at) entry.first = post.created_at;
      postStats.set(post.user_id, entry);
    }

    const loginStats = new Map<
      string,
      { count: number; first: string | null; last: string | null }
    >();
    for (const event of loginsRes.data ?? []) {
      const entry =
        loginStats.get(event.user_id) ?? { count: 0, first: null, last: null };
      entry.count += 1;
      if (!entry.last) entry.last = event.occurred_at; // newest-first
      entry.first = event.occurred_at; // last one seen = oldest
      loginStats.set(event.user_id, entry);
    }

    const grantsByEmail = new Map<string, GrantRow>();
    for (const grant of grantsRes.data ?? []) {
      grantsByEmail.set(grant.email.trim().toLowerCase(), grant);
    }

    // Marketer submission + paid-marketer detection from applications/payments.
    // Also track the earliest application per user/email as access evidence
    // (submitting an application means the person accessed the site).
    const submittedByUser = new Map<string, string | null>();
    const submittedByEmail = new Map<string, string | null>();
    const firstAppByUser = new Map<string, string | null>();
    const firstAppByEmail = new Map<string, string | null>();
    const appById = new Map<
      string,
      { user_id: string | null; email: string | null }
    >();
    for (const app of appsRes.data ?? []) {
      appById.set(app.id, { user_id: app.user_id, email: app.email });
      const emailKey = app.email?.trim().toLowerCase();
      // rows are newest-first → final overwrite per key is the earliest
      if (app.created_at) {
        if (app.user_id) firstAppByUser.set(app.user_id, app.created_at);
        if (emailKey) firstAppByEmail.set(emailKey, app.created_at);
      }
      if (!app.main_content_url) continue;
      if (app.user_id && !submittedByUser.has(app.user_id)) {
        submittedByUser.set(app.user_id, app.created_at);
      }
      if (emailKey && !submittedByEmail.has(emailKey)) {
        submittedByEmail.set(emailKey, app.created_at);
      }
    }

    // Users/emails with a confirmed marketer payment
    const paidMarketerUsers = new Set<string>();
    const paidMarketerEmails = new Set<string>();
    for (const payment of paymentsRes.data ?? []) {
      if (!payment.application_id) continue;
      const app = appById.get(payment.application_id);
      if (!app) continue;
      if (app.user_id) paidMarketerUsers.add(app.user_id);
      const emailKey = app.email?.trim().toLowerCase();
      if (emailKey) paidMarketerEmails.add(emailKey);
    }

    // Open/any inquiry counts per user (0 when table missing)
    const inquiryCounts = new Map<string, { total: number; open: number }>();
    if (!inquiriesRes.error) {
      for (const inquiry of inquiriesRes.data ?? []) {
        const entry =
          inquiryCounts.get(inquiry.user_id) ?? { total: 0, open: 0 };
        entry.total += 1;
        if (inquiry.status === "open") entry.open += 1;
        inquiryCounts.set(inquiry.user_id, entry);
      }
    }

    const profileEmails = new Set<string>();
    const users = (profilesRes.data ?? []).map((profile) => {
      const emailKey = profile.email?.trim().toLowerCase() ?? "";
      if (emailKey) profileEmails.add(emailKey);
      const grant = emailKey ? (grantsByEmail.get(emailKey) ?? null) : null;
      const sub = subsByUser.get(profile.id) ?? null;
      const posts = postStats.get(profile.id) ?? null;
      const logins = loginStats.get(profile.id) ?? null;
      const authLast = authLastSignIn.get(profile.id) ?? null;
      const inquiries = inquiryCounts.get(profile.id) ?? null;

      const subscriptionActive =
        !!sub && sub.start_date <= todayKr && sub.end_date >= todayKr;
      const aiMarketerSub =
        (grant?.ai_marketer ?? false) ||
        paidMarketerUsers.has(profile.id) ||
        (emailKey ? paidMarketerEmails.has(emailKey) : false);

      const marketerSubmittedAt =
        submittedByUser.get(profile.id) ??
        (emailKey ? (submittedByEmail.get(emailKey) ?? null) : null);

      // Latest login: prefer auth metadata (complete), fall back to events
      const lastLoginAt =
        [authLast, logins?.last].filter(Boolean).sort().pop() ?? null;
      const lastActivityAt =
        [lastLoginAt, posts?.last].filter(Boolean).sort().pop() ?? null;

      // 최초 접속일: earliest access evidence — login/visit events, first
      // generation, or first application. Never the signup date. Backfills
      // pre-tracking users from posts/applications where available.
      const firstAppAt =
        firstAppByUser.get(profile.id) ??
        (emailKey ? (firstAppByEmail.get(emailKey) ?? null) : null);
      const firstAccessAt = earliestIso(
        logins?.first ?? null,
        posts?.first ?? null,
        firstAppAt
      );
      // 접속 횟수: total recorded access events; null (표시 "-") when tracking
      // has no events for this user.
      const accessCount = logins ? logins.count : null;

      return {
        id: profile.id,
        signedUp: true,
        email: profile.email,
        name: profile.name ?? grant?.applicant_name ?? null,
        companyName: profile.company_name,
        brandName: profile.brand_name,
        industry: profile.industry,
        phone: grant?.phone ?? null,
        hostOrg: grant?.host_org ?? null,
        mentorOrg: grant?.mentor_org ?? null,
        aiMarketer: grant?.ai_marketer ?? false,
        aiGenerator: grant?.ai_generator ?? false,
        aiMarketerSub,
        aiGeneratorSub: subscriptionActive,
        freeUser: !aiMarketerSub && !subscriptionActive,
        createdAt: profile.created_at,
        onboardedAt: profile.account_onboarded_at,
        subscriptionActive,
        subscriptionEndDate: sub?.end_date ?? null,
        remainingCredits: subscriptionActive ? sub!.remaining_credits : null,
        aiGenerationCount: posts?.total ?? 0,
        freeTrialCount: posts?.free ?? 0,
        lastGeneratedAt: posts?.last ?? null,
        loginCount: logins?.count ?? 0,
        firstLoginAt: logins?.first ?? null,
        firstAccessAt,
        accessCount,
        lastLoginAt,
        lastActivityAt,
        marketerSubmitted: marketerSubmittedAt !== null,
        marketerSubmittedAt,
        inquiryCount: inquiries?.total ?? 0,
        openInquiryCount: inquiries?.open ?? 0,
      };
    });

    // Pre-registered (grant-only) emails that never signed up → 미가입 rows
    for (const grant of grantsRes.data ?? []) {
      const emailKey = grant.email.trim().toLowerCase();
      if (profileEmails.has(emailKey)) continue;
      const marketerSubmittedAt = submittedByEmail.get(emailKey) ?? null;
      // 미가입 users never logged in; their only access evidence is an
      // application submission (if any).
      const preFirstAccessAt = firstAppByEmail.get(emailKey) ?? null;
      users.push({
        id: `grant_${grant.id}`,
        signedUp: false,
        email: grant.email,
        name: grant.applicant_name,
        companyName: null,
        brandName: null,
        industry: null,
        phone: grant.phone,
        hostOrg: grant.host_org,
        mentorOrg: grant.mentor_org,
        aiMarketer: grant.ai_marketer,
        aiGenerator: grant.ai_generator,
        aiMarketerSub: grant.ai_marketer || paidMarketerEmails.has(emailKey),
        aiGeneratorSub: false,
        freeUser: !grant.ai_marketer && !paidMarketerEmails.has(emailKey),
        createdAt: grant.created_at,
        onboardedAt: null,
        subscriptionActive: false,
        subscriptionEndDate: null,
        remainingCredits: null,
        aiGenerationCount: 0,
        freeTrialCount: 0,
        lastGeneratedAt: null,
        loginCount: 0,
        firstLoginAt: null,
        firstAccessAt: preFirstAccessAt,
        accessCount: null,
        lastLoginAt: null,
        lastActivityAt: null,
        marketerSubmitted: marketerSubmittedAt !== null,
        marketerSubmittedAt,
        inquiryCount: 0,
        openInquiryCount: 0,
      });
    }

    return NextResponse.json({
      users,
      generatedAt: new Date().toISOString(),
      capped: (postsRes.data?.length ?? 0) >= POSTS_CAP,
    });
  } catch (error) {
    console.error("[/api/admin/users/list] failed:", error);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
