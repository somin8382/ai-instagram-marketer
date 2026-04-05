import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  getSupabaseBrowserClient,
  getSupabasePublicClient,
  hasSupabaseEnv,
} from "./client";
import type { Database } from "./types";
import {
  getApplicationValidationIssues,
  getFirstValidationIssue,
  getGeneratedPostPersistenceIssues,
  isValidDurationSelection,
  isValidPlanSelection,
} from "../form-validation";
import {
  addMonthsToKoreaDateString,
  getEffectiveDailyUsageCount,
  getKoreaDateString,
  getRemainingDailyGenerationCount,
  getRemainingSubscriptionCredits,
  isPostGeneratorSubscriptionActive,
  POST_GENERATOR_DAILY_LIMIT,
  POST_GENERATOR_MONTHLY_CREDITS,
  POST_GENERATOR_PLAN_TYPE,
} from "../post-generator/subscription";

const AUTH_STORAGE_KEY = "qmeet-auth-state";
const PENDING_POSTS_STORAGE_KEY = "qmeet-pending-generated-posts";

export type AuthSnapshot = {
  isAuthenticated: boolean;
  authEmail: string;
  authName: string;
  userId: string;
  isRequestLinked: boolean;
};

type PendingGeneratedPost = {
  title: string;
  content: string;
  hashtags: string;
  imageUrl: string;
  isFreeTrial: boolean;
  applicationId?: string | null;
  email?: string | null;
  createdAt: string;
};

export type SavedGeneratedPost = {
  id: string;
  applicationId: string | null;
  title: string;
  content: string;
  hashtags: string;
  imageUrl: string;
  isFreeTrial: boolean;
  createdAt: string;
};

export type SavedApplication = {
  id: string;
  status: string;
  selectedPlan: number | null;
  selectedDuration: number | null;
  isExpress: boolean;
  createdAt: string;
  completionDate: string | null;
};

export type SavedPayment = {
  id: string;
  applicationId: string | null;
  expectedAmount: number | null;
  depositorName: string;
  paymentStatus: string | null;
  confirmedAt: string | null;
  createdAt: string;
};

export type SavedSubscription = {
  id: string;
  planType: string;
  startDate: string;
  endDate: string;
  remainingCredits: number;
  dailyUsageCount: number;
  lastUsageDate: string | null;
};

export type UsageSnapshot = {
  freeTrialUsed: boolean;
  hasActiveSubscription: boolean;
  remainingPostCount: number;
  totalPostLimit: number;
  usedPaidPostCount: number;
  dailyLimit: number;
  dailyRemainingCount: number;
  dailyUsageCount: number;
};

export type MyPageSnapshot = {
  application: SavedApplication | null;
  payment: SavedPayment | null;
  subscription: SavedSubscription | null;
  posts: SavedGeneratedPost[];
  usage: UsageSnapshot;
};

type ApplicationPersistenceInput = {
  userId?: string | null;
  email: string;
  instagramId: string;
  hasAccount: boolean;
  industry: string;
  productService: string;
  accountDirection?: string;
  accountBio?: string;
  accountConcept?: string;
  selectedPlan: number;
  selectedDuration: number;
  isExpress: boolean;
  completionDate?: string;
  managerName: string;
  phone: string;
  depositorName: string;
  taxInvoiceRequested: boolean;
  businessNumber?: string;
  companyName?: string;
  ceoName?: string;
  businessAddress?: string;
  businessType?: string;
  invoiceEmail?: string;
  amount: number;
  bankName: string;
  accountNumber: string;
  accountHolder: string;
};

type GeneratedPostPersistenceInput = {
  userId?: string | null;
  email?: string | null;
  applicationId?: string | null;
  title: string;
  content: string;
  hashtags: string;
  imageUrl: string;
  isFreeTrial: boolean;
};

type ApplicationRow = {
  id?: string | null;
  user_id?: string | null;
  email?: string | null;
  instagram_id?: string | null;
  industry?: string | null;
  product_service?: string | null;
  manager_name?: string | null;
  phone?: string | null;
  depositor_name?: string | null;
  status?: string | null;
  selected_plan?: number | null;
  selected_duration?: number | null;
  is_express?: boolean | null;
  created_at?: string | null;
  completion_date?: string | null;
};

type PaymentRow = {
  id?: string | null;
  application_id?: string | null;
  expected_amount?: number | null;
  depositor_name?: string | null;
  payment_status?: string | null;
  confirmed_at?: string | null;
  created_at?: string | null;
};

type GeneratedPostRow = {
  id?: string | null;
  application_id?: string | null;
  title?: string | null;
  content?: string | null;
  hashtags?: string | null;
  image_url?: string | null;
  is_free_trial?: boolean | null;
  created_at?: string | null;
};

type SubscriptionRow = {
  id?: string | null;
  user_id?: string | null;
  plan_type?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  remaining_credits?: number | null;
  daily_usage_count?: number | null;
  last_usage_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() ?? "";
}

function getEmailCandidates(...values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => normalizeEmail(value)).filter(Boolean))];
}

