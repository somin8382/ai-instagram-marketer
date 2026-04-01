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

export type UsageSnapshot = {
  freeTrialUsed: boolean;
  remainingPostCount: number;
  totalPostLimit: number;
  usedPaidPostCount: number;
};

export type MyPageSnapshot = {
  application: SavedApplication | null;
  payment: SavedPayment | null;
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

function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() ?? "";
}

function getEmailCandidates(...values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => normalizeEmail(value)).filter(Boolean))];
}

function getPostGenerationLimit(duration?: number | null) {
  if (duration === 1) return 4;
  if (duration === 2) return 8;
  return 0;
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
    "[Supabase Link] 이메일 기준 연결 결과:",
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

  const applicationResult = await tryInsert("applications", [
    {
      user_id: input.userId ?? null,
      email: normalizedEmail,
      instagram_id: normalizedInstagramId,
      has_account: input.hasAccount,
      industry: normalizedIndustry,
      product_service: normalizedProductService,
      account_direction: input.accountDirection?.trim() || null,
      account_bio: input.accountBio?.trim() || null,
      account_concept: input.accountConcept?.trim() || null,
      selected_plan: input.selectedPlan,
      selected_duration: input.selectedDuration,
      is_express: input.isExpress,
      completion_date: input.isExpress ? normalizedCompletionDate : null,
      manager_name: normalizedManagerName,
      phone: normalizedPhone,
      depositor_name: normalizedDepositorName,
      tax_invoice_requested: input.taxInvoiceRequested,
      business_number: input.businessNumber?.trim() || null,
      company_name: input.companyName?.trim() || null,
      ceo_name: input.ceoName?.trim() || null,
      business_address: input.businessAddress?.trim() || null,
      business_type: input.businessType?.trim() || null,
      invoice_email: input.invoiceEmail?.trim() || null,
      status: "waiting_for_payment",
      created_at: createdAt,
    },
  ]);

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
    remainingPostCount: 0,
    totalPostLimit: 0,
    usedPaidPostCount: 0,
  };

  if (!hasSupabaseEnv()) {
    return {
      snapshot: {
        application: null,
        payment: null,
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

  const postsResult = await fetchSavedGeneratedPosts({
    userId,
    email: emailCandidates[0] || null,
  });

  if (postsResult.error) {
    errors.push(postsResult.error);
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
  const paidPosts = posts.filter((post) => !post.isFreeTrial);
  const relevantPaidPosts =
    application?.id && paidPosts.some((post) => post.applicationId === application.id)
      ? paidPosts.filter((post) => post.applicationId === application.id)
      : paidPosts;
  const totalPostLimit = getPostGenerationLimit(application?.selectedDuration);
  const usage: UsageSnapshot = {
    freeTrialUsed: posts.some((post) => post.isFreeTrial),
    totalPostLimit,
    usedPaidPostCount: relevantPaidPosts.length,
    remainingPostCount:
      totalPostLimit > 0
        ? Math.max(totalPostLimit - relevantPaidPosts.length, 0)
        : 0,
  };

  console.info(
    "[MyPage] 조회 결과:",
    JSON.stringify({
      userId: userId ?? null,
      emails: emailCandidates,
      applicationId: application?.id ?? null,
      paymentId: payment?.id ?? null,
      postCount: posts.length,
      remainingPostCount: usage.remainingPostCount,
      hasError: errors.length > 0,
    })
  );

  return {
    snapshot: {
      application,
      payment,
      posts,
      usage,
    },
    error: errors.length ? errors.join(" / ") : null,
  };
}
