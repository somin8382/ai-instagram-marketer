import { createClient } from "@supabase/supabase-js";
import {
  getKoreaDateString,
  getRemainingSubscriptionCredits,
  isPostGeneratorSubscriptionActive,
  POST_GENERATOR_PLAN_TYPE,
} from "@/lib/post-generator/subscription";
import type { Database } from "@/lib/supabase/types";
import { sanitizeGenerated } from "@/lib/text/korean";
import {
  INTERNAL_TEST_SESSION_COOKIE_NAME,
  verifyInternalTestSessionToken,
} from "@/lib/server/internal-test-session";
import { evaluateAnonymousFreeTrial } from "@/lib/server/free-trial";
import { getSupabaseServiceRoleClient } from "@/lib/server/admin";

export const maxDuration = 60;

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_TIMEOUT_MS = 55_000;
const IMAGE_STORAGE_BUCKET = "post-images";
const TEXT_MODEL = "openai/gpt-4o-mini";
const IMAGE_MODEL = "google/gemini-3-pro-image-preview";

type AccountPlanResult = {
  accountNames: Array<{ name: string; meaning: string }>;
  accountPlan: {
    direction: string;
    bio: string;
    concept: string;
  };
};

type PostPlanResult = {
  title: string;
  content: string;
  hashtags: string | string[];
  visualPrompt: string;
};

type PostImageResult = {
  title: string;
  content: string;
  hashtags: string;
  generatedImageUrl: string;
  visualPrompt?: string;
  imageModelText?: string;
  planningModel: string;
  imageModel: string;
};

type AiRequestBody = {
  type?: "planning" | "post_image" | "image_only" | "image_edit" | "brand_slogans";
  usageMode?: "free_trial" | "premium";
  accessToken?: string | null;
  isInternalTestAccount?: boolean;
  industry?: string;
  productService?: string;
  instagramHandle?: string;
  accountDirection?: string;
  accountBio?: string;
  accountConcept?: string;
  requestId?: string;
  previousResult?: AccountPlanResult | null;
  previousPost?: {
    title?: string;
    content?: string;
    hashtags?: string;
  } | null;
  image?: string;
  images?: string[];
  userPrompt?: string;
  marketingChannel?: string;
  contentTone?: string;
  emojiUsage?: string;
  imageStyle?: string;
  // image_only (re-roll)
  visualPrompt?: string;
  rerollSuffix?: string;
  // image_edit (AI edit)
  imageEditBase64?: string;
  editPrompt?: string;
  // brand_slogans
  companyName?: string;
  brandName?: string;
};

type OpenRouterMessage =
  | { role: "user"; content: string }
  | {
      role: "user";
      content: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
    };

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    console.error("[/api/ai] Missing OPENROUTER_API_KEY");
    return Response.json(
      { error: "AI 설정을 확인해주세요. 잠시 후 다시 시도해주세요." },
      { status: 500 }
    );
  }

  let body: AiRequestBody;

  try {
    body = (await request.json()) as AiRequestBody;
  } catch {
    return Response.json(
      { error: "요청 정보를 다시 확인해주세요." },
      { status: 400 }
    );
  }

  if (body.type === "post_image") {
    return handlePostImageGeneration(body, apiKey, request);
  }

  if (body.type === "image_only") {
    return handleImageOnly(body, apiKey, request);
  }

  if (body.type === "image_edit") {
    return handleImageEdit(body, apiKey, request);
  }

  if (body.type === "brand_slogans") {
    return handleBrandSlogans(body, apiKey);
  }

  return handlePlanning(body, apiKey);
}