function getCreatedAtTime(value?: string | null) {
  if (!value) return 0;

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function buildGeneratedPostPayloads(input: {
  userId?: string | null;
  email?: string | null;
  applicationId?: string | null;
  title: string;
  content: string;
  hashtags: string;
  imageUrl: string;
  isFreeTrial: boolean;
  createdAt: string;
}) {
  return [
    {
      user_id: input.userId ?? null,
      application_id: input.applicationId ?? null,
      title: input.title,
      content: input.content,
      hashtags: input.hashtags,
      image_url: input.imageUrl,
      is_free_trial: input.isFreeTrial,
      created_at: input.createdAt,
    },
    {
      user_id: input.userId ?? null,
      application_id: input.applicationId ?? null,
      title: input.title,
      content: input.content,
      hashtags: input.hashtags,
      image_url: input.imageUrl,
      is_free_trial: input.isFreeTrial,
      created_at: input.createdAt,
    },
    {
      user_id: input.userId ?? null,
      title: input.title,
      content: input.content,
      hashtags: input.hashtags,
      image_url: input.imageUrl,
      is_free_trial: input.isFreeTrial,
      created_at: input.createdAt,
    },
    {
      application_id: input.applicationId ?? null,
      title: input.title,
      content: input.content,
      hashtags: input.hashtags,
      image_url: input.imageUrl,
      is_free_trial: input.isFreeTrial,
      created_at: input.createdAt,
    },
    {
      title: input.title,
      content: input.content,
      hashtags: input.hashtags,
      image_url: input.imageUrl,
      is_free_trial: input.isFreeTrial,
      created_at: input.createdAt,
    },
  ];
}

function buildAuthSnapshot(user: User, requestEmail?: string | null): AuthSnapshot {
  const authEmail = user.email ?? "";
  const authName =
    typeof user.user_metadata?.name === "string"
      ? user.user_metadata.name
      : typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name
        : "";

  return {
    isAuthenticated: true,
    authEmail,
    authName,
    userId: user.id,
    isRequestLinked:
      !!requestEmail &&
      normalizeEmail(requestEmail) === normalizeEmail(authEmail),
  };
}

export function readPendingGeneratedPosts(): PendingGeneratedPost[] {
  if (typeof window === "undefined") return [];

  const raw = window.localStorage.getItem(PENDING_POSTS_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as PendingGeneratedPost[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    window.localStorage.removeItem(PENDING_POSTS_STORAGE_KEY);
    return [];
  }
}

function writePendingGeneratedPosts(posts: PendingGeneratedPost[]) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(PENDING_POSTS_STORAGE_KEY, JSON.stringify(posts));
}

export function queuePendingGeneratedPost(post: PendingGeneratedPost) {
  const current = readPendingGeneratedPosts();
  writePendingGeneratedPosts([post, ...current].slice(0, 10));
}

function saveAuthSnapshot(snapshot: AuthSnapshot) {
  if (typeof window === "undefined") return;

  window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(snapshot));
}

function clearPendingGeneratedPosts() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PENDING_POSTS_STORAGE_KEY);
}

async function tryInsert(
  table: "applications" | "payments" | "generated_posts",
  payloads: Array<Record<string, unknown>>,
  select = "id"
) {
  const supabase = getSupabaseBrowserClient();
  let lastError: string | null = null;

  for (const payload of payloads) {
    const response = (await ((
      supabase
        .from(table as never)
        .insert(payload as never)
        .select(select)
        .single() as unknown
    ) as Promise<{
      data: { id?: string } | null;
      error: { message: string } | null;
    }>)) as {
      data: { id?: string } | null;
      error: { message: string } | null;
    };
    const { data, error } = response;

    if (!error) {
      return { data, error: null as string | null };
    }

    lastError = error.message;
  }

  return { data: null, error: lastError };
}

function hasMissingApplicationPlanColumnError(message?: string | null) {
  if (!message) return false;

  const normalized = message.toLowerCase();

  return (
    normalized.includes("account_direction") ||
    normalized.includes("account_bio") ||
    normalized.includes("account_concept")
  );
}

const OPTIONAL_APPLICATION_COLUMNS = new Set([
  "has_account",
  "account_direction",
  "account_bio",
  "account_concept",
  "tax_invoice_requested",
  "business_number",
  "company_name",
  "ceo_name",
  "business_address",
  "business_type",
  "invoice_email",
]);

function getMissingApplicationColumnName(errorMessage?: string | null) {
  if (!errorMessage) {
    return null;
  }

  const schemaCacheMatch = errorMessage.match(
    /could not find the '([^']+)' column of 'applications'/i
  );

  if (schemaCacheMatch?.[1]) {
    return schemaCacheMatch[1];
  }

  const relationColumnMatch = errorMessage.match(
    /column\s+applications\.([a-z0-9_]+)\s+does not exist/i
  );

  if (relationColumnMatch?.[1]) {
    return relationColumnMatch[1];
  }

  return null;
}

async function tryProfileUpsert(payloads: Array<Record<string, unknown>>) {
  const supabase = getSupabaseBrowserClient();
  let lastError: string | null = null;

  for (const payload of payloads) {
    const response = (await ((
      supabase
        .from("profiles")
        .upsert(payload as never, { onConflict: "id" }) as unknown
    ) as Promise<{
      error: { message: string } | null;
    }>)) as {
      error: { message: string } | null;
    };
    const { error } = response;

    if (!error) {
      return { error: null as string | null };
    }

    lastError = error.message;
  }

  return { error: lastError };
}

async function fetchApplicationsByColumn(
  client: SupabaseClient<Database>,
  column: "user_id" | "email",
  value: string
) {
  const query = client
    .from("applications")
    .select(
      "id, user_id, email, instagram_id, industry, product_service, manager_name, phone, depositor_name, status, selected_plan, selected_duration, is_express, created_at, completion_date"
    )
    .eq(column, value)
    .order("created_at", { ascending: false })
    .limit(10);

  return (await (query as unknown)) as {
    data: ApplicationRow[] | null;
    error: { message: string } | null;
  };
}

async function fetchPaymentsByApplicationId(
  client: SupabaseClient<Database>,
  applicationId: string
) {
  const query = client
    .from("payments")
    .select(
      "id, application_id, expected_amount, depositor_name, payment_status, confirmed_at, created_at"
    )
    .eq("application_id", applicationId)
    .order("created_at", { ascending: false })
    .limit(5);

  return (await (query as unknown)) as {
    data: PaymentRow[] | null;
    error: { message: string } | null;
  };
}

