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

// 7월 마케팅 실행 여부 판정 기준 월.
const JULY_MONTH = "2026-07";
const AUGUST_MONTH = "2026-08";
const JULY_MONTH_NUMBER = "7";

// "7,8" 형태의 이용 월 문자열에 해당 월이 포함되는지.
function includesMonth(months: string | null, month: string): boolean {
  return String(months || "")
    .split(",")
    .map((s) => s.trim())
    .includes(month);
}

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
  marketer_quantity: number | null;
  marketer_months: string | null;
  generator_months: string | null;
  generator_credits: number | null;
  field: string | null;
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
      notesRes,
      metricsRes,
      augMktRes,
      julyPerfRes,
      monthlyTossRes,
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
          "id, email, applicant_name, phone, host_org, mentor_org, ai_marketer, ai_generator, marketer_quantity, marketer_months, generator_months, generator_credits, field, created_at"
        ) as unknown) as Promise<{
        data: GrantRow[] | null;
        error: { message: string } | null;
      }>,
      (db
        .from("applications")
        .select(
          "id, user_id, email, main_content_url, channel_url, instagram_id, created_at"
        )
        .order("created_at", { ascending: false })
        .limit(POSTS_CAP) as unknown) as Promise<{
        data: Array<{
          id: string;
          user_id: string | null;
          email: string | null;
          main_content_url: string | null;
          channel_url: string | null;
          instagram_id: string | null;
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
      // Admin memos (특이사항) + 토스 상태, keyed by lowercased email
      (db
        .from("admin_user_notes")
        .select("email, note, toss_status") as unknown) as Promise<{
        data: Array<{ email: string; note: string; toss_status: string }> | null;
        error: { message: string } | null;
      }>,
      // Follower/subscriber snapshots — newest-first so first-seen per
      // (email, platform) is the latest.
      (db
        .from("follower_snapshots")
        .select("email, platform, count, recorded_on")
        .order("recorded_on", { ascending: false }) as unknown) as Promise<{
        data: Array<{
          email: string;
          platform: string;
          count: number;
          recorded_on: string;
        }> | null;
        error: { message: string } | null;
      }>,
      // 8월 마케팅 진행/변경 선택
      (db
        .from("marketing_confirmations")
        .select("user_id, email, choice")
        .eq("month", "2026-08") as unknown) as Promise<{
        data: Array<{ user_id: string; email: string | null; choice: string }> | null;
        error: { message: string } | null;
      }>,
      // 7월 마케팅 실행 결과 (있으면 '완료'). 테이블이 없어도(마이그레이션 전)
      // 목록 조회는 계속 동작해야 하므로 error는 무시하고 빈 값으로 취급한다.
      (db
        .from("monthly_performance")
        .select("user_id, email")
        .eq("month", JULY_MONTH) as unknown) as Promise<{
        data: Array<{ user_id: string | null; email: string | null }> | null;
        error: { message: string } | null;
      }>,
      // 월별 토스 상태 (7월/8월 각각). 테이블 미생성 시에도 무시하고 진행.
      (db
        .from("monthly_toss_status")
        .select("email, month, status")
        .in("month", [JULY_MONTH, AUGUST_MONTH]) as unknown) as Promise<{
        data: Array<{ email: string; month: string; status: string }> | null;
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

    // Auth metadata:
    //  - last_sign_in_at is the authoritative latest login even before
    //    login_events accumulates history.
    //  - created_at is the true 회원가입 date. profiles.created_at is set at
    //    onboarding (often days later), so it must NOT be used as the signup
    //    date — the auth timestamp is authoritative.
    // Non-fatal if unavailable.
    const authLastSignIn = new Map<string, string | null>();
    const authCreatedAt = new Map<string, string | null>();
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
          authCreatedAt.set(u.id, u.created_at ?? null);
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
    // Marketer submission URLs (인스타그램 주소 / 게시물 주소). Prefer the most
    // recent SUBMITTED application (has main_content_url), else the most recent.
    type MkUrls = { ig: string | null; post: string | null };
    const subUrlByUser = new Map<string, MkUrls>();
    const subUrlByEmail = new Map<string, MkUrls>();
    const anyUrlByUser = new Map<string, MkUrls>();
    const anyUrlByEmail = new Map<string, MkUrls>();
    for (const app of appsRes.data ?? []) {
      appById.set(app.id, { user_id: app.user_id, email: app.email });
      const emailKey = app.email?.trim().toLowerCase();
      // rows are newest-first → final overwrite per key is the earliest
      if (app.created_at) {
        if (app.user_id) firstAppByUser.set(app.user_id, app.created_at);
        if (emailKey) firstAppByEmail.set(emailKey, app.created_at);
      }
      // Resolve the instagram/channel URL: prefer channel_url, else build from id.
      const igUrl =
        app.channel_url ||
        (app.instagram_id
          ? `https://www.instagram.com/${app.instagram_id.replace(/^@/, "")}/`
          : null);
      const urls: MkUrls = { ig: igUrl, post: app.main_content_url || null };
      // 첫 등장(=최신)만 저장.
      if (app.user_id && !anyUrlByUser.has(app.user_id)) anyUrlByUser.set(app.user_id, urls);
      if (emailKey && !anyUrlByEmail.has(emailKey)) anyUrlByEmail.set(emailKey, urls);
      if (app.main_content_url) {
        if (app.user_id && !subUrlByUser.has(app.user_id)) subUrlByUser.set(app.user_id, urls);
        if (emailKey && !subUrlByEmail.has(emailKey)) subUrlByEmail.set(emailKey, urls);
      }
      if (!app.main_content_url) continue;
      if (app.user_id && !submittedByUser.has(app.user_id)) {
        submittedByUser.set(app.user_id, app.created_at);
      }
      if (emailKey && !submittedByEmail.has(emailKey)) {
        submittedByEmail.set(emailKey, app.created_at);
      }
    }
    // Resolve a user's marketer URLs: submitted(user) → any(user) → submitted(email) → any(email).
    const resolveMkUrls = (userId: string | null, emailKey: string): MkUrls => {
      const byUser = userId
        ? subUrlByUser.get(userId) ?? anyUrlByUser.get(userId)
        : undefined;
      const byEmail = emailKey
        ? subUrlByEmail.get(emailKey) ?? anyUrlByEmail.get(emailKey)
        : undefined;
      return byUser ?? byEmail ?? { ig: null, post: null };
    };

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

    // Admin memos + 토스 상태 keyed by lowercased email (signed-up + 미가입).
    const notesByEmail = new Map<string, string>();
    const tossByEmail = new Map<string, string>();
    if (!notesRes.error) {
      for (const n of notesRes.data ?? []) {
        const key = (n.email || "").trim().toLowerCase();
        if (!key) continue;
        if (n.note) notesByEmail.set(key, n.note);
        if (n.toss_status) tossByEmail.set(key, n.toss_status);
      }
    }

    // Latest snapshot per email+metric (rows newest-first → first seen = latest).
    // metric keys: instagram | youtube | post_likes | post_comments.
    type Snap = { count: number; date: string };
    const metricsByEmail = new Map<string, Record<string, Snap>>();
    if (!metricsRes.error) {
      for (const m of metricsRes.data ?? []) {
        const key = (m.email || "").trim().toLowerCase();
        if (!key) continue;
        const entry = metricsByEmail.get(key) ?? {};
        if (!entry[m.platform]) {
          entry[m.platform] = { count: m.count, date: m.recorded_on };
          metricsByEmail.set(key, entry);
        }
      }
    }
    const mget = (emailKey: string, metric: string) =>
      emailKey ? metricsByEmail.get(emailKey)?.[metric] : undefined;

    // 8월 마케팅 선택(keep/change) — user_id 및 email 양쪽으로 조회.
    const augByUser = new Map<string, string>();
    const augByEmail = new Map<string, string>();
    if (!augMktRes.error) {
      for (const c of augMktRes.data ?? []) {
        if (c.user_id) augByUser.set(c.user_id, c.choice);
        if (c.email) augByEmail.set(c.email.trim().toLowerCase(), c.choice);
      }
    }
    // 8월 마케터 이용자인지 + 선택 결과 → "keep" | "change" | "pending" | null
    const augMarketing = (
      userId: string | null,
      emailKey: string,
      aiMarketer: boolean,
      marketerMonths: string | null
    ): string | null => {
      const isAug = aiMarketer && includesMonth(marketerMonths, "8");
      if (!isAug) return null;
      const choice =
        (userId ? augByUser.get(userId) : undefined) ??
        (emailKey ? augByEmail.get(emailKey) : undefined);
      return choice ?? "pending";
    };

    // 월별 토스 상태 — email+month 키. 없으면 'wait'(대기)로 본다.
    const tossByEmailMonth = new Map<string, string>();
    if (!monthlyTossRes.error) {
      for (const t of monthlyTossRes.data ?? []) {
        const key = (t.email || "").trim().toLowerCase();
        if (key) tossByEmailMonth.set(`${key}|${t.month}`, t.status);
      }
    }
    const monthlyToss = (emailKey: string, month: string) =>
      (emailKey ? tossByEmailMonth.get(`${emailKey}|${month}`) : undefined) ??
      "wait";

    // 7월 마케팅 실행 완료(=성과 기록 있음) — user_id / email 양쪽으로 조회.
    const julyDoneUsers = new Set<string>();
    const julyDoneEmails = new Set<string>();
    if (!julyPerfRes.error) {
      for (const p of julyPerfRes.data ?? []) {
        if (p.user_id) julyDoneUsers.add(p.user_id);
        if (p.email) julyDoneEmails.add(p.email.trim().toLowerCase());
      }
    }

    // 7월 마케팅 진행 상태 → "done"(완료) | "pending"(미완료) | null(7월 대상 아님)
    //  - 대상: 7월 마케터 이용자(사전등록 marketer_months에 7 포함) 또는 7월 중
    //    마케터를 결제/신청한 사람.
    //  - 성과 기록(monthly_performance 2026-07)이 있으면 완료로 본다.
    const julyMarketing = (
      userId: string | null,
      emailKey: string,
      aiMarketer: boolean,
      marketerMonths: string | null,
      marketerSubmittedAt: string | null
    ): string | null => {
      const done =
        (userId ? julyDoneUsers.has(userId) : false) ||
        (emailKey ? julyDoneEmails.has(emailKey) : false);
      if (done) return "done";

      const grantedForJuly =
        aiMarketer && includesMonth(marketerMonths, JULY_MONTH_NUMBER);
      // 사전등록 월 정보가 없는 결제 이용자는 제출 시점으로 7월 신청을 판단한다.
      const submittedAt = marketerSubmittedAt
        ? new Date(marketerSubmittedAt)
        : null;
      const submittedInJuly =
        !!submittedAt &&
        Number.isFinite(submittedAt.getTime()) &&
        getKoreaDateString(submittedAt).startsWith(JULY_MONTH);
      return grantedForJuly || submittedInJuly ? "pending" : null;
    };

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
      // 생성기 구독: 사전등록으로 부여됐거나(grant) 활성 구독이 있으면 구독으로 본다.
      // (마케터 구독과 동일하게 '부여 OR 활성' 기준 — 부여만 있고 미활성이어도 표시)
      const aiGeneratorSub =
        subscriptionActive || (grant?.ai_generator ?? false);

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
        marketerQuantity: grant?.marketer_quantity ?? null,
        marketerMonths: grant?.marketer_months ?? null,
        generatorMonths: grant?.generator_months ?? null,
        field: grant?.field ?? "tech",
        note: emailKey ? (notesByEmail.get(emailKey) ?? "") : "",
        tossStatus: emailKey ? (tossByEmail.get(emailKey) ?? "wait") : "wait",
        augustMarketing: augMarketing(
          profile.id,
          emailKey,
          grant?.ai_marketer ?? false,
          grant?.marketer_months ?? null
        ),
        julyMarketing: julyMarketing(
          profile.id,
          emailKey,
          grant?.ai_marketer ?? false,
          grant?.marketer_months ?? null,
          marketerSubmittedAt
        ),
        julyToss: monthlyToss(emailKey, JULY_MONTH),
        augustToss: monthlyToss(emailKey, AUGUST_MONTH),
        instagramUrl: resolveMkUrls(profile.id, emailKey).ig,
        postUrl: resolveMkUrls(profile.id, emailKey).post,
        instaFollowerCount: mget(emailKey, "instagram")?.count ?? null,
        instaFollowerDate: mget(emailKey, "instagram")?.date ?? null,
        youtubeSubCount: mget(emailKey, "youtube")?.count ?? null,
        youtubeSubDate: mget(emailKey, "youtube")?.date ?? null,
        youtubeViewCount: mget(emailKey, "youtube_views")?.count ?? null,
        youtubeViewDate: mget(emailKey, "youtube_views")?.date ?? null,
        postLikesCount: mget(emailKey, "post_likes")?.count ?? null,
        postLikesDate: mget(emailKey, "post_likes")?.date ?? null,
        postCommentsCount: mget(emailKey, "post_comments")?.count ?? null,
        postCommentsDate: mget(emailKey, "post_comments")?.date ?? null,
        aiMarketerSub,
        aiGeneratorSub,
        freeUser: !aiMarketerSub && !aiGeneratorSub,
        // 가입/등록일 = 실제 회원가입일(auth). profiles.created_at은 온보딩 시점이라
        // 뒤로 밀릴 수 있어 auth 타임스탬프를 우선 사용한다.
        createdAt: authCreatedAt.get(profile.id) ?? profile.created_at,
        onboardedAt: profile.account_onboarded_at,
        subscriptionActive,
        subscriptionEndDate: sub?.end_date ?? null,
        remainingCredits: subscriptionActive ? sub!.remaining_credits : null,
        // 사전등록으로 부여된 생성기 크레딧(부여량). 활성 구독이 없을 때
        // "N (부여)"로 보여주기 위함.
        grantGeneratorCredits: grant?.ai_generator
          ? (grant.generator_credits ?? null)
          : null,
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
        marketerQuantity: grant.marketer_quantity ?? null,
        marketerMonths: grant.marketer_months ?? null,
        generatorMonths: grant.generator_months ?? null,
        field: grant.field ?? "tech",
        note: notesByEmail.get(emailKey) ?? "",
        tossStatus: tossByEmail.get(emailKey) ?? "wait",
        augustMarketing: augMarketing(
          null,
          emailKey,
          grant.ai_marketer,
          grant.marketer_months
        ),
        julyMarketing: julyMarketing(
          null,
          emailKey,
          grant.ai_marketer,
          grant.marketer_months,
          marketerSubmittedAt
        ),
        julyToss: monthlyToss(emailKey, JULY_MONTH),
        augustToss: monthlyToss(emailKey, AUGUST_MONTH),
        instagramUrl: resolveMkUrls(null, emailKey).ig,
        postUrl: resolveMkUrls(null, emailKey).post,
        instaFollowerCount: mget(emailKey, "instagram")?.count ?? null,
        instaFollowerDate: mget(emailKey, "instagram")?.date ?? null,
        youtubeSubCount: mget(emailKey, "youtube")?.count ?? null,
        youtubeSubDate: mget(emailKey, "youtube")?.date ?? null,
        youtubeViewCount: mget(emailKey, "youtube_views")?.count ?? null,
        youtubeViewDate: mget(emailKey, "youtube_views")?.date ?? null,
        postLikesCount: mget(emailKey, "post_likes")?.count ?? null,
        postLikesDate: mget(emailKey, "post_likes")?.date ?? null,
        postCommentsCount: mget(emailKey, "post_comments")?.count ?? null,
        postCommentsDate: mget(emailKey, "post_comments")?.date ?? null,
        aiMarketerSub: grant.ai_marketer || paidMarketerEmails.has(emailKey),
        // 미가입도 사전등록으로 생성기가 부여됐으면 구독으로 표시 (마케터와 동일 기준).
        aiGeneratorSub: grant.ai_generator,
        freeUser:
          !grant.ai_marketer &&
          !paidMarketerEmails.has(emailKey) &&
          !grant.ai_generator,
        createdAt: grant.created_at,
        onboardedAt: null,
        subscriptionActive: false,
        subscriptionEndDate: null,
        remainingCredits: null,
        grantGeneratorCredits: grant.ai_generator
          ? (grant.generator_credits ?? null)
          : null,
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