// Text-only slogan generation for signed-in users (no credit consumption:
// a single cheap gpt-4o-mini call, gated by authentication).
async function handleBrandSlogans(body: AiRequestBody, apiKey: string) {
  const accessToken = String(body.accessToken ?? "").trim();
  if (!accessToken) {
    return Response.json(
      { error: "로그인 후 이용할 수 있습니다." },
      { status: 401 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return Response.json(
      { error: "서비스 설정을 확인해주세요." },
      { status: 500 }
    );
  }
  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) {
    return Response.json(
      { error: "로그인 정보가 만료되었습니다. 다시 로그인해주세요." },
      { status: 401 }
    );
  }

  const companyName = String(body.companyName ?? "").trim();
  const brandName = String(body.brandName ?? "").trim();
  const industry = String(body.industry ?? "").trim();
  const productService = String(body.productService ?? "").trim();

  if (!companyName && !brandName) {
    return Response.json(
      { error: "회사명 또는 브랜드명을 먼저 입력해주세요." },
      { status: 400 }
    );
  }

  // Per-user daily cap (cost control): slogan generations are cheap but
  // otherwise unbounded. Count today's logged slogan runs (KST day) and block
  // past the cap. Uses generation_logs (service-role only). Fails open on any
  // logging/infra error so a transient DB issue never blocks a paying feature.
  const sloganDailyCap = (() => {
    const raw = process.env.BRAND_SLOGANS_MAX_PER_USER_PER_DAY;
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
  })();
  const startOfKoreaDayIso = new Date(
    `${getKoreaDateString()}T00:00:00+09:00`
  ).toISOString();
  let sloganLogDb: ReturnType<typeof getSupabaseServiceRoleClient> | null = null;
  try {
    sloganLogDb = getSupabaseServiceRoleClient();
    const countRes = (await (
      sloganLogDb
        .from("generation_logs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("usage_mode", "brand_slogans")
        .gte("created_at", startOfKoreaDayIso) as unknown
    )) as { count: number | null; error: { message: string } | null };
    if (!countRes.error && (countRes.count ?? 0) >= sloganDailyCap) {
      return Response.json(
        {
          error: `오늘 슬로건 생성 한도(${sloganDailyCap}회)를 초과했습니다. 내일 다시 이용해주세요.`,
        },
        { status: 429 }
      );
    }
  } catch {
    sloganLogDb = null; // fail open (e.g. service role unavailable locally)
  }

  const prompt = `
당신은 한국의 브랜드 카피라이터입니다. 아래 브랜드 정보를 바탕으로 브랜드 슬로건 후보 5개를 제안하세요.

브랜드 정보:
- 회사명: ${companyName || "정보 없음"}
- 브랜드/아이템명: ${brandName || "정보 없음"}
- 업종: ${industry || "정보 없음"}
- 상품/서비스: ${productService || "정보 없음"}

규칙:
- 각 슬로건은 공백 포함 20자 이내의 한국어 한 줄
- 다섯 개는 서로 다른 방향(감성형, 가치제안형, 위트형, 신뢰형, 행동유도형)으로 작성
- 업종·상품이 구체적으로 느껴져야 하며, 어느 브랜드에나 붙는 범용 문구 금지
- 각 슬로건에 어떤 방향인지 짧은 이유를 붙일 것
- 특수 기호, 이모지, 따옴표 사용 금지

다음 JSON 형식으로만 답변하세요. 설명 없이 JSON만 출력하세요:
{"slogans": [{"text": "슬로건", "angle": "방향과 짧은 이유"}]}
`;

  const response = await callOpenRouter({
    apiKey,
    model: TEXT_MODEL,
    requestType: "brand_slogans",
    messages: [{ role: "user", content: prompt }],
  });

  if (!response.ok) {
    return Response.json(
      { error: "슬로건 생성에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }

  const content = extractMessageContent(
    response.data?.choices?.[0]?.message?.content
  );
  const parsed = extractJson<{
    slogans?: Array<{ text?: unknown; angle?: unknown }>;
  }>(content);
  const slogans = (parsed?.slogans ?? [])
    .map((item) => ({
      text: sanitizeGenerated(String(item?.text ?? "").trim()),
      angle: sanitizeGenerated(String(item?.angle ?? "").trim()),
    }))
    .filter((item) => item.text)
    .slice(0, 5);

  if (slogans.length === 0) {
    return Response.json(
      { error: "슬로건 생성에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }

  // Log the successful run so it counts toward the daily cap. Fire-and-forget;
  // never blocks the response.
  if (sloganLogDb) {
    void (
      sloganLogDb.from("generation_logs").insert({
        user_id: user.id,
        usage_mode: "brand_slogans",
        outcome: "success",
        text_model: TEXT_MODEL,
        image_count: 0,
      } as never) as unknown as Promise<{ error: { message: string } | null }>
    ).then(({ error }) => {
      if (error) {
        console.warn("[/api/ai] slogan log insert failed:", error.message);
      }
    });
  }

  return Response.json({ slogans, source: "api" });
}

async function handlePlanning(body: AiRequestBody, apiKey: string) {
  const industry = String(body.industry ?? "").trim();
  const productService = String(body.productService ?? "").trim();
  const requestId = String(body.requestId ?? "").trim();

  if (!industry || !productService) {
    return Response.json(
      { error: "업종과 상품 또는 서비스 정보를 입력해주세요." },
      { status: 400 }
    );
  }

  const planningResult = await generatePlanningResult({
    apiKey,
    industry,
    productService,
    requestId,
    previousResult: body.previousResult ?? null,
  });

  if (!planningResult.ok) {
    return Response.json(
      {
        error: planningResult.error,
        source: "fallback",
      },
      { status: 502 }
    );
  }

  return Response.json({ ...planningResult.data, source: "api" });
}

async function handlePostImageGeneration(
  body: AiRequestBody,
  apiKey: string,
  request: Request
) {
  const startedAt = Date.now();
  const usageMode = body.usageMode === "premium" ? "premium" : "free_trial";
  // Filled in as the request is parsed/authenticated; read by logOutcome.
  const logContext: {
    userId: string | null;
    userPrompt: string;
    imageCount: number;
  } = { userId: null, userPrompt: "", imageCount: 0 };
  const logOutcome = (
    outcome: "success" | "plan_failed" | "image_failed" | "no_image_output",
    extra: Record<string, unknown> = {}
  ) => {
    const durationMs = Date.now() - startedAt;
    console.info(
      "[/api/ai] post_image outcome:",
      JSON.stringify({
        outcome,
        usageMode,
        durationMs,
        ...extra,
      })
    );
    // Persist for admin support tooling; never blocks or fails the response.
    try {
      const db = getSupabaseServiceRoleClient();
      void (
        db.from("generation_logs").insert({
          user_id: logContext.userId,
          usage_mode: usageMode,
          outcome,
          duration_ms: durationMs,
          user_prompt: logContext.userPrompt.slice(0, 2000) || null,
          image_count: logContext.imageCount,
          image_model: (extra.imageModel as string) ?? null,
          text_model: (extra.planningModel as string) ?? null,
        } as never) as unknown as Promise<{
          error: { message: string } | null;
        }>
      ).then(({ error }) => {
        if (error) {
          console.warn("[/api/ai] generation log insert failed:", error.message);
        }
      });
    } catch {
      // Service role not configured (local dev): console log only
    }
  };
  const premiumAccess = await verifyPremiumGenerationAccess({
    usageMode,
    accessToken: String(body.accessToken ?? "").trim(),
    allowInternalTestBypass: body.isInternalTestAccount === true,
    request,
  });

  if (!premiumAccess.ok) {
    return Response.json(
      { error: premiumAccess.error },
      {
        status: premiumAccess.statusCode,
      }
    );
  }

  if ("userId" in premiumAccess) {
    logContext.userId = premiumAccess.userId ?? null;
  }

  const industry = String(body.industry ?? "").trim();
  const productService = String(body.productService ?? "").trim();
  const instagramHandle = String(body.instagramHandle ?? "").trim();
  const accountDirection = String(body.accountDirection ?? "").trim();
  const accountBio = String(body.accountBio ?? "").trim();
  const accountConcept = String(body.accountConcept ?? "").trim();
  const normalizedIndustry = industry || "업종 정보 없음";
  const normalizedProductService = productService || "상품 또는 서비스 정보 없음";
  const normalizedInstagramHandle = instagramHandle || "계정명 정보 없음";
  const normalizedAccountDirection = accountDirection || "계정 방향 정보 없음";
  const normalizedAccountBio = accountBio || "소개글 정보 없음";
  const normalizedAccountConcept = accountConcept || "운영 컨셉 정보 없음";
  const marketingChannel = String(body.marketingChannel ?? "").trim();
  const contentTone = (["friendly", "informative", "story", "witty"] as const).includes(
    String(body.contentTone ?? "").trim() as "friendly"
  )
    ? (String(body.contentTone).trim() as "friendly" | "informative" | "story" | "witty")
    : "friendly";
  const emojiUsage = (["rich", "minimal", "off"] as const).includes(
    String(body.emojiUsage ?? "").trim() as "minimal"
  )
    ? (String(body.emojiUsage).trim() as "rich" | "minimal" | "off")
    : "minimal";
  const imageStyle = (["photoreal", "webtoon", "mood", "3d"] as const).includes(
    String(body.imageStyle ?? "").trim() as "photoreal"
  )
    ? (String(body.imageStyle).trim() as "photoreal" | "webtoon" | "mood" | "3d")
    : "photoreal";
  const requestId = String(body.requestId ?? "").trim();
  const images = Array.isArray(body.images)
    ? body.images.map((item) => String(item ?? "")).filter(Boolean).slice(0, 2)
    : body.image
      ? [String(body.image)]
      : [];
  const userPrompt = String(body.userPrompt ?? "").trim();
  logContext.userPrompt = userPrompt;
  logContext.imageCount = images.length;
  // Follow the user's prompt language: Hangul-free prompts with Latin
  // letters get English copy; everything else keeps the Korean default.
  const preferEnglishOutput =
    Boolean(userPrompt) && !/[가-힣]/.test(userPrompt) && /[A-Za-z]/.test(userPrompt);

  console.log(
    "[/api/ai] Post image request summary:",
    JSON.stringify({
      hasInstagramHandle: Boolean(instagramHandle),
      hasAccountDirection: Boolean(accountDirection),
      hasAccountBio: Boolean(accountBio),
      hasAccountConcept: Boolean(accountConcept),
      hasIndustry: Boolean(industry),
      hasProductService: Boolean(productService),
      imageCount: images.length,
      hasUserPrompt: Boolean(userPrompt),
      requestId: requestId || "none",
    })
  );

  if (images.length === 0 && !userPrompt) {
    return Response.json(
      { error: "참고 이미지나 원하는 게시물 방향을 입력해주세요." },
      { status: 400 }
    );
  }

  if (
    images.some((image) => !/^data:image\/[\w.+-]+;base64,/.test(image))
  ) {
    return Response.json(
      { error: "참고 이미지 형식을 확인해주세요." },
      { status: 400 }
    );
  }

  // Anonymous (no-account) free trial: layered gate (signed cookie → global
  // daily budget → per-IP limit) so the unmetered free path cannot be scripted
  // to run up OpenRouter cost. Premium requests are metered separately by
  // subscription credits above. On success we mark this browser via cookie.
  let freeTrialCookieHeader: string | null = null;

  if (usageMode === "free_trial") {
    const trialDecision = await evaluateAnonymousFreeTrial(request);

    if (!trialDecision.ok) {
      return Response.json(
        { error: trialDecision.error },
        { status: trialDecision.statusCode }
      );
    }

    freeTrialCookieHeader = trialDecision.setCookieHeader;
  }

  const postPlan = await generatePostPlan({
    apiKey,
    instagramHandle: normalizedInstagramHandle,
    industry: normalizedIndustry,
    productService: normalizedProductService,
    accountDirection: normalizedAccountDirection,
    accountBio: normalizedAccountBio,
    accountConcept: normalizedAccountConcept,
    marketingChannel,
    contentTone,
    emojiUsage,
    imageStyle,
    requestId,
    previousPost: body.previousPost ?? null,
    userPrompt,
    preferEnglishOutput,
  });

  if (!postPlan.ok) {
    logOutcome("plan_failed");
    return Response.json(
      {
        error: "게시물 기획 생성에 실패했습니다. 잠시 후 다시 시도해주세요.",
        source: "fallback",
      },
      { status: 502 }
    );
  }

  const imageTextLanguage = preferEnglishOutput ? "English" : "Korean";
  const imagePrompt = `
Create an Instagram marketing post visual.

Business context:
- Instagram handle: ${normalizedInstagramHandle}
- Industry: ${normalizedIndustry}
- Product or service: ${normalizedProductService}
- Account direction: ${normalizedAccountDirection}
- Account bio: ${normalizedAccountBio}
- Account concept: ${normalizedAccountConcept}

Post plan:
- Title: ${postPlan.data.title}
- Caption summary: ${postPlan.data.content}
- Hashtags: ${postPlan.data.hashtags}

Visual direction:
${postPlan.data.visualPrompt}

Requirements:
- Output a polished square Instagram feed post image
- Prioritize strong composition, clean typography space, and premium brand presentation
- Keep it suitable for a ${preferEnglishOutput ? "global English-speaking" : "Korean"} audience
- Make it feel like a real branded social media creative, not a stock photo
- Compose it in a strict 1:1 square layout suitable for the Instagram feed
- Respect the uploaded reference images for product, mood, style, or composition cues when useful
- Avoid cluttered layouts and avoid dense text overlays
- Prefer no text inside the image whenever possible
- If text is absolutely necessary, use only one very short ${imageTextLanguage} headline or at most two short lines
- Never include long ${imageTextLanguage} sentences, paragraphs, multiple text blocks, or small unreadable ${imageTextLanguage} copy
- Keep the main marketing copy outside the image; the image should be visually strong even without readable text
`;

  const imageResponse = await callOpenRouter({
    apiKey,
    model: IMAGE_MODEL,
    requestType: "post_image",
    messages: images.length > 0
      ? [
          {
            role: "user",
            content: [
              { type: "text", text: imagePrompt },
              ...images.map((image) => ({
                type: "image_url" as const,
                image_url: { url: image },
              })),
            ],
          },
        ]
      : [{ role: "user", content: imagePrompt }],
    modalities: ["image", "text"],
    imageConfig: {
      aspect_ratio: "1:1",
      image_size: "1K",
    },
  });

  if (!imageResponse.ok) {
    logOutcome("image_failed");
    return Response.json(
      { error: "이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }

  const imageOutputs = extractImageOutputs(imageResponse.data);
  const imageModelText = extractMessageContent(
    imageResponse.data?.choices?.[0]?.message?.content
  );

  if (imageOutputs.length === 0) {
    console.error("[/api/ai] No image outputs found for post_image request");
    console.error(
      "[/api/ai] Available image response keys:",
      getImageResponseDebugSummary(imageResponse.data)
    );
    logOutcome("no_image_output");
    return Response.json(
      { error: "이미지 결과를 불러오지 못했습니다. 다시 시도해주세요." },
      { status: 502 }
    );
  }

  const generatedImageUrl = await uploadGeneratedImage(imageOutputs[0]);
  const premiumUsageResult = await consumeVerifiedPremiumGenerationCredit(
    premiumAccess
  );

  if (!premiumUsageResult.ok) {
    return Response.json(
      { error: premiumUsageResult.error },
      { status: premiumUsageResult.statusCode }
    );
  }

  const result: PostImageResult = {
    title: postPlan.data.title,
    content: postPlan.data.content,
    hashtags: postPlan.data.hashtags,
    generatedImageUrl,
    visualPrompt: postPlan.data.visualPrompt,
    planningModel: TEXT_MODEL,
    imageModel: IMAGE_MODEL,
  };

  if (imageModelText) {
    result.imageModelText = imageModelText;
  }

  logOutcome("success", { imageModel: IMAGE_MODEL, planningModel: TEXT_MODEL });

  return Response.json(
    { ...result, source: "api" },
    freeTrialCookieHeader
      ? { headers: { "Set-Cookie": freeTrialCookieHeader } }
      : undefined
  );
}

type PremiumUsageMode = "free_trial" | "premium";

type SubscriptionGuardRow = {
  id: string;
  plan_type: string;
  start_date: string;
  end_date: string;
  remaining_credits: number;
  daily_usage_count: number;
  last_usage_date: string | null;
};

async function verifyPremiumGenerationAccess(input: {
  usageMode: PremiumUsageMode;
  accessToken: string;
  allowInternalTestBypass: boolean;
  request: Request;
}) {
  if (input.usageMode !== "premium") {
    return { ok: true as const, shouldConsumeCredit: false as const };
  }

  // Local development fallback for the hardcoded internal test account.
  // Keep this bypass disabled in production.
  if (input.allowInternalTestBypass && process.env.NODE_ENV !== "production") {
    return { ok: true as const, shouldConsumeCredit: false as const };
  }

  const cookieHeader = input.request.headers.get("cookie") ?? "";
  const internalSessionToken = readCookie(cookieHeader, INTERNAL_TEST_SESSION_COOKIE_NAME);
  const internalSession = verifyInternalTestSessionToken(internalSessionToken);

  if (internalSession.valid) {
    return { ok: true as const, shouldConsumeCredit: false as const };
  }

  if (!input.accessToken) {
    return {
      ok: false as const,
      error: "로그인 후 월 구독으로 이용할 수 있습니다.",
      statusCode: 401,
    };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      ok: false as const,
      error: "서비스 설정을 확인해주세요. 잠시 후 다시 시도해주세요.",
      statusCode: 500,
    };
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(input.accessToken);

  if (authError || !user) {
    return {
      ok: false as const,
      error: "로그인 정보가 만료되었습니다. 다시 로그인해주세요.",
      statusCode: 401,
    };
  }

  const subscriptionResponse = (await ((
    supabase
      .from("subscriptions")
      .select(
        "id, plan_type, start_date, end_date, remaining_credits, daily_usage_count, last_usage_date"
      )
      .eq("user_id", user.id)
      .eq("plan_type", POST_GENERATOR_PLAN_TYPE)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle() as unknown
  ) as Promise<{
    data: SubscriptionGuardRow | null;
    error: { message: string } | null;
  }>)) as {
    data: SubscriptionGuardRow | null;
    error: { message: string } | null;
  };

  if (subscriptionResponse.error) {
    return {
      ok: false as const,
      error: "구독 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.",
      statusCode: 403,
    };
  }

  const subscription = subscriptionResponse.data;

  if (!subscription || subscription.plan_type !== POST_GENERATOR_PLAN_TYPE) {
    return {
      ok: false as const,
      error: "월 구독 후 이용할 수 있습니다.",
      statusCode: 403,
    };
  }

  const today = getKoreaDateString();
  const subscriptionForValidation = {
    startDate: subscription.start_date,
    endDate: subscription.end_date,
    remainingCredits: subscription.remaining_credits,
    dailyUsageCount: subscription.daily_usage_count,
    lastUsageDate: subscription.last_usage_date,
  };

  if (!isPostGeneratorSubscriptionActive(subscriptionForValidation, today)) {
    return {
      ok: false as const,
      error: "월 구독 후 이용할 수 있습니다.",
      statusCode: 403,
    };
  }

  if (getRemainingSubscriptionCredits(subscriptionForValidation) <= 0) {
    return {
      ok: false as const,
      error: "남은 생성 횟수가 없습니다",
      statusCode: 403,
    };
  }

  return {
    ok: true as const,
    shouldConsumeCredit: true as const,
    accessToken: input.accessToken,
    subscriptionId: subscription.id,
    userId: user.id,
  };
}

async function consumeVerifiedPremiumGenerationCredit(
  access: Awaited<ReturnType<typeof verifyPremiumGenerationAccess>>
) {
  if (!access.ok || !access.shouldConsumeCredit) {
    return { ok: true as const };
  }

  // Atomic server-side decrement via RPC (service role): the single UPDATE
  // gates on the active window AND a positive balance, so concurrent requests
  // cannot double-spend and the browser has no write path to credits.
  try {
    const db = getSupabaseServiceRoleClient();
    const response = (await (db.rpc("consume_post_generator_credit" as never, {
      p_user_id: access.userId,
      p_today: getKoreaDateString(),
    } as never) as unknown)) as {
      data: Array<{ remaining_credits: number }> | null;
      error: { message: string } | null;
    };

    if (response.error) {
      console.error(
        "[/api/ai] credit consume RPC failed:",
        response.error.message
      );
      return {
        ok: false as const,
        error: "사용량 차감 처리에 실패했습니다. 다시 시도해주세요.",
        statusCode: 409,
      };
    }

    if (!response.data || response.data.length === 0) {
      // Inactive subscription or balance exhausted between verify and consume
      return {
        ok: false as const,
        error: "남은 생성 횟수가 없습니다",
        statusCode: 403,
      };
    }

    return { ok: true as const };
  } catch (error) {
    console.error("[/api/ai] credit consume failed:", error);
    return {
      ok: false as const,
      error: "사용량 차감 처리에 실패했습니다. 다시 시도해주세요.",
      statusCode: 500,
    };
  }
}

function readCookie(cookieHeader: string, name: string) {
  const item = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  if (!item) {
    return "";
  }

  return item.slice(name.length + 1);
}

async function generatePostPlan({
  apiKey,
  instagramHandle,
  industry,
  productService,
  accountDirection,
  accountBio,
  accountConcept,
  marketingChannel,
  contentTone,
  emojiUsage,
  imageStyle,
  requestId,
  previousPost,
  userPrompt,
  preferEnglishOutput,
}: {
  apiKey: string;
  instagramHandle: string;
  industry: string;
  productService: string;
  accountDirection: string;
  accountBio: string;
  accountConcept: string;
  marketingChannel: string;
  contentTone: string;
  emojiUsage: string;
  imageStyle: string;
  requestId: string;
  previousPost: AiRequestBody["previousPost"];
  userPrompt: string;
  preferEnglishOutput: boolean;
}) {
  const isYoutube = marketingChannel === "youtube";
  const minHashtags = isYoutube ? 3 : 5;
  const maxHashtags = isYoutube ? 5 : 8;

  const channelTone = isYoutube
    ? `채널 타입: 유튜브
- 정보성·전문성 중심의 톤 사용. 신뢰와 설명력 강조.
- 검색 키워드를 의식한 문구 작성. 구체적인 정보가 드러나야 함.
- content는 후킹 1줄 → 핵심/정보 2~4줄 → CTA 1줄 구성. 다소 길어도 무방.
- hashtags는 ${minHashtags}~${maxHashtags}개, 검색 최적화 키워드 위주로.`
    : `채널 타입: 인스타그램
- 감성·브랜드·바이럴 중심의 짧고 임팩트 있는 톤.
- 릴스/피드 친화적인 후킹 문구. 감성과 브랜드 이미지를 전달.
- content는 후킹 1줄 → 핵심/가치 2~4줄 → 행동유도(CTA) 1줄 구성.
- hashtags는 ${minHashtags}~${maxHashtags}개, 니치 중심·브랜드 태그 포함.`;

  const toneGuideMap: Record<string, string> = {
    friendly: "친근하게 말 걸기. 당신·우리 등 2인칭, 따뜻한 어조.",
    informative: "정보·숫자·사실 중심. 구체적 수치와 근거를 드러내야 함.",
    story: "장면·감정 묘사로 시작. 독자를 상황 속으로 끌어들이는 서술.",
    witty: "반전·언어유희·뜻밖의 표현. 예상치 못한 전개로 시선 고정.",
  };
  const toneGuide = toneGuideMap[contentTone] ?? toneGuideMap.friendly;

  const emojiGuideMap: Record<string, string> = {
    off: "이모지 0개. 텍스트만으로 깔끔하게. 이모지를 단 하나도 사용하지 마세요.",
    minimal: "핵심을 짚는 곳에만 1~2개. 의미 없는 나열 금지.",
    rich: "문장마다 생동감 있게, 총 5~8개 내외. 같은 이모지 반복·도배 금지.",
  };
  const emojiGuide = emojiGuideMap[emojiUsage] ?? emojiGuideMap.minimal;

  const imageStyleGuideMap: Record<string, string> = {
    photoreal: "Photorealistic style, natural lighting, sharp details, premium brand look.",
    webtoon: "Webtoon/illustration style, clean line art, cute and expressive characters.",
    mood: "Moody aesthetic photo style, soft colors, bokeh blur, dreamy film grain.",
    "3d": "3D rendering style, volumetric lighting, metallic and glossy materials, sharp shadows.",
  };
  const imageStyleGuide = imageStyleGuideMap[imageStyle] ?? imageStyleGuideMap.photoreal;
  const hashtagExample = isYoutube
    ? `["태그명1", "태그명2", "태그명3"]`
    : `["태그명1", "태그명2", "태그명3", "태그명4", "태그명5"]`;
  const overlayLanguage = preferEnglishOutput ? "영어" : "한국어";

  const buildUserInput = (retryReason = "") => `
당신은 한국의 SNS 마케팅 전문가입니다.
아래 계정 정보를 바탕으로 게시물 기획을 작성해 주세요.

계정명: ${instagramHandle}
업종: ${industry}
상품/서비스: ${productService}
계정 방향: ${accountDirection}
계정 소개글: ${accountBio}
운영 컨셉: ${accountConcept}
사용자 요청 방향: ${userPrompt || "없음"}

출력 언어: ${preferEnglishOutput ? "영어" : "한국어"}
${
  preferEnglishOutput
    ? `- 사용자 요청 방향이 영어로 작성되었으므로 title, content, hashtags를 모두 자연스러운 영어로 작성하세요.
- hashtags도 영어 키워드로 작성하세요. 아래 규칙의 "한글" 표기는 모두 영어로 대체해 적용하세요.`
    : `- title, content, hashtags를 모두 한국어로 작성하세요.`
}

채널 가이드:
${channelTone}

말투(톤): ${contentTone}
- ${toneGuide}

이모지 정책: ${emojiUsage}
- ${emojiGuide}
- 공통 금지: 의미 없는 나열, 단위·특수기호(㎢ ㎡ 등), 깨진 문자.

해시태그 구성 (티어 혼합, 니치 중심):
1. 니치·핵심 2~3개: 업종+아이템 구체 조합 (예: #체육에듀테크 #학교체육수업)
2. 중간 규모 1~2개: 관련 카테고리 (예: #에듀테크)
3. 브랜드/캠페인 1개: 계정명(instagramHandle) 기반 고유 태그
4. 지역 태그: 로컬 업종이면 1개, 온라인 서비스이면 생략
- 금지: #선팔 #맞팔 #f4f #좋아요반사 등 스팸 태그
- 게시물 내용과 무관한 태그, 범용 #일상 #감성 같은 초광범 태그 금지
- 한글 위주. 총 ${minHashtags}~${maxHashtags}개.

중요 규칙:
- title은 공백 포함 ${preferEnglishOutput ? "60" : "25"}자 이내, 스크롤을 멈추게 하는 강한 후킹 한 줄. 업종/아이템 구체 키워드 1개 이상 포함.
- 위 업종·상품/서비스·계정명을 구체적으로 드러내고, 일반적인 미사여구나 업종 불문 범용 표현으로 대체하지 말 것
- 업종이나 상품/서비스 정보가 비어 있으면, 사용자 요청 방향과 참고 이미지를 바탕으로 자연스럽게 맥락을 추론하세요
- 반드시 계정명, 업종, 상품/서비스, 계정 방향, 소개글, 운영 컨셉을 우선 참고해 이 계정에 실제로 올라갈 법한 게시물만 작성하세요
- 결과는 하나의 일회성 광고처럼 쓰지 말고, 이 계정이 꾸준히 운영되는 흐름 안에 들어가는 게시물처럼 써주세요
- 계정 소개글과 운영 컨셉에 드러난 말투, 분위기, 브랜드 톤을 자연스럽게 반영하세요
- 이전 생성 결과가 있으면 문구는 반복하지 말되, 그 게시물의 브랜드 말투·페르소나와 일관된 목소리를 유지하세요 (같은 계정이 연재하는 느낌)
- 상품/서비스의 실제 쓰임, 장점, 타깃 고객, 사용 장면이 드러나야 하며 일반적인 마케팅 문구로 얼버무리지 마세요
- 사용자 요청 방향이 있으면 가장 우선으로 반영하되, 나머지 계정 정보와 충돌 없이 자연스럽게 결합하세요
- title, content, hashtags는 모두 이 비즈니스에 맞는 구체적인 결과여야 합니다
- 특수 기호나 단위 기호(㎢, ㎡, ㎤ 등)는 절대 사용하지 말 것
- visualPrompt는 이미지 생성 모델이 바로 사용할 수 있는 상세한 영어 프롬프트로 작성하세요
- visualPrompt에는 정사각형 1:1 구도, 조명, 색감, 제품/브랜드 포인트, SNS 광고 느낌을 구체적으로 포함하세요
- visualPrompt에는 반드시 업종, 상품/서비스, 브랜드 톤, 계정 컨셉, 타깃 분위기를 반영하세요
- visualPrompt 이미지 스타일: ${imageStyle} — ${imageStyleGuide}
- visualPrompt에는 텍스트 오버레이를 최소화하라고 명확히 지시하세요
- visualPrompt에는 ${overlayLanguage} 문장은 이미지 안에 넣지 말고, 꼭 필요한 경우에도 매우 짧은 ${overlayLanguage} 한 줄 또는 두 줄만 허용하라고 적으세요
- visualPrompt에는 긴 슬로건, 문단, 여러 개의 텍스트 박스, 복잡한 타이포그래피를 피하라고 적으세요
- visualPrompt는 시각적 완성도를 우선하고, 본문 카피는 이미지 밖 title/content/hashtags로 전달하도록 유도하세요
- 사용자가 참고 이미지는 참고용이며, 사용자 요청 방향이 있으면 반드시 그 방향을 우선 반영하세요
- 매번 완전히 새로운 결과를 생성하세요
- generation_id(${requestId || "none"})를 참고해 이전 결과와 다른 문구를 작성하세요

이전 생성 결과(절대 반복 금지):
- 제목: ${String(previousPost?.title ?? "없음")}
- 본문: ${String(previousPost?.content ?? "없음")}
- 해시태그: ${String(previousPost?.hashtags ?? "없음")}
${retryReason ? `
직전 응답 문제:
- ${retryReason}
- 위 문제를 반드시 수정하고, 필수 필드와 해시태그 개수를 정확히 맞춰 JSON만 다시 출력하세요.
` : ""}

다음 JSON 형식으로만 답변하세요. 설명 없이 JSON만 출력하세요:
{
  "title": "게시물 제목(25자 이내)",
  "content": "게시물 본문(후킹→핵심/가치→CTA)",
  "hashtags": ${hashtagExample},
  "visualPrompt": "Detailed English prompt for image generation"
}
`;

  let retryReason = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await callOpenRouter({
      apiKey,
      model: TEXT_MODEL,
      requestType: attempt === 0 ? "post_plan" : "post_plan_retry",
      messages: [{ role: "user", content: buildUserInput(retryReason) }],
    });

    if (!response.ok) {
      return { ok: false as const };
    }

    const content = extractMessageContent(response.data?.choices?.[0]?.message?.content);
    const parsed = extractJson<PostPlanResult>(content);

    if (!parsed) {
      retryReason = "response was not valid JSON";
      console.error("[/api/ai] Failed to parse post plan response:", retryReason);
      continue;
    }

    const title = sanitizeGenerated(String(parsed.title ?? ""));
    const caption = sanitizeGenerated(String(parsed.content ?? ""));

    const rawHashtags = parsed.hashtags;
    const hashtagsStr = Array.isArray(rawHashtags)
      ? rawHashtags
          .map((t) => String(t ?? "").trim().replace(/^#+/, ""))
          .filter(Boolean)
          .map((t) => `#${t}`)
          .join(" ")
      : String(rawHashtags ?? "");
    const hashtags = sanitizeGenerated(hashtagsStr);

    const visualPrompt = String(parsed.visualPrompt ?? "").trim();
    const hashtagCount = hashtags
      .split(/\s+/)
      .filter((tag) => tag.startsWith("#")).length;
    const validationIssues = [
      !title ? "missing title" : "",
      !caption ? "missing content" : "",
      !hashtags ? "missing hashtags" : "",
      !visualPrompt ? "missing visualPrompt" : "",
      hashtagCount < minHashtags
        ? `hashtags count ${hashtagCount} < ${minHashtags}`
        : "",
    ].filter(Boolean);

    if (validationIssues.length > 0) {
      retryReason = validationIssues.join(", ");
      console.error("[/api/ai] Invalid post plan response:", retryReason, parsed);
      continue;
    }

    return { ok: true as const, data: { ...parsed, title, content: caption, hashtags } };
  }

  return { ok: false as const };
}

async function uploadGeneratedImage(imageUrl: string): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return imageUrl;

  try {
    let buffer: ArrayBuffer;
    let mimeType = "image/png";

    if (imageUrl.startsWith("data:")) {
      const commaIdx = imageUrl.indexOf(",");
      if (commaIdx === -1) return imageUrl;
      const header = imageUrl.slice(5, commaIdx);
      const mimeMatch = header.match(/^(image\/[\w.+-]+);base64$/);
      if (!mimeMatch) return imageUrl;
      mimeType = mimeMatch[1];
      const b64 = imageUrl.slice(commaIdx + 1).trim();
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      buffer = bytes.buffer;
    } else {
      const fetchRes = await fetch(imageUrl);
      if (!fetchRes.ok) return imageUrl;
      buffer = await fetchRes.arrayBuffer();
      mimeType = fetchRes.headers.get("content-type") ?? "image/png";
    }

    const ext =
      mimeType === "image/jpeg" ? "jpg"
      : mimeType === "image/webp" ? "webp"
      : "png";
    const filename = `${crypto.randomUUID()}.${ext}`;

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { error } = await supabase.storage
      .from(IMAGE_STORAGE_BUCKET)
      .upload(filename, buffer, { contentType: mimeType, upsert: false });

    if (error) {
      console.error("[/api/ai] Storage upload error:", error.message);
      return imageUrl;
    }

    return supabase.storage.from(IMAGE_STORAGE_BUCKET).getPublicUrl(filename).data.publicUrl;
  } catch (err) {
    console.error("[/api/ai] uploadGeneratedImage failed:", err);
    return imageUrl;
  }
}

async function callOpenRouter({
  apiKey,
  model,
  requestType,
  messages,
  modalities,
  imageConfig,
}: {
  apiKey: string;
  model: string;
  requestType: string;
  messages: OpenRouterMessage[];
  modalities?: Array<"text" | "image" | "audio">;
  imageConfig?: Record<string, string>;
}) {
  const payload: {
    model: string;
    messages: OpenRouterMessage[];
    modalities?: Array<"text" | "image" | "audio">;
    image_config?: Record<string, string>;
  } = {
    model,
    messages,
  };

  if (modalities) {
    payload.modalities = modalities;
  }

  if (imageConfig) {
    payload.image_config = imageConfig;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const rawBody = await res.text();

    if (!res.ok) {
      console.error("[/api/ai] OpenRouter API error");
      console.error("[/api/ai] request type:", requestType);
      console.error("[/api/ai] model:", model);
      console.error("[/api/ai] response status:", res.status);
      console.error("[/api/ai] raw response body:", rawBody);
      return { ok: false as const, data: null };
    }

    const data = JSON.parse(rawBody);
    return { ok: true as const, data };
  } catch (error) {
    clearTimeout(timeoutId);
    console.error("[/api/ai] OpenRouter request failed");
    console.error("[/api/ai] request type:", requestType);
    console.error("[/api/ai] model:", model);
    console.error("[/api/ai] raw response body:", "");
    console.error(error);
    return { ok: false as const, data: null };
  }
}

function extractMessageContent(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "text" &&
          "text" in item &&
          typeof item.text === "string"
        ) {
          return item.text;
        }

        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

function extractImageOutputs(data: unknown) {
  const message =
    typeof data === "object" &&
    data !== null &&
    "choices" in data &&
    Array.isArray(data.choices) &&
    data.choices[0] &&
    typeof data.choices[0] === "object" &&
    data.choices[0] !== null &&
    "message" in data.choices[0]
      ? data.choices[0].message
      : null;

  const urls: string[] = [];

  if (message && typeof message === "object" && "images" in message && Array.isArray(message.images)) {
    for (const image of message.images) {
      const normalizedUrl = normalizeImageValue(image);

      if (normalizedUrl) {
        urls.push(normalizedUrl);
      }

      if (
        typeof image === "object" &&
        image !== null &&
        "image_url" in image &&
        typeof image.image_url === "object" &&
        image.image_url !== null &&
        "url" in image.image_url &&
        typeof image.image_url.url === "string"
      ) {
        urls.push(image.image_url.url);
      }

      if (
        typeof image === "object" &&
        image !== null &&
        "imageUrl" in image &&
        typeof image.imageUrl === "object" &&
        image.imageUrl !== null &&
        "url" in image.imageUrl &&
        typeof image.imageUrl.url === "string"
      ) {
        urls.push(image.imageUrl.url);
      }
    }
  }

  if (message && typeof message === "object" && "content" in message && Array.isArray(message.content)) {
    for (const item of message.content) {
      const normalizedUrl = normalizeImageValue(item);

      if (normalizedUrl) {
        urls.push(normalizedUrl);
      }

      if (
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "image_url" &&
        "image_url" in item &&
        typeof item.image_url === "object" &&
        item.image_url !== null &&
        "url" in item.image_url &&
        typeof item.image_url.url === "string"
      ) {
        urls.push(item.image_url.url);
      }
    }
  }

  return [...new Set(urls)];
}

function normalizeImageValue(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.url === "string" && record.url.trim()) {
    return record.url;
  }

  if (typeof record.image_url === "string" && record.image_url.trim()) {
    return record.image_url;
  }

  if (typeof record.imageUrl === "string" && record.imageUrl.trim()) {
    return record.imageUrl;
  }

  const nestedImageUrl =
    record.image_url && typeof record.image_url === "object"
      ? (record.image_url as Record<string, unknown>)
      : null;

  if (nestedImageUrl && typeof nestedImageUrl.url === "string" && nestedImageUrl.url.trim()) {
    return nestedImageUrl.url;
  }

  const nestedImageUrlCamel =
    record.imageUrl && typeof record.imageUrl === "object"
      ? (record.imageUrl as Record<string, unknown>)
      : null;

  if (
    nestedImageUrlCamel &&
    typeof nestedImageUrlCamel.url === "string" &&
    nestedImageUrlCamel.url.trim()
  ) {
    return nestedImageUrlCamel.url;
  }

  const base64Value =
    typeof record.b64_json === "string"
      ? record.b64_json
      : typeof record.base64 === "string"
        ? record.base64
        : typeof record.data === "string"
          ? record.data
          : null;

  if (!base64Value) {
    return null;
  }

  if (base64Value.startsWith("data:image/")) {
    return base64Value;
  }

  const mimeType =
    typeof record.mime_type === "string"
      ? record.mime_type
      : typeof record.mimeType === "string"
        ? record.mimeType
        : "image/png";

  return `data:${mimeType};base64,${base64Value}`;
}

function getImageResponseDebugSummary(data: unknown) {
  if (!data || typeof data !== "object") {
    return "unknown";
  }

  const root = data as Record<string, unknown>;
  const choice =
    Array.isArray(root.choices) && root.choices[0] && typeof root.choices[0] === "object"
      ? (root.choices[0] as Record<string, unknown>)
      : null;
  const message =
    choice?.message && typeof choice.message === "object"
      ? (choice.message as Record<string, unknown>)
      : null;

  return JSON.stringify({
    rootKeys: Object.keys(root),
    choiceKeys: choice ? Object.keys(choice) : [],
    messageKeys: message ? Object.keys(message) : [],
    imageCount: message && Array.isArray(message.images) ? message.images.length : 0,
    contentCount: message && Array.isArray(message.content) ? message.content.length : 0,
  });
}

function extractJson<T>(text: string) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    return null;
  }

  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return null;
  }
}

async function generatePlanningResult({
  apiKey,
  industry,
  productService,
  requestId,
  previousResult,
}: {
  apiKey: string;
  industry: string;
  productService: string;
  requestId: string;
  previousResult?: AccountPlanResult | null;
}) {
  let lastError =
    "AI 기획 생성에 실패했습니다. 잠시 후 다시 시도해주세요.";
  let retryReason = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await callOpenRouter({
      apiKey,
      model: TEXT_MODEL,
      requestType: attempt === 0 ? "planning" : "planning_retry",
      messages: [
        {
          role: "user",
          content: buildPlanningPrompt({
            industry,
            productService,
            requestId,
            previousResult,
            retryReason,
          }),
        },
      ],
    });

    if (!response.ok) {
      lastError = "AI 기획 생성에 실패했습니다. 잠시 후 다시 시도해주세요.";
      retryReason = "JSON 형식과 필수 항목을 정확히 맞춰 다시 생성하세요.";
      continue;
    }

    const content = extractMessageContent(
      response.data?.choices?.[0]?.message?.content
    );
    const parsed = extractJson<AccountPlanResult>(content);

    if (!parsed) {
      console.error("[/api/ai] Failed to parse planning response");
      lastError = "AI 기획 결과를 불러오지 못했습니다. 다시 시도해주세요.";
      retryReason = "설명 없이 JSON 객체만 출력해야 합니다.";
      continue;
    }

    const normalized = normalizePlanningResult(parsed);
    const issues = getPlanningValidationIssues(normalized);

    if (issues.length === 0) {
      return { ok: true as const, data: normalized };
    }

    console.error("[/api/ai] Invalid planning response:", parsed);
    console.error("[/api/ai] Planning validation issues:", issues.join(", "));
    lastError = "AI 기획 결과를 다시 생성해주세요.";
    retryReason = issues.join(", ");
  }

  return { ok: false as const, error: lastError };
}

function buildPlanningPrompt({
  industry,
  productService,
  requestId,
  previousResult,
  retryReason,
}: {
  industry: string;
  productService: string;
  requestId: string;
  previousResult?: AccountPlanResult | null;
  retryReason?: string;
}) {
  const previousNames = Array.isArray(previousResult?.accountNames)
    ? previousResult.accountNames
        .map((item) => item.name)
        .filter(Boolean)
        .join(", ")
    : "";
  const previousPlan = previousResult?.accountPlan;

  return `
당신은 한국의 인스타그램 마케팅 전문가입니다.
아래 비즈니스 정보를 바탕으로 인스타그램 계정 기획을 해주세요.

업종: ${industry}
판매하는 상품/서비스: ${productService}

중요 규칙:
- accountNames의 name은 반드시 영문 소문자만 사용, 공백 없이, 짧고 브랜드감 있게
- accountNames의 name에는 숫자, 언더스코어, 하이픈, 특수문자를 넣지 마세요
- 업종을 직접적으로 포함하지 마세요. 창의적이고 기억하기 쉬운 이름으로
- meaning은 왜 이 이름을 추천하는지 한국어로 짧게 설명 (1문장)
- accountPlan의 모든 내용은 한국어, 이 비즈니스에 맞는 구체적 내용이어야 합니다
- bio는 인스타그램 소개란에 들어갈 2줄 매력적인 문구 (이모지 포함)
- 매번 완전히 새로운 결과를 생성하세요. 이전 결과를 반복하지 마세요.
- accountNames는 반드시 서로 달라야 하며, 정확히 3개만 제안하세요.
- generation_id(${requestId || "none"})를 참고해 이전 응답과 다른 표현을 사용하세요.
- 설명 문장, 머리말, 코드블록 없이 JSON 객체만 출력하세요

이전 생성 결과(절대 반복 금지):
- 이전 계정명: ${previousNames || "없음"}
- 이전 방향: ${String(previousPlan?.direction ?? "없음")}
- 이전 소개글: ${String(previousPlan?.bio ?? "없음")}
- 이전 컨셉: ${String(previousPlan?.concept ?? "없음")}

${
  retryReason
    ? `직전 응답 보정 지시:
- 직전 응답 문제: ${retryReason}
- 이번에는 위 문제를 모두 수정한 유효한 결과만 출력하세요.
`
    : ""
}
다음 JSON 형식으로만 답변하세요. 설명 없이 JSON만 출력하세요:
{
  "accountNames": [
    { "name": "englishnameone", "meaning": "추천 이유 한국어 설명" },
    { "name": "englishnametwo", "meaning": "추천 이유 한국어 설명" },
    { "name": "englishnamethree", "meaning": "추천 이유 한국어 설명" }
  ],
  "accountPlan": {
    "direction": "추천 계정 방향",
    "bio": "소개글 2줄",
    "concept": "운영 컨셉"
  }
}
`;
}

function normalizePlanningResult(parsed: AccountPlanResult): AccountPlanResult {
  const seenNames = new Set<string>();
  const normalizedNames = Array.isArray(parsed.accountNames)
    ? parsed.accountNames
        .map((item) => {
          const normalizedName = String(item?.name ?? "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z]/g, "");
          const rawMeaning = String(item?.meaning ?? "")
            .replace(/\s+/g, " ")
            .trim();

          return {
            name: normalizedName,
            meaning: /[가-힣]/.test(rawMeaning)
              ? rawMeaning
              : "브랜드 방향과 어울리는 이름입니다.",
          };
        })
        .filter((item) => {
          if (!item.name || seenNames.has(item.name)) {
            return false;
          }

          seenNames.add(item.name);
          return true;
        })
        .slice(0, 3)
    : [];

  return {
    accountNames: normalizedNames,
    accountPlan: {
      direction: String(parsed.accountPlan?.direction ?? "").trim(),
      bio: String(parsed.accountPlan?.bio ?? "").trim(),
      concept: String(parsed.accountPlan?.concept ?? "").trim(),
    },
  };
}

function getPlanningValidationIssues(result: AccountPlanResult) {
  const issues: string[] = [];
  const accountNames = result.accountNames ?? [];

  if (accountNames.length !== 3) {
    issues.push("accountNames는 정확히 3개여야 합니다");
  }

  if (!accountNames.every((item) => /^[a-z]+$/.test(String(item.name ?? "")))) {
    issues.push("accountNames의 name은 영문 소문자만 허용됩니다");
  }

  if (new Set(accountNames.map((item) => item.name)).size !== accountNames.length) {
    issues.push("accountNames는 서로 달라야 합니다");
  }

  if (!accountNames.every((item) => String(item.meaning ?? "").trim())) {
    issues.push("각 계정명에는 meaning이 필요합니다");
  }

  if (!result.accountPlan.direction.trim()) {
    issues.push("accountPlan.direction이 필요합니다");
  }

  if (!result.accountPlan.bio.trim()) {
    issues.push("accountPlan.bio가 필요합니다");
  }

  if (!result.accountPlan.concept.trim()) {
    issues.push("accountPlan.concept가 필요합니다");
  }

  return issues;
}

async function handleImageOnly(body: AiRequestBody, apiKey: string, request: Request) {
  const premiumAccess = await verifyPremiumGenerationAccess({
    usageMode: "premium",
    accessToken: String(body.accessToken ?? "").trim(),
    allowInternalTestBypass: body.isInternalTestAccount === true,
    request,
  });

  if (!premiumAccess.ok) {
    return Response.json({ error: premiumAccess.error }, { status: premiumAccess.statusCode });
  }

  const imageBase64 = String(body.imageEditBase64 ?? "").trim();
  const visualPromptRaw = String(body.visualPrompt ?? "").trim();

  if (!imageBase64 || !visualPromptRaw) {
    return Response.json(
      { error: "이미지와 visual prompt가 필요합니다." },
      { status: 400 }
    );
  }

  if (!/^data:image\/[\w.+-]+;base64,/.test(imageBase64)) {
    return Response.json(
      { error: "이미지 형식이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const preserveStructureInstruction = `Keep the overall composition, layout, and ANY text in the image exactly the same.
Change ONLY the feel/mood: lighting, color tone, texture, atmosphere.
Do NOT move, add, or remove the main subjects or any text.`;

  const suffix = body.rerollSuffix?.trim() || "Subtly refresh the mood while preserving the original image structure.";

  const imagePrompt = `You are editing this marketing image as an image-to-image variation.

Preserve-structure rules:
${preserveStructureInstruction}

Feel-only variation:
${suffix}

Original visual direction for context only:
${visualPromptRaw}

Output a polished square 1:1 Instagram feed post image.`;

  const imageResponse = await callOpenRouter({
    apiKey,
    model: IMAGE_MODEL,
    requestType: "post_image",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: imagePrompt },
          { type: "image_url", image_url: { url: imageBase64 } },
        ],
      },
    ],
    modalities: ["image", "text"],
    imageConfig: { aspect_ratio: "1:1", image_size: "1K" },
  });

  if (!imageResponse.ok) {
    return Response.json(
      { error: "이미지 재생성에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }

  const imageOutputs = extractImageOutputs(imageResponse.data);

  if (!imageOutputs.length) {
    return Response.json(
      { error: "이미지 결과를 불러오지 못했습니다. 다시 시도해주세요." },
      { status: 502 }
    );
  }

  const generatedImageUrl = await uploadGeneratedImage(imageOutputs[0]);

  const premiumUsageResult = await consumeVerifiedPremiumGenerationCredit(premiumAccess);
  if (!premiumUsageResult.ok) {
    return Response.json(
      { error: premiumUsageResult.error },
      { status: premiumUsageResult.statusCode }
    );
  }

  return Response.json({ generatedImageUrl, source: "api" });
}

async function handleImageEdit(body: AiRequestBody, apiKey: string, request: Request) {
  const premiumAccess = await verifyPremiumGenerationAccess({
    usageMode: "premium",
    accessToken: String(body.accessToken ?? "").trim(),
    allowInternalTestBypass: body.isInternalTestAccount === true,
    request,
  });

  if (!premiumAccess.ok) {
    return Response.json({ error: premiumAccess.error }, { status: premiumAccess.statusCode });
  }

  const imageBase64 = String(body.imageEditBase64 ?? "").trim();
  const editPromptRaw = String(body.editPrompt ?? "").trim();

  if (!imageBase64 || !editPromptRaw) {
    return Response.json(
      { error: "이미지와 수정 내용이 필요합니다." },
      { status: 400 }
    );
  }

  if (!/^data:image\/[\w.+-]+;base64,/.test(imageBase64)) {
    return Response.json(
      { error: "이미지 형식이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const normalizedIndustry = String(body.industry ?? "").trim();
  const normalizedProduct = String(body.productService ?? "").trim();

  const editPrompt = `You are editing this marketing image. Apply the following change:

"${editPromptRaw}"

${normalizedIndustry ? `Industry context: ${normalizedIndustry}` : ""}
${normalizedProduct ? `Product/service: ${normalizedProduct}` : ""}

Rules:
- Keep the overall composition and brand feel intact.
- Output a square 1:1 image.
- Prefer no baked-in text unless absolutely necessary.`;

  const imageResponse = await callOpenRouter({
    apiKey,
    model: IMAGE_MODEL,
    requestType: "post_image",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: editPrompt },
          { type: "image_url", image_url: { url: imageBase64 } },
        ],
      },
    ],
    modalities: ["image", "text"],
    imageConfig: { aspect_ratio: "1:1", image_size: "1K" },
  });

  if (!imageResponse.ok) {
    return Response.json(
      { error: "이미지 수정에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }

  const imageOutputs = extractImageOutputs(imageResponse.data);

  if (!imageOutputs.length) {
    return Response.json(
      { error: "수정된 이미지를 불러오지 못했습니다. 다시 시도해주세요." },
      { status: 502 }
    );
  }

  const generatedImageUrl = await uploadGeneratedImage(imageOutputs[0]);

  const premiumUsageResult = await consumeVerifiedPremiumGenerationCredit(premiumAccess);
  if (!premiumUsageResult.ok) {
    return Response.json(
      { error: premiumUsageResult.error },
      { status: premiumUsageResult.statusCode }
    );
  }

  return Response.json({ generatedImageUrl, source: "api" });
}