async function fetchGeneratedPostsByColumn(
  client: SupabaseClient<Database>,
  column: "user_id",
  value: string
) {
  const query = client
    .from("generated_posts")
    .select(
      "id, application_id, title, content, hashtags, image_url, is_free_trial, created_at"
    )
    .eq(column, value)
    .order("created_at", { ascending: false })
    .limit(30);

  return (await (query as unknown)) as {
    data: GeneratedPostRow[] | null;
    error: { message: string } | null;
  };
}

async function fetchGeneratedPostsByApplicationIds(
  client: SupabaseClient<Database>,
  applicationIds: string[]
) {
  if (!applicationIds.length) {
    return {
      data: [] as GeneratedPostRow[],
      error: null as { message: string } | null,
    };
  }

  const query = client
    .from("generated_posts")
    .select(
      "id, application_id, title, content, hashtags, image_url, is_free_trial, created_at"
    )
    .in("application_id", applicationIds)
    .order("created_at", { ascending: false })
    .limit(30);

  return (await (query as unknown)) as {
    data: GeneratedPostRow[] | null;
    error: { message: string } | null;
  };
}

async function fetchSubscriptionByUserId(
  client: SupabaseClient<Database>,
  userId: string
) {
  const query = client
    .from("subscriptions")
    .select(
      "id, user_id, plan_type, start_date, end_date, remaining_credits, daily_usage_count, last_usage_date, created_at, updated_at"
    )
    .eq("user_id", userId)
    .eq("plan_type", POST_GENERATOR_PLAN_TYPE)
    .order("updated_at", { ascending: false })
    .limit(1);

  return (await (query as unknown)) as {
    data: SubscriptionRow[] | null;
    error: { message: string } | null;
  };
}

function mapGeneratedPostRow(post: GeneratedPostRow): SavedGeneratedPost {
  return {
    id: String(post.id ?? ""),
    applicationId:
      typeof post.application_id === "string" && post.application_id
        ? post.application_id
        : null,
    title: String(post.title ?? "").trim(),
    content: String(post.content ?? "").trim(),
    hashtags: String(post.hashtags ?? "").trim(),
    imageUrl: String(post.image_url ?? "").trim(),
    isFreeTrial: Boolean(post.is_free_trial),
    createdAt: String(post.created_at ?? ""),
  };
}

function mapSubscriptionRow(row?: SubscriptionRow | null): SavedSubscription | null {
  if (!row?.id) {
    return null;
  }

  return {
    id: String(row.id),
    planType: String(row.plan_type ?? POST_GENERATOR_PLAN_TYPE),
    startDate: String(row.start_date ?? ""),
    endDate: String(row.end_date ?? ""),
    remainingCredits: Math.max(Number(row.remaining_credits ?? 0), 0),
    dailyUsageCount: Math.max(Number(row.daily_usage_count ?? 0), 0),
    lastUsageDate:
      typeof row.last_usage_date === "string" && row.last_usage_date
        ? row.last_usage_date
        : null,
  };
}

function createUsageSnapshot({
  posts,
  subscription,
}: {
  posts: SavedGeneratedPost[];
  subscription: SavedSubscription | null;
}): UsageSnapshot {
  const hasActiveSubscription = isPostGeneratorSubscriptionActive(subscription);
  const remainingPostCount = hasActiveSubscription
    ? getRemainingSubscriptionCredits(subscription)
    : 0;
  const totalPostLimit = hasActiveSubscription ? POST_GENERATOR_MONTHLY_CREDITS : 0;
  const dailyUsageCount = hasActiveSubscription
    ? getEffectiveDailyUsageCount(subscription)
    : 0;
  const dailyRemainingCount = hasActiveSubscription
    ? getRemainingDailyGenerationCount(subscription)
    : 0;

  return {
    freeTrialUsed: posts.some((post) => post.isFreeTrial),
    hasActiveSubscription,
    remainingPostCount,
    totalPostLimit,
    usedPaidPostCount: hasActiveSubscription
      ? Math.max(totalPostLimit - remainingPostCount, 0)
      : 0,
    dailyLimit: hasActiveSubscription ? POST_GENERATOR_DAILY_LIMIT : 0,
    dailyRemainingCount,
    dailyUsageCount,
  };
}

