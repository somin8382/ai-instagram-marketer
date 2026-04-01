import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, hasSupabaseEnv } from "./client";

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
  title: string;
  content: string;
  hashtags: string;
  imageUrl: string;
  isFreeTrial: boolean;
  createdAt: string;
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

function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() ?? "";
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
  const normalizedEmail = normalizeEmail(input.email);

  return [
    {
      user_id: input.userId ?? null,
      application_id: input.applicationId ?? null,
      email: normalizedEmail || null,
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
      email: normalizedEmail || null,
      title: input.title,
      content: input.content,
      hashtags: input.hashtags,
      image_url: input.imageUrl,
      is_free_trial: input.isFreeTrial,
    },
    {
      user_id: input.userId ?? null,
      title: input.title,
      content: input.content,
      hashtags: input.hashtags,
      image_url: input.imageUrl,
      is_free_trial: input.isFreeTrial,
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
  const supabase = getSupabaseBrowserClient();

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

  const normalizedEmail = normalizeEmail(snapshot.authEmail);

  if (normalizedEmail) {
    await (((supabase
      .from("applications")
      .update({ user_id: user.id } as never)
      .eq("email", normalizedEmail)
      .is("user_id", null)) as unknown) as Promise<unknown>);

    // The live payments table has no user/email linkage columns to backfill.
    try {
      await (((supabase
        .from("generated_posts")
        .update({ user_id: user.id } as never)
        .eq("email", normalizedEmail)
        .is("user_id", null)) as unknown) as Promise<unknown>);
    } catch (error) {
      console.warn(
        "[Generated Posts] 이메일 기준 연결을 건너뜁니다:",
        error instanceof Error ? error.message : "unknown"
      );
    }
  }

  await flushPendingGeneratedPosts({
    userId: user.id,
    email: snapshot.authEmail,
  });

  saveAuthSnapshot(snapshot);

  return {
    snapshot,
    error: profileResult.error,
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
  const createdAt = new Date().toISOString();

  const applicationPayloads = [
    {
      user_id: input.userId ?? null,
      email: normalizedEmail,
      instagram_id: input.instagramId,
      has_account: input.hasAccount,
      industry: input.industry,
      product_service: input.productService,
      account_direction: input.accountDirection ?? null,
      account_bio: input.accountBio ?? null,
      account_concept: input.accountConcept ?? null,
      selected_plan: input.selectedPlan,
      selected_duration: input.selectedDuration,
      is_express: input.isExpress,
      completion_date: input.completionDate || null,
      manager_name: input.managerName,
      phone: input.phone,
      depositor_name: input.depositorName,
      tax_invoice_requested: input.taxInvoiceRequested,
      business_number: input.businessNumber ?? null,
      company_name: input.companyName ?? null,
      ceo_name: input.ceoName ?? null,
      business_address: input.businessAddress ?? null,
      business_type: input.businessType ?? null,
      invoice_email: input.invoiceEmail ?? null,
      status: "waiting_for_payment",
      created_at: createdAt,
    },
    {
      email: normalizedEmail,
      instagram_id: input.instagramId,
      industry: input.industry,
      product_service: input.productService,
      manager_name: input.managerName,
      phone: input.phone,
      depositor_name: input.depositorName,
      status: "waiting_for_payment",
    },
  ];

  const applicationResult = await tryInsert("applications", applicationPayloads);

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

  const paymentResult = await tryInsert("payments", [
    {
      application_id: applicationId || null,
      expected_amount: input.amount,
      bank_name: input.bankName,
      account_number: input.accountNumber,
      account_holder: input.accountHolder,
      depositor_name: input.depositorName,
      created_at: createdAt,
    },
  ]);

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
  const normalizedEmail = normalizeEmail(email);
  const selectColumns =
    "id, title, content, hashtags, image_url, is_free_trial, created_at";

  const runQuery = async (column: "user_id" | "email", value: string) => {
    const query = supabase
      .from("generated_posts")
      .select(selectColumns)
      .eq(column, value)
      .order("created_at", { ascending: false })
      .limit(30);

    return (await (query as unknown)) as {
      data:
        | Array<{
            id?: string | null;
            title?: string | null;
            content?: string | null;
            hashtags?: string | null;
            image_url?: string | null;
            is_free_trial?: boolean | null;
            created_at?: string | null;
          }>
        | null;
      error: { message: string } | null;
    };
  };

  let response:
    | {
        data:
          | Array<{
              id?: string | null;
              title?: string | null;
              content?: string | null;
              hashtags?: string | null;
              image_url?: string | null;
              is_free_trial?: boolean | null;
              created_at?: string | null;
            }>
          | null;
        error: { message: string } | null;
      }
    | null = null;

  if (userId) {
    response = await runQuery("user_id", userId);
  } else if (normalizedEmail) {
    response = await runQuery("email", normalizedEmail);
  } else {
    return { posts: [] as SavedGeneratedPost[], error: null as string | null };
  }

  if (response?.error) {
    return {
      posts: [] as SavedGeneratedPost[],
      error: response.error.message,
    };
  }

  const posts = (response?.data ?? [])
    .map((post) => ({
      id: String(post.id ?? ""),
      title: String(post.title ?? "").trim(),
      content: String(post.content ?? "").trim(),
      hashtags: String(post.hashtags ?? "").trim(),
      imageUrl: String(post.image_url ?? "").trim(),
      isFreeTrial: Boolean(post.is_free_trial),
      createdAt: String(post.created_at ?? ""),
    }))
    .filter(
      (post) =>
        !!post.id &&
        !!post.title &&
        !!post.content &&
        !!post.hashtags &&
        !!post.imageUrl
    );

  return {
    posts,
    error: null as string | null,
  };
}