function toKoreanSubscriptionErrorMessage(message?: string | null) {
  if (!message) {
    return "구독 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.";
  }

  const normalized = message.toLowerCase();

  if (
    normalized.includes("subscriptions") ||
    normalized.includes("relation") ||
    normalized.includes("404")
  ) {
    return "구독 기능 설정을 확인해주세요.";
  }

  return "구독 정보를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

function mergeSavedPosts(rows: GeneratedPostRow[]) {
  const seen = new Set<string>();

  return rows
    .map(mapGeneratedPostRow)
    .filter((post) => {
      if (
        !post.id ||
        !post.title ||
        !post.content ||
        !post.hashtags ||
        !post.imageUrl
      ) {
        return false;
      }

      if (seen.has(post.id)) {
        return false;
      }

      seen.add(post.id);
      return true;
    })
    .sort((a, b) => getCreatedAtTime(b.createdAt) - getCreatedAtTime(a.createdAt));
}

function isCompleteApplicationRow(row: ApplicationRow) {
  return (
    getApplicationValidationIssues({
      selectedPlan:
        typeof row.selected_plan === "number" ? row.selected_plan : null,
      selectedDuration:
        typeof row.selected_duration === "number" ? row.selected_duration : null,
      instagramId:
        typeof row.instagram_id === "string" ? row.instagram_id : null,
      industry: typeof row.industry === "string" ? row.industry : null,
      productService:
        typeof row.product_service === "string" ? row.product_service : null,
      managerName:
        typeof row.manager_name === "string" ? row.manager_name : null,
      phone: typeof row.phone === "string" ? row.phone : null,
      email: typeof row.email === "string" ? row.email : null,
      depositorName:
        typeof row.depositor_name === "string" ? row.depositor_name : null,
      isExpress: Boolean(row.is_express),
      completionDate:
        typeof row.completion_date === "string" ? row.completion_date : null,
    }).length === 0
  );
}

async function linkExistingRecordsToUser({
  userId,
  emails,
}: {
  userId: string;
  emails: string[];
}) {
  if (!emails.length) {
    return {
      linkedApplicationCount: 0,
      linkedGeneratedPostCount: 0,
      error: null as string | null,
    };
  }

  const publicClient = getSupabasePublicClient();
  const errors: string[] = [];
  const linkedApplicationIds = new Set<string>();
  let linkedApplicationCount = 0;
  let linkedGeneratedPostCount = 0;

  for (const email of emails) {
    const applicationUpdate = (await ((publicClient
      .from("applications")
      .update({ user_id: userId } as never)
      .eq("email", email)
      .is("user_id", null)
      .select("id") as unknown) as Promise<{
      data: Array<{ id?: string | null }> | null;
      error: { message: string } | null;
    }>)) as {
      data: Array<{ id?: string | null }> | null;
      error: { message: string } | null;
    };

    if (applicationUpdate.error) {
      errors.push(`applications:${applicationUpdate.error.message}`);
    } else {
      linkedApplicationCount += applicationUpdate.data?.length ?? 0;

      for (const row of applicationUpdate.data ?? []) {
        if (row.id) {
          linkedApplicationIds.add(String(row.id));
        }
      }
    }

    const applicationsByEmail = await fetchApplicationsByColumn(
      publicClient,
      "email",
      email
    );

    if (applicationsByEmail.error) {
      errors.push(`applications_lookup:${applicationsByEmail.error.message}`);
    } else {
      for (const row of applicationsByEmail.data ?? []) {
        if (row.id) {
          linkedApplicationIds.add(String(row.id));
        }
      }
    }
  }

  if (linkedApplicationIds.size > 0) {
    const generatedPostUpdate = (await ((publicClient
      .from("generated_posts")
      .update({ user_id: userId } as never)
      .in("application_id", [...linkedApplicationIds])
      .is("user_id", null)
      .select("id") as unknown) as Promise<{
      data: Array<{ id?: string | null }> | null;
      error: { message: string } | null;
    }>)) as {
      data: Array<{ id?: string | null }> | null;
      error: { message: string } | null;
    };

    if (generatedPostUpdate.error) {
      errors.push(`generated_posts:${generatedPostUpdate.error.message}`);
    } else {
      linkedGeneratedPostCount += generatedPostUpdate.data?.length ?? 0;
    }
  }

  console.info(
    "[Supabase Link] 아이디(이메일) 기준 연결 결과:",
    JSON.stringify({
      userId,
      emails,
      linkedApplicationCount,
      linkedGeneratedPostCount,
      hasError: errors.length > 0,
    })
  );

  return {
    linkedApplicationCount,
    linkedGeneratedPostCount,
    error: errors.length ? errors.join(" / ") : null,
  };
}

export async function syncProfileAndLinkData({
  user,
  requestEmail,
}: {
  user: User;
  requestEmail?: string | null;
}) {
  if (!hasSupabaseEnv()) {
    return {
      snapshot: buildAuthSnapshot(user, requestEmail),
      error: "Supabase 환경 변수가 설정되지 않았습니다.",
    };
  }

  const snapshot = buildAuthSnapshot(user, requestEmail);

  const profileResult = await tryProfileUpsert([
    {
      id: user.id,
      name: snapshot.authName || null,
      email: snapshot.authEmail || null,
      created_at: new Date().toISOString(),
    },
    {
      id: user.id,
      email: snapshot.authEmail || null,
    },
  ]);

  const emailCandidates = getEmailCandidates(snapshot.authEmail, requestEmail);
  const linkResult = await linkExistingRecordsToUser({
    userId: user.id,
    emails: emailCandidates,
  });

  await flushPendingGeneratedPosts({
    userId: user.id,
    email: snapshot.authEmail || emailCandidates[0] || null,
  });

  saveAuthSnapshot(snapshot);

  const combinedErrors = [profileResult.error, linkResult.error].filter(Boolean);

  return {
    snapshot,
    error: combinedErrors.length ? combinedErrors.join(" / ") : null,
  };
}

export async function persistApplicationSubmission(
  input: ApplicationPersistenceInput
) {
  if (!hasSupabaseEnv()) {
    return {
      applicationId: null,
      paymentId: null,
      error: "Supabase 환경 변수가 설정되지 않았습니다.",
    };
  }

  const normalizedEmail = normalizeEmail(input.email);
  const normalizedInstagramId = input.instagramId.trim();
  const normalizedIndustry = input.industry.trim();
  const normalizedProductService = input.productService.trim();
  const normalizedManagerName = input.managerName.trim();
  const normalizedPhone = input.phone.trim();
  const normalizedDepositorName = input.depositorName.trim();
  const normalizedCompletionDate = input.completionDate?.trim() ?? "";
  const validationIssues = getApplicationValidationIssues({
    selectedPlan: input.selectedPlan,
    selectedDuration: input.selectedDuration,
    instagramId: normalizedInstagramId,
    industry: normalizedIndustry,
    productService: normalizedProductService,
    managerName: normalizedManagerName,
    phone: normalizedPhone,
    email: normalizedEmail,
    depositorName: normalizedDepositorName,
    isExpress: input.isExpress,
    completionDate: normalizedCompletionDate,
  });
  const firstValidationIssue = getFirstValidationIssue(validationIssues);

  if (firstValidationIssue) {
    console.warn(
      "[Application] 저장 차단:",
      JSON.stringify({
        userId: input.userId ?? null,
        email: normalizedEmail || null,
        reason: firstValidationIssue.message,
      })
    );

    return {
      applicationId: null,
      paymentId: null,
      error: firstValidationIssue.message,
    };
  }

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return {
      applicationId: null,
      paymentId: null,
      error: "결제 금액을 다시 확인해주세요.",
    };
  }

  const createdAt = new Date().toISOString();

  const baseApplicationPayload: Record<string, unknown> = {
    user_id: input.userId ?? null,
    email: normalizedEmail,
    instagram_id: normalizedInstagramId,
    has_account: input.hasAccount,
    industry: normalizedIndustry,
    product_service: normalizedProductService,
    selected_plan: input.selectedPlan,
    selected_duration: input.selectedDuration,
    is_express: input.isExpress,
    completion_date: input.isExpress ? normalizedCompletionDate : null,
    manager_name: normalizedManagerName,
    phone: normalizedPhone,
    depositor_name: normalizedDepositorName,
    status: "waiting_for_payment",
    created_at: createdAt,
  };

  const optionalApplicationPayload: Record<string, unknown> = {};
  const normalizedAccountDirection = input.accountDirection?.trim() ?? "";
  const normalizedAccountBio = input.accountBio?.trim() ?? "";
  const normalizedAccountConcept = input.accountConcept?.trim() ?? "";
  const normalizedBusinessNumber = input.businessNumber?.trim() ?? "";
  const normalizedCompanyName = input.companyName?.trim() ?? "";
  const normalizedCeoName = input.ceoName?.trim() ?? "";
  const normalizedBusinessAddress = input.businessAddress?.trim() ?? "";
  const normalizedBusinessType = input.businessType?.trim() ?? "";
  const normalizedInvoiceEmail = input.invoiceEmail?.trim() ?? "";

  if (normalizedAccountDirection) {
    optionalApplicationPayload.account_direction = normalizedAccountDirection;
  }

  if (normalizedAccountBio) {
    optionalApplicationPayload.account_bio = normalizedAccountBio;
  }

  if (normalizedAccountConcept) {
    optionalApplicationPayload.account_concept = normalizedAccountConcept;
  }

  if (input.taxInvoiceRequested) {
    optionalApplicationPayload.tax_invoice_requested = true;
  }

  if (normalizedBusinessNumber) {
    optionalApplicationPayload.business_number = normalizedBusinessNumber;
  }

  if (normalizedCompanyName) {
    optionalApplicationPayload.company_name = normalizedCompanyName;
  }

  if (normalizedCeoName) {
    optionalApplicationPayload.ceo_name = normalizedCeoName;
  }

  if (normalizedBusinessAddress) {
    optionalApplicationPayload.business_address = normalizedBusinessAddress;
  }

  if (normalizedBusinessType) {
    optionalApplicationPayload.business_type = normalizedBusinessType;
  }

  if (normalizedInvoiceEmail) {
    optionalApplicationPayload.invoice_email = normalizedInvoiceEmail;
  }

  let applicationPayload: Record<string, unknown> = {
    ...baseApplicationPayload,
    ...optionalApplicationPayload,
  };

  let applicationResult = await tryInsert("applications", [
    applicationPayload,
  ]);

  const removedOptionalColumns: string[] = [];

  while (applicationResult.error) {
    const missingColumn = getMissingApplicationColumnName(applicationResult.error);

    if (
      !missingColumn ||
      !OPTIONAL_APPLICATION_COLUMNS.has(missingColumn) ||
      !(missingColumn in applicationPayload)
    ) {
      break;
    }

    const nextPayload = { ...applicationPayload };
    delete nextPayload[missingColumn];
    applicationPayload = nextPayload;
    removedOptionalColumns.push(missingColumn);

    applicationResult = await tryInsert("applications", [applicationPayload]);
  }

  if (
    applicationResult.error &&
    hasMissingApplicationPlanColumnError(applicationResult.error)
  ) {
    console.warn(
      "[Application] account_* 컬럼 미존재로 기본 payload로 재시도:",
      applicationResult.error
    );

    applicationResult = await tryInsert("applications", [baseApplicationPayload]);
  }

  if (removedOptionalColumns.length > 0) {
    console.warn(
      "[Application] 스키마 누락으로 제외된 선택 컬럼:",
      removedOptionalColumns.join(", ")
    );
  }

  if (applicationResult.error || !applicationResult.data) {
    return {
      applicationId: null,
      paymentId: null,
      error: applicationResult.error ?? "신청 정보를 저장하지 못했습니다.",
    };
  }

  const applicationId =
    typeof applicationResult.data === "object" && applicationResult.data !== null
      ? String((applicationResult.data as { id?: string }).id ?? "")
      : "";

  console.info(
    "[Application] 저장 결과:",
    JSON.stringify({
      applicationId: applicationId || null,
      email: normalizedEmail,
      userId: input.userId ?? null,
      selectedPlan: input.selectedPlan,
      selectedDuration: input.selectedDuration,
    })
  );

  const paymentResult = await tryInsert("payments", [
    {
      application_id: applicationId || null,
      expected_amount: input.amount,
      bank_name: input.bankName.trim(),
      account_number: input.accountNumber.trim(),
      account_holder: input.accountHolder.trim(),
      depositor_name: normalizedDepositorName,
      created_at: createdAt,
    },
  ]);

  console.info(
    "[Payment] 저장 결과:",
    JSON.stringify({
      applicationId: applicationId || null,
      paymentId:
        paymentResult.data &&
        typeof paymentResult.data === "object" &&
        "id" in paymentResult.data
          ? String((paymentResult.data as { id?: string }).id ?? "")
          : null,
      amount: input.amount,
      depositorName: normalizedDepositorName,
      hasError: Boolean(paymentResult.error),
    })
  );

  return {
    applicationId: applicationId || null,
    paymentId:
      paymentResult.data &&
      typeof paymentResult.data === "object" &&
      "id" in paymentResult.data
        ? String((paymentResult.data as { id?: string }).id ?? "")
        : null,
    error: paymentResult.error,
  };
}

export async function persistGeneratedPost(
  input: GeneratedPostPersistenceInput
) {
  const createdAt = new Date().toISOString();
  const validationIssues = getGeneratedPostPersistenceIssues({
    title: input.title,
    content: input.content,
    hashtags: input.hashtags,
    imageUrl: input.imageUrl,
  });
  const firstValidationIssue = getFirstValidationIssue(validationIssues);

  if (firstValidationIssue) {
    console.warn(
      "[Generated Post] 저장 차단:",
      JSON.stringify({
        userId: input.userId ?? null,
        applicationId: input.applicationId ?? null,
        reason: firstValidationIssue.message,
      })
    );

    return { saved: false, queued: false, error: firstValidationIssue.message };
  }

  if (!hasSupabaseEnv()) {
    queuePendingGeneratedPost({
      title: input.title,
      content: input.content,
      hashtags: input.hashtags,
      imageUrl: input.imageUrl,
      isFreeTrial: input.isFreeTrial,
      applicationId: input.applicationId ?? null,
      email: input.email ?? null,
      createdAt,
    });

    return { saved: false, queued: true, error: "Supabase 환경 변수가 설정되지 않았습니다." };
  }

  const payloads = buildGeneratedPostPayloads({
    ...input,
    createdAt,
  });

  const result = await tryInsert("generated_posts", payloads);

  if (result.error) {
    queuePendingGeneratedPost({
      title: input.title,
      content: input.content,
      hashtags: input.hashtags,
      imageUrl: input.imageUrl,
      isFreeTrial: input.isFreeTrial,
      applicationId: input.applicationId ?? null,
      email: input.email ?? null,
      createdAt,
    });

    return { saved: false, queued: true, error: result.error };
  }

  return { saved: true, queued: false, error: null as string | null };
}

export async function flushPendingGeneratedPosts({
  userId,
  email,
}: {
  userId: string;
  email?: string | null;
}) {
  const pendingPosts = readPendingGeneratedPosts();

  if (!pendingPosts.length || !hasSupabaseEnv()) {
    return;
  }

  const remainingPosts: PendingGeneratedPost[] = [];

  for (const post of pendingPosts) {
    const validationIssues = getGeneratedPostPersistenceIssues({
      title: post.title,
      content: post.content,
      hashtags: post.hashtags,
      imageUrl: post.imageUrl,
    });

    if (validationIssues.length > 0) {
      continue;
    }

    const result = await tryInsert(
      "generated_posts",
      buildGeneratedPostPayloads({
        userId,
        email: email ?? post.email ?? null,
        applicationId: post.applicationId ?? null,
        title: post.title,
        content: post.content,
        hashtags: post.hashtags,
        imageUrl: post.imageUrl,
        isFreeTrial: post.isFreeTrial,
        createdAt: post.createdAt,
      })
    );

    if (result.error) {
      remainingPosts.push(post);
    }
  }

  if (remainingPosts.length === 0) {
    clearPendingGeneratedPosts();
    return;
  }

  writePendingGeneratedPosts(remainingPosts);
}

export async function fetchPostGeneratorSubscription({
  userId,
}: {
  userId?: string | null;
}) {
  if (!hasSupabaseEnv()) {
    return {
      subscription: null as SavedSubscription | null,
      error: "Supabase 환경 변수가 설정되지 않았습니다.",
    };
  }

  if (!userId) {
    return {
      subscription: null as SavedSubscription | null,
      error: null as string | null,
    };
  }

  const supabase = getSupabaseBrowserClient();
  const response = await fetchSubscriptionByUserId(supabase, userId);

  if (response.error) {
    return {
      subscription: null as SavedSubscription | null,
      error: toKoreanSubscriptionErrorMessage(response.error.message),
    };
  }

  return {
    subscription: mapSubscriptionRow(response.data?.[0] ?? null),
    error: null as string | null,
  };
}

export async function startPostGeneratorSubscription({
  userId,
  bypassPaymentRequirement = false,
}: {
  userId?: string | null;
  bypassPaymentRequirement?: boolean;
}) {
  if (!hasSupabaseEnv()) {
    return {
      subscription: null as SavedSubscription | null,
      error: "Supabase 환경 변수가 설정되지 않았습니다.",
    };
  }

  if (!userId) {
    return {
      subscription: null as SavedSubscription | null,
      error: "로그인 후 구독을 시작해주세요.",
    };
  }

  const supabase = getSupabaseBrowserClient();
  const currentSubscriptionResult = await fetchPostGeneratorSubscription({
    userId,
  });

  if (currentSubscriptionResult.error) {
    return {
      subscription: null as SavedSubscription | null,
      error: currentSubscriptionResult.error,
    };
  }

  if (
    currentSubscriptionResult.subscription &&
    isPostGeneratorSubscriptionActive(currentSubscriptionResult.subscription)
  ) {
    return {
      subscription: currentSubscriptionResult.subscription,
      error: "이미 활성화된 구독입니다. 남은 생성 횟수를 먼저 사용해주세요.",
    };
  }

  if (!bypassPaymentRequirement) {
    const userApplicationResponse = await fetchApplicationsByColumn(
      supabase,
      "user_id",
      userId
    );

    if (userApplicationResponse.error) {
      return {
        subscription: null as SavedSubscription | null,
        error: "결제 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.",
      };
    }

    const latestApplication = userApplicationResponse.data?.[0] ?? null;

    if (!latestApplication?.id) {
      return {
        subscription: null as SavedSubscription | null,
        error: "입금 확인 후 구독이 활성화됩니다.",
      };
    }

    const paymentResponse = await fetchPaymentsByApplicationId(
      supabase,
      String(latestApplication.id)
    );

    if (paymentResponse.error) {
      return {
        subscription: null as SavedSubscription | null,
        error: "결제 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.",
      };
    }

    const latestPayment = paymentResponse.data?.[0] ?? null;

    if (latestPayment?.payment_status !== "confirmed") {
      return {
        subscription: null as SavedSubscription | null,
        error: "입금 확인 후 구독이 활성화됩니다.",
      };
    }
  }

  const startDate = getKoreaDateString();
  const endDate = addMonthsToKoreaDateString(startDate, 1);

  const response = (await ((
    supabase
      .from("subscriptions")
      .upsert(
        {
          user_id: userId,
          plan_type: POST_GENERATOR_PLAN_TYPE,
          start_date: startDate,
          end_date: endDate,
          remaining_credits: POST_GENERATOR_MONTHLY_CREDITS,
          daily_usage_count: 0,
          last_usage_date: null,
        } as never,
        { onConflict: "user_id,plan_type" }
      )
      .select(
        "id, user_id, plan_type, start_date, end_date, remaining_credits, daily_usage_count, last_usage_date, created_at, updated_at"
      )
      .single() as unknown
  ) as Promise<{
    data: SubscriptionRow | null;
    error: { message: string } | null;
  }>)) as {
    data: SubscriptionRow | null;
    error: { message: string } | null;
  };

  if (response.error) {
    return {
      subscription: null as SavedSubscription | null,
      error: toKoreanSubscriptionErrorMessage(response.error.message),
    };
  }

  return {
    subscription: mapSubscriptionRow(response.data),
    error: null as string | null,
  };
}

export async function consumePostGeneratorSubscriptionCredit({
  userId,
}: {
  userId?: string | null;
}) {
  if (!hasSupabaseEnv()) {
    return {
      subscription: null as SavedSubscription | null,
      error: "Supabase 환경 변수가 설정되지 않았습니다.",
    };
  }

  if (!userId) {
    return {
      subscription: null as SavedSubscription | null,
      error: "로그인 후 이용해주세요.",
    };
  }

  const currentSubscriptionResult = await fetchPostGeneratorSubscription({ userId });

  if (currentSubscriptionResult.error) {
    return {
      subscription: null as SavedSubscription | null,
      error: currentSubscriptionResult.error,
    };
  }

  const subscription = currentSubscriptionResult.subscription;

  if (!subscription || !isPostGeneratorSubscriptionActive(subscription)) {
    return {
      subscription: null as SavedSubscription | null,
      error: "월 구독 후 이용할 수 있습니다.",
    };
  }

  if (getRemainingSubscriptionCredits(subscription) <= 0) {
    return {
      subscription,
      error: "남은 생성 횟수가 없습니다",
    };
  }

  if (getRemainingDailyGenerationCount(subscription) <= 0) {
    return {
      subscription,
      error: "오늘 생성 가능한 횟수를 모두 사용했습니다",
    };
  }

  const supabase = getSupabaseBrowserClient();
  const today = getKoreaDateString();
  const nextRemainingCredits = getRemainingSubscriptionCredits(subscription) - 1;
  const nextDailyUsageCount = getEffectiveDailyUsageCount(subscription, today) + 1;

  const response = (await ((
    supabase
      .from("subscriptions")
      .update(
        {
          remaining_credits: nextRemainingCredits,
          daily_usage_count: nextDailyUsageCount,
          last_usage_date: today,
        } as never
      )
      .eq("id", subscription.id)
      .select(
        "id, user_id, plan_type, start_date, end_date, remaining_credits, daily_usage_count, last_usage_date, created_at, updated_at"
      )
      .single() as unknown
  ) as Promise<{
    data: SubscriptionRow | null;
    error: { message: string } | null;
  }>)) as {
    data: SubscriptionRow | null;
    error: { message: string } | null;
  };

  if (response.error) {
    return {
      subscription,
      error: toKoreanSubscriptionErrorMessage(response.error.message),
    };
  }

  return {
    subscription: mapSubscriptionRow(response.data),
    error: null as string | null,
  };
}

export async function fetchSavedGeneratedPosts({
  userId,
  email,
}: {
  userId?: string | null;
  email?: string | null;
}) {
  if (!hasSupabaseEnv()) {
    return {
      posts: [] as SavedGeneratedPost[],
      error: "Supabase 환경 변수가 설정되지 않았습니다.",
    };
  }

  const supabase = getSupabaseBrowserClient();
  const publicClient = getSupabasePublicClient();
  const normalizedEmail = normalizeEmail(email);
  const errors: string[] = [];
  const rows: GeneratedPostRow[] = [];
  const applicationIds = new Set<string>();

  if (!userId && !normalizedEmail) {
    return { posts: [] as SavedGeneratedPost[], error: null as string | null };
  }

  if (userId) {
    const userResponse = await fetchGeneratedPostsByColumn(
      supabase,
      "user_id",
      userId
    );

    if (userResponse.error) {
      errors.push(userResponse.error.message);
    } else {
      rows.push(...(userResponse.data ?? []));
    }

    const userApplicationsResponse = await fetchApplicationsByColumn(
      supabase,
      "user_id",
      userId
    );

    if (userApplicationsResponse.error) {
      errors.push(userApplicationsResponse.error.message);
    } else {
      for (const row of userApplicationsResponse.data ?? []) {
        if (row.id) {
          applicationIds.add(String(row.id));
        }
      }
    }
  }

  if (normalizedEmail) {
    const emailApplicationsResponse = await fetchApplicationsByColumn(
      publicClient,
      "email",
      normalizedEmail
    );

    if (emailApplicationsResponse.error) {
      errors.push(emailApplicationsResponse.error.message);
    } else {
      for (const row of emailApplicationsResponse.data ?? []) {
        if (row.id) {
          applicationIds.add(String(row.id));
        }
      }
    }
  }

  if (applicationIds.size > 0) {
    const applicationPostsResponse = await fetchGeneratedPostsByApplicationIds(
      publicClient,
      [...applicationIds]
    );

    if (applicationPostsResponse.error) {
      errors.push(applicationPostsResponse.error.message);
    } else {
      rows.push(...(applicationPostsResponse.data ?? []));
    }
  }

  const posts = mergeSavedPosts(rows);

  console.info(
    "[Generated Posts] 조회 결과:",
    JSON.stringify({
      userId: userId ?? null,
      email: normalizedEmail || null,
      count: posts.length,
      usedEmailFallback: Boolean(normalizedEmail),
      hasError: errors.length > 0,
    })
  );

  return {
    posts,
    error: errors.length ? errors.join(" / ") : null,
  };
}

export async function fetchMyPageSnapshot({
  userId,
  email,
}: {
  userId?: string | null;
  email?: string | null;
}) {
  const emptyUsage: UsageSnapshot = {
    freeTrialUsed: false,
    hasActiveSubscription: false,
    remainingPostCount: 0,
    totalPostLimit: 0,
    usedPaidPostCount: 0,
    dailyLimit: 0,
    dailyRemainingCount: 0,
    dailyUsageCount: 0,
  };

  if (!hasSupabaseEnv()) {
    return {
      snapshot: {
        application: null,
        payment: null,
        subscription: null,
        posts: [] as SavedGeneratedPost[],
        usage: emptyUsage,
      },
      error: "Supabase 환경 변수가 설정되지 않았습니다.",
    };
  }

  const supabase = getSupabaseBrowserClient();
  const publicClient = getSupabasePublicClient();
  const emailCandidates = getEmailCandidates(email);
  const errors: string[] = [];
  let subscription: SavedSubscription | null = null;

  const postsResult = await fetchSavedGeneratedPosts({
    userId,
    email: emailCandidates[0] || null,
  });

  if (postsResult.error) {
    errors.push(postsResult.error);
  }

  if (userId) {
    const subscriptionResult = await fetchPostGeneratorSubscription({ userId });

    if (subscriptionResult.error) {
      errors.push(subscriptionResult.error);
    } else {
      subscription = subscriptionResult.subscription;
    }
  }

  const applicationRows: ApplicationRow[] = [];

  if (userId) {
    const userApplicationResponse = await fetchApplicationsByColumn(
      supabase,
      "user_id",
      userId
    );

    if (userApplicationResponse.error) {
      errors.push(userApplicationResponse.error.message);
    } else {
      applicationRows.push(...(userApplicationResponse.data ?? []));
    }
  }

  for (const candidateEmail of emailCandidates) {
    const emailApplicationResponse = await fetchApplicationsByColumn(
      publicClient,
      "email",
      candidateEmail
    );

    if (emailApplicationResponse.error) {
      errors.push(emailApplicationResponse.error.message);
    } else {
      applicationRows.push(...(emailApplicationResponse.data ?? []));
    }
  }

  const applicationRow =
    (() => {
      const uniqueRows = [...new Map(
        applicationRows.map((row) => [String(row.id ?? ""), row])
      ).values()]
        .filter((row) => !!row.id)
        .sort(
          (a, b) => getCreatedAtTime(b.created_at) - getCreatedAtTime(a.created_at)
        );

      return uniqueRows.find(isCompleteApplicationRow) ?? uniqueRows[0] ?? null;
    })();

  const application = applicationRow
    ? {
        id: String(applicationRow.id ?? ""),
        status: String(applicationRow.status ?? "").trim(),
        selectedPlan:
          isValidPlanSelection(applicationRow.selected_plan)
            ? applicationRow.selected_plan
            : null,
        selectedDuration:
          isValidDurationSelection(applicationRow.selected_duration)
            ? applicationRow.selected_duration
            : null,
        isExpress: Boolean(applicationRow.is_express),
        createdAt: String(applicationRow.created_at ?? ""),
        completionDate:
          typeof applicationRow.completion_date === "string" &&
          applicationRow.completion_date
            ? applicationRow.completion_date
            : null,
      }
    : null;

  let payment: SavedPayment | null = null;

  if (application?.id) {
    const paymentResponse = await fetchPaymentsByApplicationId(
      publicClient,
      application.id
    );

    if (paymentResponse.error) {
      errors.push(paymentResponse.error.message);
    }

    const paymentRow = paymentResponse.data?.[0] ?? null;

    if (paymentRow) {
      payment = {
        id: String(paymentRow.id ?? ""),
        applicationId:
          typeof paymentRow.application_id === "string" &&
          paymentRow.application_id
            ? paymentRow.application_id
            : null,
        expectedAmount:
          typeof paymentRow.expected_amount === "number"
            ? paymentRow.expected_amount
            : null,
        depositorName: String(paymentRow.depositor_name ?? "").trim(),
        paymentStatus:
          typeof paymentRow.payment_status === "string"
            ? paymentRow.payment_status
            : null,
        confirmedAt:
          typeof paymentRow.confirmed_at === "string" && paymentRow.confirmed_at
            ? paymentRow.confirmed_at
            : null,
        createdAt: String(paymentRow.created_at ?? ""),
      };
    }
  }

  const posts = postsResult.posts;
  const usage = createUsageSnapshot({
    posts,
    subscription,
  });

  console.info(
    "[MyPage] 조회 결과:",
    JSON.stringify({
      userId: userId ?? null,
      emails: emailCandidates,
      applicationId: application?.id ?? null,
      paymentId: payment?.id ?? null,
      subscriptionId: subscription?.id ?? null,
      postCount: posts.length,
      remainingPostCount: usage.remainingPostCount,
      hasError: errors.length > 0,
    })
  );

  return {
    snapshot: {
      application,
      payment,
      subscription,
      posts,
      usage,
    },
    error: errors.length ? errors.join(" / ") : null,
  };
}
