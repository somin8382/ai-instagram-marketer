"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collectValidationIssues,
  getFieldError,
  getFirstValidationIssue,
  getIssueFields,
  isBlank,
  type ValidationIssue,
} from "@/lib/form-validation";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";
import {
  addMonthsToKoreaDateString,
  getKoreaDateString,
  getRemainingDailyGenerationCount,
  getRemainingSubscriptionCredits,
  isPostGeneratorSubscriptionActive,
  POST_GENERATOR_DAILY_LIMIT,
  POST_GENERATOR_MONTHLY_CREDITS,
  POST_GENERATOR_MONTHLY_PRICE,
} from "@/lib/post-generator/subscription";
import {
  clearTestAccountAccess,
  fetchTestAccountAccess,
  isTestAccountUser,
  TEST_ACCOUNT_AUTH_ID,
  TEST_ACCOUNT_DEFAULT_REMAINING_POSTS,
  TEST_ACCOUNT_NAME,
  TEST_ACCOUNT_USER_ID,
} from "@/lib/mock-account";
import {
  getHelperTextClass,
  getPrimaryActionButtonClass,
  getTextFieldClass,
  ValidationToast,
} from "@/lib/ui/form-feedback";
import {
  fetchPostGeneratorSubscription,
  fetchSavedGeneratedPosts,
  persistGeneratedPost,
  startPostGeneratorSubscription,
  syncProfileAndLinkData,
  type SavedGeneratedPost,
  type SavedSubscription,
} from "@/lib/supabase/persistence";

type ToolStep = "postgen" | "postsub-payment" | "postsub-status";

type ToolValidationField =
  | "postInput"
  | "postSubManagerName"
  | "postSubPhone"
  | "postSubEmail"
  | "postSubDepositorName"
  | "postSubBusinessNumber"
  | "postSubCompanyName"
  | "postSubCeoName"
  | "postSubBusinessAddress"
  | "postSubBusinessType"
  | "postSubInvoiceEmail";

type GeneratedPost = {
  id?: string;
  title: string;
  content: string;
  hashtags: string;
  imagePreview: string;
  imageModelText?: string;
  createdAt?: string;
  isPersisted?: boolean;
  isFreeTrial?: boolean;
};

type StoredAiResult = {
  accountPlan?: {
    direction?: string;
    bio?: string;
    concept?: string;
  };
};

const APP_STORAGE_KEY = "qmeet-app-state";
const AUTH_STORAGE_KEY = "qmeet-auth-state";

const POST_SUBSCRIPTION_BANK_TRANSFER_INFO = {
  bankName: "하나은행",
  accountNumber: "588-910292-72307",
  accountHolder: "큐밋(Qmeet)",
};

function formatDateKorean(dateStr?: string | null): string {
  if (!dateStr) return "미정";
  const date = new Date(dateStr);

  if (Number.isNaN(date.getTime())) {
    return dateStr;
  }

  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function buildGeneratedPostSignature(post: GeneratedPost): string {
  if (post.id?.trim() && post.isPersisted) {
    return `id:${post.id.trim()}`;
  }

  return [
    post.title.trim(),
    post.content.trim(),
    post.imagePreview.trim(),
    post.hashtags.trim(),
  ].join("::");
}

function mergeGeneratedPostHistory(
  sessionPosts: GeneratedPost[],
  savedPosts: GeneratedPost[]
) {
  const merged = [...sessionPosts, ...savedPosts];
  const seen = new Set<string>();
  const deduped: GeneratedPost[] = [];

  for (const post of merged) {
    const signature = buildGeneratedPostSignature(post);

    if (seen.has(signature)) {
      continue;
    }

    seen.add(signature);
    deduped.push(post);
  }

  return deduped.sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  });
}

function mapSavedPostToGeneratedPost(post: SavedGeneratedPost): GeneratedPost {
  return {
    id: post.id,
    title: post.title,
    content: post.content,
    hashtags: post.hashtags,
    imagePreview: post.imageUrl,
    createdAt: post.createdAt,
    isPersisted: true,
    isFreeTrial: post.isFreeTrial,
  };
}

function buildTestAccountSubscription(
  remainingCredits = TEST_ACCOUNT_DEFAULT_REMAINING_POSTS
): SavedSubscription {
  const startDate = getKoreaDateString();

  return {
    id: `${TEST_ACCOUNT_USER_ID}-subscription`,
    planType: "post_generator",
    startDate,
    endDate: addMonthsToKoreaDateString(startDate, 1),
    remainingCredits: Math.max(remainingCredits, 0),
    dailyUsageCount: 0,
    lastUsageDate: null,
  };
}

function getToolsProgress(step: ToolStep) {
  if (step === "postgen") return null;
  if (step === "postsub-payment") return { current: 1, total: 2 };
  return { current: 2, total: 2 };
}

function InputField({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  type = "text",
  required = false,
  error,
  fieldKey,
  theme = "violet",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  error?: string;
  fieldKey?: string;
  theme?: "rose" | "violet";
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        data-validation-field={fieldKey}
        aria-invalid={Boolean(error)}
        className={getTextFieldClass({
          theme,
          hasError: Boolean(error),
        })}
      />
      {error && <p className={getHelperTextClass(theme)}>{error}</p>}
    </div>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  error,
  fieldKey,
  theme = "violet",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  error?: string;
  fieldKey?: string;
  theme?: "rose" | "violet";
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-700">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        data-validation-field={fieldKey}
        aria-invalid={Boolean(error)}
        className={`${getTextFieldClass({
          theme,
          hasError: Boolean(error),
        })} resize-none`}
      />
      {error && <p className={getHelperTextClass(theme)}>{error}</p>}
    </div>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-6 ${className}`}
    >
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
      {children}
    </p>
  );
}

function ToolsHeader({
  onBack,
  onHome,
  onMyPage,
  progress,
}: {
  onBack?: () => void;
  onHome: () => void;
  onMyPage: () => void;
  progress: { current: number; total: number } | null;
}) {
  return (
    <div className="sticky top-0 z-20 bg-[#f8f9fb] pb-3">
      <div className="space-y-3 rounded-2xl border border-gray-200 bg-white/90 px-4 py-3 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          {onBack ? (
            <button
              onClick={onBack}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-1"
            >
              ← 뒤로
            </button>
          ) : (
            <div className="h-5" aria-hidden="true" />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onHome}
              className="text-xs font-medium text-gray-600 hover:text-gray-800 transition-colors border border-gray-200 rounded-full px-3 py-1.5 bg-white"
            >
              홈
            </button>
            <button
              onClick={onMyPage}
              className="text-xs font-medium text-rose-600 hover:text-rose-700 transition-colors border border-rose-100 rounded-full px-3 py-1.5 bg-rose-50"
            >
              마이페이지
            </button>
          </div>
        </div>
        {progress && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-gray-500 font-medium">
              <span>구독 단계</span>
              <span>
                {progress.current}/{progress.total}
              </span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all duration-300"
                style={{
                  width: `${Math.max((progress.current / progress.total) * 100, 10)}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ToolsPage() {
  const router = useRouter();
  const [step, setStep] = useState<ToolStep>("postgen");
  const [hasHydrated, setHasHydrated] = useState(false);
  const [hasTestAccess, setHasTestAccess] = useState(false);
  const [validationToast, setValidationToast] = useState<string | null>(null);
  const [touchedFields, setTouchedFields] = useState<
    Partial<Record<ToolValidationField, boolean>>
  >({});

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authName, setAuthName] = useState("");
  const [userId, setUserId] = useState("");
  const [isRequestLinked, setIsRequestLinked] = useState(false);

  const [contextIndustry, setContextIndustry] = useState("");
  const [contextProductService, setContextProductService] = useState("");
  const [contextInstagramHandle, setContextInstagramHandle] = useState("");
  const [contextAccountDirection, setContextAccountDirection] = useState("");
  const [contextAccountBio, setContextAccountBio] = useState("");
  const [contextAccountConcept, setContextAccountConcept] = useState("");
  const [contextApplicationId, setContextApplicationId] = useState("");
  const [testRemainingPosts, setTestRemainingPosts] = useState(
    TEST_ACCOUNT_DEFAULT_REMAINING_POSTS
  );

  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [postPrompt, setPostPrompt] = useState("");
  const [generatingPost, setGeneratingPost] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [generatedPosts, setGeneratedPosts] = useState<GeneratedPost[]>([]);
  const [savedGeneratedPosts, setSavedGeneratedPosts] = useState<GeneratedPost[]>([]);
  const [loadingSavedPosts, setLoadingSavedPosts] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [freeTrialUsed, setFreeTrialUsed] = useState(false);
  const [postGeneratorSubscription, setPostGeneratorSubscription] =
    useState<SavedSubscription | null>(null);
  const [loadingSubscription, setLoadingSubscription] = useState(false);
  const [startingSubscription, setStartingSubscription] = useState(false);

  const [postSubManagerName, setPostSubManagerName] = useState("");
  const [postSubPhone, setPostSubPhone] = useState("");
  const [postSubEmail, setPostSubEmail] = useState("");
  const [postSubDepositorName, setPostSubDepositorName] = useState("");
  const [postSubTaxInvoiceRequested, setPostSubTaxInvoiceRequested] = useState(false);
  const [postSubBusinessNumber, setPostSubBusinessNumber] = useState("");
  const [postSubCompanyName, setPostSubCompanyName] = useState("");
  const [postSubCeoName, setPostSubCeoName] = useState("");
  const [postSubBusinessAddress, setPostSubBusinessAddress] = useState("");
  const [postSubBusinessType, setPostSubBusinessType] = useState("");
  const [postSubInvoiceEmail, setPostSubInvoiceEmail] = useState("");
  const [postSubRequestedAt, setPostSubRequestedAt] = useState("");
  const [postSubSubmitted, setPostSubSubmitted] = useState(false);
  const [submittingPostSubscription, setSubmittingPostSubscription] =
    useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const mergedGeneratedPosts = mergeGeneratedPostHistory(
    generatedPosts,
    savedGeneratedPosts
  );
  const hasConsumedFreeTrial =
    freeTrialUsed || mergedGeneratedPosts.some((post) => post.isFreeTrial);
  const isTestAccountAuthenticated =
    hasTestAccess && isTestAccountUser(userId, authEmail);
  const hasActivePostGeneratorSubscription =
    isAuthenticated && isPostGeneratorSubscriptionActive(postGeneratorSubscription);
  const remainingSubscriptionCredits = hasActivePostGeneratorSubscription
    ? getRemainingSubscriptionCredits(postGeneratorSubscription)
    : 0;
  const remainingDailyGenerations = hasActivePostGeneratorSubscription
    ? getRemainingDailyGenerationCount(postGeneratorSubscription)
    : 0;
  const canUseSubscriptionPostGeneration =
    hasActivePostGeneratorSubscription &&
    remainingSubscriptionCredits > 0 &&
    remainingDailyGenerations > 0;
  const canUseFreeTrial = !hasConsumedFreeTrial;
  const canGeneratePost = canUseSubscriptionPostGeneration || canUseFreeTrial;
  const shouldShowPostLock = !canGeneratePost;
  const isDailyLimitReached =
    hasActivePostGeneratorSubscription &&
    remainingSubscriptionCredits > 0 &&
    remainingDailyGenerations === 0;
  const isSubscriptionCreditEmpty =
    hasActivePostGeneratorSubscription && remainingSubscriptionCredits === 0;
  const formattedSubscriptionPrice =
    POST_GENERATOR_MONTHLY_PRICE.toLocaleString();

  const suggestedPostPrompts = [
    `${contextIndustry || "브랜드"}의 첫 인사를 전하면서 ${
      contextProductService || "서비스"
    }의 매력을 자연스럽게 소개하는 게시물로 만들어주세요.`,
    `${contextProductService || "서비스"}를 처음 보는 사람이 한눈에 이해하고 관심을 가질 수 있는 홍보 게시물로 만들어주세요.`,
    `${contextAccountConcept || contextAccountDirection || "브랜드 방향"}을 살려 팔로우를 유도할 수 있는 분위기의 게시물로 만들어주세요.`,
  ].map((item) => item.replace(/\s+/g, " ").trim());

  function showValidationToast(message: string) {
    setValidationToast(message);
  }

  function markFieldsTouched(fields: ToolValidationField[]) {
    if (!fields.length) return;

    setTouchedFields((current) => {
      const next = { ...current };

      for (const field of fields) {
        next[field] = true;
      }

      return next;
    });
  }

  function markFieldTouched(field: ToolValidationField) {
    markFieldsTouched([field]);
  }

  function focusValidationField(field: ToolValidationField) {
    if (typeof document === "undefined") return;

    const target = document.querySelector<HTMLElement>(
      `[data-validation-field="${field}"]`
    );

    target?.focus();
  }

  function surfaceValidationIssues(issues: ValidationIssue<ToolValidationField>[]) {
    const firstIssue = getFirstValidationIssue(issues);

    if (!firstIssue) {
      return true;
    }

    markFieldsTouched(getIssueFields(issues));
    showValidationToast(firstIssue.message);
    focusValidationField(firstIssue.field);
    return false;
  }

  function getPostGenerationValidationIssues() {
    return collectValidationIssues<ToolValidationField>([
      {
        field: "postInput",
        message: isDailyLimitReached
          ? "오늘 생성 가능한 횟수를 모두 사용했습니다"
          : isSubscriptionCreditEmpty
            ? "남은 생성 횟수가 없습니다"
            : "월 구독 후 이용할 수 있습니다",
        isMissing: !canUseSubscriptionPostGeneration && !canUseFreeTrial,
      },
      {
        field: "postInput",
        message: "참고 이미지 또는 게시물 방향을 입력해주세요",
        isMissing: uploadedImages.length === 0 && isBlank(postPrompt),
      },
    ]);
  }

  function getPostSubscriptionPaymentValidationIssues() {
    return collectValidationIssues<ToolValidationField>([
      {
        field: "postSubManagerName",
        message: "담당자명을 입력해주세요",
        isMissing: isBlank(postSubManagerName),
      },
      {
        field: "postSubPhone",
        message: "연락처를 입력해주세요",
        isMissing: isBlank(postSubPhone),
      },
      {
        field: "postSubEmail",
        message: "아이디(이메일)를 입력해주세요",
        isMissing: isBlank(postSubEmail),
      },
      {
        field: "postSubDepositorName",
        message: "입금자명을 입력해주세요",
        isMissing: isBlank(postSubDepositorName),
      },
      {
        field: "postSubBusinessNumber",
        message: "사업자등록번호를 입력해주세요",
        isMissing: postSubTaxInvoiceRequested && isBlank(postSubBusinessNumber),
      },
      {
        field: "postSubCompanyName",
        message: "상호를 입력해주세요",
        isMissing: postSubTaxInvoiceRequested && isBlank(postSubCompanyName),
      },
      {
        field: "postSubCeoName",
        message: "대표자명을 입력해주세요",
        isMissing: postSubTaxInvoiceRequested && isBlank(postSubCeoName),
      },
      {
        field: "postSubBusinessAddress",
        message: "사업장 주소를 입력해주세요",
        isMissing: postSubTaxInvoiceRequested && isBlank(postSubBusinessAddress),
      },
      {
        field: "postSubBusinessType",
        message: "업태/종목을 입력해주세요",
        isMissing: postSubTaxInvoiceRequested && isBlank(postSubBusinessType),
      },
      {
        field: "postSubInvoiceEmail",
        message: "세금계산서 아이디(이메일)를 입력해주세요",
        isMissing: postSubTaxInvoiceRequested && isBlank(postSubInvoiceEmail),
      },
    ]);
  }

  const postGenerationValidationIssues = getPostGenerationValidationIssues();
  const postSubscriptionPaymentValidationIssues =
    getPostSubscriptionPaymentValidationIssues();

  const postInputError = getFieldError(
    postGenerationValidationIssues,
    "postInput",
    touchedFields
  );
  const postSubManagerNameError = getFieldError(
    postSubscriptionPaymentValidationIssues,
    "postSubManagerName",
    touchedFields
  );
  const postSubPhoneError = getFieldError(
    postSubscriptionPaymentValidationIssues,
    "postSubPhone",
    touchedFields
  );
  const postSubEmailError = getFieldError(
    postSubscriptionPaymentValidationIssues,
    "postSubEmail",
    touchedFields
  );
  const postSubDepositorNameError = getFieldError(
    postSubscriptionPaymentValidationIssues,
    "postSubDepositorName",
    touchedFields
  );
  const postSubBusinessNumberError = getFieldError(
    postSubscriptionPaymentValidationIssues,
    "postSubBusinessNumber",
    touchedFields
  );
  const postSubCompanyNameError = getFieldError(
    postSubscriptionPaymentValidationIssues,
    "postSubCompanyName",
    touchedFields
  );
  const postSubCeoNameError = getFieldError(
    postSubscriptionPaymentValidationIssues,
    "postSubCeoName",
    touchedFields
  );
  const postSubBusinessAddressError = getFieldError(
    postSubscriptionPaymentValidationIssues,
    "postSubBusinessAddress",
    touchedFields
  );
  const postSubBusinessTypeError = getFieldError(
    postSubscriptionPaymentValidationIssues,
    "postSubBusinessType",
    touchedFields
  );
  const postSubInvoiceEmailError = getFieldError(
    postSubscriptionPaymentValidationIssues,
    "postSubInvoiceEmail",
    touchedFields
  );

  const isPostGenerationReady = postGenerationValidationIssues.length === 0;
  const isPostSubscriptionPaymentReady =
    postSubscriptionPaymentValidationIssues.length === 0;

  useEffect(() => {
    if (typeof window === "undefined") return;

    const savedAppState = window.localStorage.getItem(APP_STORAGE_KEY);
    const savedAuthState = window.localStorage.getItem(AUTH_STORAGE_KEY);

    if (savedAppState) {
      try {
        const parsed = JSON.parse(savedAppState) as {
          step?: string;
          hasAccount?: boolean | null;
          instagramId?: string;
          finalInstagramId?: string;
          industry?: string;
          productService?: string;
          aiResult?: StoredAiResult | null;
          applicationId?: string;
          remainingPosts?: number;
          generatedPosts?: GeneratedPost[];
          freeTrialUsed?: boolean;
          postSubManagerName?: string;
          postSubPhone?: string;
          postSubEmail?: string;
          postSubDepositorName?: string;
          postSubTaxInvoiceRequested?: boolean;
          postSubBusinessNumber?: string;
          postSubCompanyName?: string;
          postSubCeoName?: string;
          postSubBusinessAddress?: string;
          postSubBusinessType?: string;
          postSubInvoiceEmail?: string;
          postSubRequestedAt?: string;
          postSubSubmitted?: boolean;
        };

        if (
          parsed.step === "postsub-payment" ||
          parsed.step === "postsub-status" ||
          parsed.step === "postgen"
        ) {
          if (parsed.step === "postsub-status" && parsed.postSubSubmitted) {
            setStep("postsub-status");
          } else if (parsed.step === "postsub-payment") {
            setStep("postsub-payment");
          } else {
            setStep("postgen");
          }
        }

        setContextIndustry(parsed.industry ?? "");
        setContextProductService(parsed.productService ?? "");
        setContextApplicationId(parsed.applicationId ?? "");
        setTestRemainingPosts(
          typeof parsed.remainingPosts === "number" && parsed.remainingPosts >= 0
            ? parsed.remainingPosts
            : TEST_ACCOUNT_DEFAULT_REMAINING_POSTS
        );

        const hasAccount = parsed.hasAccount === true;
        setContextInstagramHandle(
          hasAccount
            ? (parsed.instagramId ?? "").trim()
            : (parsed.finalInstagramId ?? "").trim()
        );

        setContextAccountDirection(
          parsed.aiResult?.accountPlan?.direction?.trim() ?? ""
        );
        setContextAccountBio(parsed.aiResult?.accountPlan?.bio?.trim() ?? "");
        setContextAccountConcept(
          parsed.aiResult?.accountPlan?.concept?.trim() ?? ""
        );

        setGeneratedPosts(
          Array.isArray(parsed.generatedPosts)
            ? parsed.generatedPosts
                .filter(
                  (post) =>
                    !!post &&
                    typeof post === "object" &&
                    typeof post.title === "string" &&
                    typeof post.content === "string" &&
                    typeof post.hashtags === "string" &&
                    typeof post.imagePreview === "string"
                )
                .slice(0, 2)
            : []
        );
        setFreeTrialUsed(Boolean(parsed.freeTrialUsed));
        setPostSubManagerName(parsed.postSubManagerName ?? "");
        setPostSubPhone(parsed.postSubPhone ?? "");
        setPostSubEmail(parsed.postSubEmail ?? "");
        setPostSubDepositorName(parsed.postSubDepositorName ?? "");
        setPostSubTaxInvoiceRequested(Boolean(parsed.postSubTaxInvoiceRequested));
        setPostSubBusinessNumber(parsed.postSubBusinessNumber ?? "");
        setPostSubCompanyName(parsed.postSubCompanyName ?? "");
        setPostSubCeoName(parsed.postSubCeoName ?? "");
        setPostSubBusinessAddress(parsed.postSubBusinessAddress ?? "");
        setPostSubBusinessType(parsed.postSubBusinessType ?? "");
        setPostSubInvoiceEmail(parsed.postSubInvoiceEmail ?? "");
        setPostSubRequestedAt(parsed.postSubRequestedAt ?? "");
        setPostSubSubmitted(Boolean(parsed.postSubSubmitted));
      } catch {
        window.localStorage.removeItem(APP_STORAGE_KEY);
      }
    }

    if (savedAuthState) {
      try {
        const parsed = JSON.parse(savedAuthState) as {
          isAuthenticated?: boolean;
          authEmail?: string;
          authName?: string;
          userId?: string;
          isRequestLinked?: boolean;
        };
        setIsAuthenticated(Boolean(parsed.isAuthenticated));
        setAuthEmail(parsed.authEmail ?? "");
        setAuthName(parsed.authName ?? "");
        setUserId(parsed.userId ?? "");
        setIsRequestLinked(Boolean(parsed.isRequestLinked));
      } catch {
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    }

    setHasHydrated(true);
  }, []);

  useEffect(() => {
    if (!hasHydrated || typeof window === "undefined") return;

    let currentAppState: Record<string, unknown> = {};

    try {
      const raw = window.localStorage.getItem(APP_STORAGE_KEY);
      currentAppState = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      currentAppState = {};
    }

    const appStatePayload = {
      ...currentAppState,
      step,
      freeTrialUsed,
      generatedPosts: generatedPosts.slice(0, 2).map((post) => ({
        id: post.id,
        title: post.title,
        content: post.content,
        hashtags: post.hashtags,
        imagePreview: post.imagePreview,
        imageModelText: post.imageModelText,
        createdAt: post.createdAt,
        isPersisted: post.isPersisted,
        isFreeTrial: post.isFreeTrial,
      })),
      postSubManagerName,
      postSubPhone,
      postSubEmail,
      postSubDepositorName,
      postSubTaxInvoiceRequested,
      postSubBusinessNumber,
      postSubCompanyName,
      postSubCeoName,
      postSubBusinessAddress,
      postSubBusinessType,
      postSubInvoiceEmail,
      postSubRequestedAt,
      postSubSubmitted,
      remainingPosts: isTestAccountAuthenticated
        ? remainingSubscriptionCredits
        : currentAppState.remainingPosts,
    };

    window.localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(appStatePayload));
    window.localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        isAuthenticated,
        authEmail,
        authName,
        userId,
        isRequestLinked,
      })
    );
  }, [
    hasHydrated,
    step,
    freeTrialUsed,
    generatedPosts,
    postSubManagerName,
    postSubPhone,
    postSubEmail,
    postSubDepositorName,
    postSubTaxInvoiceRequested,
    postSubBusinessNumber,
    postSubCompanyName,
    postSubCeoName,
    postSubBusinessAddress,
    postSubBusinessType,
    postSubInvoiceEmail,
    postSubRequestedAt,
    postSubSubmitted,
    isAuthenticated,
    authEmail,
    authName,
    userId,
    isRequestLinked,
    isTestAccountAuthenticated,
    remainingSubscriptionCredits,
  ]);

  useEffect(() => {
    if (!hasHydrated) return;

    let active = true;

    void fetchTestAccountAccess().then((enabled) => {
      if (!active) return;
      setHasTestAccess(enabled);
    });

    return () => {
      active = false;
    };
  }, [hasHydrated]);

  useEffect(() => {
    if (!hasHydrated || !isTestAccountAuthenticated) {
      return;
    }

    setIsAuthenticated(true);
    setAuthEmail(TEST_ACCOUNT_AUTH_ID);
    if (!authName.trim()) {
      setAuthName(TEST_ACCOUNT_NAME);
    }
    setUserId(TEST_ACCOUNT_USER_ID);
    setIsRequestLinked(true);

    setPostGeneratorSubscription((current) => {
      if (current && isPostGeneratorSubscriptionActive(current)) {
        return current;
      }

      return buildTestAccountSubscription(
        testRemainingPosts > 0 ? testRemainingPosts : TEST_ACCOUNT_DEFAULT_REMAINING_POSTS
      );
    });
  }, [
    hasHydrated,
    isTestAccountAuthenticated,
    authName,
    testRemainingPosts,
  ]);

  useEffect(() => {
    if (!hasHydrated) return;
    if (isTestAccountAuthenticated) return;

    const supabase = getSupabaseBrowserClientOrNull();
    if (!supabase) {
      return;
    }

    let active = true;

    const syncAuth = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!active) return;

      if (!user) {
        setIsAuthenticated(false);
        setAuthEmail("");
        setAuthName("");
        setUserId("");
        setIsRequestLinked(false);
        return;
      }

      const { snapshot } = await syncProfileAndLinkData({
        user,
        requestEmail: postSubEmail || authEmail,
      });

      if (!active) return;

      setIsAuthenticated(snapshot.isAuthenticated);
      setAuthEmail(snapshot.authEmail);
      setAuthName(snapshot.authName);
      setUserId(snapshot.userId);
      setIsRequestLinked(snapshot.isRequestLinked);
    };

    void syncAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;

      if (!session?.user) {
        setIsAuthenticated(false);
        setAuthEmail("");
        setAuthName("");
        setUserId("");
        setIsRequestLinked(false);
        return;
      }

      void syncProfileAndLinkData({
        user: session.user,
        requestEmail: postSubEmail || authEmail,
      }).then(({ snapshot }) => {
        if (!active) return;

        setIsAuthenticated(snapshot.isAuthenticated);
        setAuthEmail(snapshot.authEmail);
        setAuthName(snapshot.authName);
        setUserId(snapshot.userId);
        setIsRequestLinked(snapshot.isRequestLinked);
      });
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [hasHydrated, postSubEmail, authEmail, isTestAccountAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    if (!postSubEmail.trim() && authEmail.trim()) {
      setPostSubEmail(authEmail.trim());
    }

    if (!postSubManagerName.trim() && authName.trim()) {
      setPostSubManagerName(authName.trim());
    }
  }, [isAuthenticated, authEmail, authName, postSubEmail, postSubManagerName]);

  useEffect(() => {
    if (isTestAccountAuthenticated) {
      setSavedGeneratedPosts([]);
      setLoadingSavedPosts(false);
      return;
    }

    if (!isAuthenticated || !userId) {
      setSavedGeneratedPosts([]);
      setLoadingSavedPosts(false);
      return;
    }

    let isActive = true;
    setLoadingSavedPosts(true);

    void fetchSavedGeneratedPosts({
      userId,
      email: authEmail || postSubEmail || null,
    })
      .then(({ posts, error }) => {
        if (!isActive) return;

        if (error) {
          setPostError(error);
        }

        setSavedGeneratedPosts(posts.map((post) => mapSavedPostToGeneratedPost(post)));
      })
      .finally(() => {
        if (isActive) {
          setLoadingSavedPosts(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [isAuthenticated, userId, authEmail, postSubEmail, isTestAccountAuthenticated]);

  useEffect(() => {
    if (isTestAccountAuthenticated) {
      setLoadingSubscription(false);
      return;
    }

    if (!isAuthenticated || !userId) {
      setPostGeneratorSubscription(null);
      setLoadingSubscription(false);
      return;
    }

    let isActive = true;
    setLoadingSubscription(true);

    void fetchPostGeneratorSubscription({ userId })
      .then(({ subscription, error }) => {
        if (!isActive) return;

        if (error) {
          setPostError(error);
        }

        setPostGeneratorSubscription(subscription);
      })
      .finally(() => {
        if (isActive) {
          setLoadingSubscription(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [isAuthenticated, userId, isTestAccountAuthenticated]);

  useEffect(() => {
    if (!savedGeneratedPosts.length) {
      return;
    }

    if (savedGeneratedPosts.some((post) => post.isFreeTrial)) {
      setFreeTrialUsed(true);
    }
  }, [savedGeneratedPosts]);

  useEffect(() => {
    if (!hasHydrated) return;

    if (typeof window === "undefined") return;

    const screen = new URLSearchParams(window.location.search).get("screen");
    if (!screen) return;

    if (screen === "payment" || screen === "postsub-payment") {
      setStep(hasActivePostGeneratorSubscription ? "postgen" : "postsub-payment");
      router.replace("/tools");
      return;
    }

    if (screen === "status" || screen === "postsub-status") {
      if (hasActivePostGeneratorSubscription) {
        setStep("postgen");
      } else if (postSubSubmitted) {
        setStep("postsub-status");
      } else {
        setStep("postsub-payment");
      }
      router.replace("/tools");
      return;
    }

    if (screen === "postgen") {
      setStep("postgen");
      router.replace("/tools");
    }
  }, [
    hasHydrated,
    router,
    hasActivePostGeneratorSubscription,
    postSubSubmitted,
  ]);

  function openAuthPage(tab?: "login" | "signup") {
    const params = new URLSearchParams({ redirect: "tools" });
    if (tab) params.set("tab", tab);
    router.push(`/auth?${params.toString()}`);
  }

  function navigateBack() {
    if (step === "postsub-status") {
      setStep("postsub-payment");
      return;
    }

    if (step === "postsub-payment") {
      setStep("postgen");
      return;
    }

    router.push("/");
  }

  async function handleLogout() {
    await clearTestAccountAccess();

    const supabase = getSupabaseBrowserClientOrNull();
    if (supabase) {
      await supabase.auth.signOut();
    }

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    }

    setIsAuthenticated(false);
    setAuthEmail("");
    setAuthName("");
    setUserId("");
    setIsRequestLinked(false);
    setHasTestAccess(false);
    setPostGeneratorSubscription(null);
  }

  function handleMoveToPostSubscriptionPayment() {
    if (hasActivePostGeneratorSubscription) {
      showValidationToast("이미 월 구독이 활성화되어 있습니다");
      return;
    }

    if (!isAuthenticated) {
      openAuthPage("login");
      return;
    }

    setStep("postsub-payment");
  }

  async function handlePostSubscriptionSubmit() {
    if (submittingPostSubscription) {
      return;
    }

    if (!surfaceValidationIssues(postSubscriptionPaymentValidationIssues)) {
      return;
    }

    setSubmittingPostSubscription(true);

    try {
      setPostSubSubmitted(true);
      setPostSubRequestedAt(new Date().toISOString());
      setStep("postsub-status");
    } finally {
      setSubmittingPostSubscription(false);
    }
  }

  async function handleActivatePostSubscription() {
    if (startingSubscription) {
      return;
    }

    if (hasActivePostGeneratorSubscription) {
      showValidationToast("이미 월 구독이 활성화되어 있습니다");
      setStep("postgen");
      return;
    }

    if (isTestAccountAuthenticated) {
      setPostGeneratorSubscription(
        buildTestAccountSubscription(POST_GENERATOR_MONTHLY_CREDITS)
      );
      setPostSubSubmitted(true);
      setPostSubRequestedAt((current) => current || new Date().toISOString());
      setFreeTrialUsed(true);
      showValidationToast("체험 계정 월 구독이 활성화되었습니다");
      setStep("postgen");
      return;
    }

    if (!isAuthenticated || !userId) {
      openAuthPage("login");
      return;
    }

    setStartingSubscription(true);
    setPostError(null);

    try {
      const result = await startPostGeneratorSubscription({
        userId,
        bypassPaymentRequirement: true,
      });

      if (result.error || !result.subscription) {
        throw new Error(result.error ?? "구독을 시작하지 못했습니다.");
      }

      setPostGeneratorSubscription(result.subscription);
      setPostSubSubmitted(true);
      setPostSubRequestedAt((current) => current || new Date().toISOString());
      setFreeTrialUsed(true);
      showValidationToast("월 구독이 시작되었습니다");
      setStep("postgen");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "구독을 시작하지 못했습니다. 다시 시도해주세요.";
      setPostError(message);
      showValidationToast(message);
    } finally {
      setStartingSubscription(false);
    }
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(
      0,
      Math.max(0, 2 - uploadedImages.length)
    );
    if (files.length === 0) return;

    Promise.all(
      files.map(
        (file) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error("이미지 업로드에 실패했습니다."));
            reader.readAsDataURL(file);
          })
      )
    )
      .then((results) => {
        setUploadedImages((prev) => [...prev, ...results].slice(0, 2));
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      })
      .catch(() => {
        setPostError("이미지 업로드에 실패했습니다. 다시 시도해주세요.");
      });
  }

  function handleRemoveUploadedImage(index: number) {
    setUploadedImages((prev) => prev.filter((_, imageIndex) => imageIndex !== index));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleGeneratePost() {
    if (generatingPost) {
      return;
    }

    if (!surfaceValidationIssues(postGenerationValidationIssues)) {
      return;
    }

    setGeneratingPost(true);
    setPostError(null);

    const latestPostContext = mergedGeneratedPosts[0];
    const isFreeTrialGeneration = canUseFreeTrial && !canUseSubscriptionPostGeneration;
    let accessToken = "";

    if (!isFreeTrialGeneration && !isTestAccountAuthenticated) {
      const supabase = getSupabaseBrowserClientOrNull();

      if (!supabase) {
        setGeneratingPost(false);
        const message = "로그인 정보를 확인할 수 없습니다. 다시 로그인해주세요.";
        setPostError(message);
        showValidationToast(message);
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      accessToken = session?.access_token ?? "";

      if (!accessToken) {
        setGeneratingPost(false);
        const message = "로그인 정보가 만료되었습니다. 다시 로그인해주세요.";
        setPostError(message);
        showValidationToast(message);
        return;
      }
    }

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "post_image",
          usageMode: isFreeTrialGeneration ? "free_trial" : "premium",
          accessToken: accessToken || null,
          images: uploadedImages,
          userPrompt: postPrompt,
          instagramHandle: contextInstagramHandle.trim(),
          industry: contextIndustry,
          productService: contextProductService,
          accountDirection: contextAccountDirection,
          accountBio: contextAccountBio,
          accountConcept: contextAccountConcept,
          requestId: crypto.randomUUID(),
          previousPost: latestPostContext
            ? {
                title: latestPostContext.title,
                content: latestPostContext.content,
                hashtags: latestPostContext.hashtags,
              }
            : null,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error ?? "게시물 생성에 실패했습니다.");
      }

      if (data.source !== "api") {
        throw new Error("실제 OpenRouter API 응답이 아닙니다.");
      }

      const nextPost = {
        id: crypto.randomUUID(),
        title: data.title,
        content: data.content,
        hashtags: data.hashtags,
        imagePreview: data.generatedImageUrl,
        imageModelText: data.imageModelText,
        createdAt: new Date().toISOString(),
        isPersisted: false,
        isFreeTrial: isFreeTrialGeneration,
      };

      if (!isFreeTrialGeneration) {
        if (isTestAccountAuthenticated) {
          const today = getKoreaDateString();

          setPostGeneratorSubscription((current) => {
            const baseSubscription =
              current ?? buildTestAccountSubscription(TEST_ACCOUNT_DEFAULT_REMAINING_POSTS);
            const dailyUsageCount =
              baseSubscription.lastUsageDate === today
                ? baseSubscription.dailyUsageCount
                : 0;

            return {
              ...baseSubscription,
              remainingCredits: Math.max(baseSubscription.remainingCredits - 1, 0),
              dailyUsageCount: dailyUsageCount + 1,
              lastUsageDate: today,
            };
          });
        } else if (userId) {
          const subscriptionResult = await fetchPostGeneratorSubscription({
            userId,
          });

          if (!subscriptionResult.error) {
            setPostGeneratorSubscription(subscriptionResult.subscription);
          }
        }
      }

      if (!isTestAccountAuthenticated) {
        const persistenceResult = await persistGeneratedPost({
          userId: userId || null,
          email: authEmail || postSubEmail || null,
          applicationId: contextApplicationId || null,
          title: nextPost.title,
          content: nextPost.content,
          hashtags: nextPost.hashtags,
          imageUrl: nextPost.imagePreview,
          isFreeTrial: isFreeTrialGeneration,
        });

        if (
          persistenceResult.error &&
          !persistenceResult.saved &&
          !persistenceResult.queued
        ) {
          throw new Error(persistenceResult.error);
        }
      }

      setGeneratedPosts((prev) => [nextPost, ...prev]);

      if (isFreeTrialGeneration) {
        setFreeTrialUsed(true);
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "AI 생성에 실패했습니다. 잠시 후 다시 시도해주세요.";
      setPostError(message);
      showValidationToast(message);
    } finally {
      setGeneratingPost(false);
    }
  }

  async function handleCopy(fieldKey: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(fieldKey);
      window.setTimeout(() => {
        setCopiedField((current) => (current === fieldKey ? null : current));
      }, 1800);
    } catch {
      setPostError("복사에 실패했습니다. 다시 시도해주세요.");
    }
  }

  const wrapper =
    "min-h-screen bg-[#f8f9fb] flex items-start justify-center px-4 py-12";
  const progress = getToolsProgress(step);

  if (step === "postsub-payment") {
    return (
      <>
        <main className={wrapper}>
          <div className="max-w-2xl w-full space-y-6">
            <ToolsHeader
              onBack={navigateBack}
              onHome={() => router.push("/")}
              onMyPage={() => router.push("/mypage")}
              progress={progress}
            />

            <div className="text-center space-y-2">
              <div className="inline-flex items-center gap-2 bg-violet-50 text-violet-600 text-xs font-semibold px-4 py-1.5 rounded-full border border-violet-100">
                구독 결제
              </div>
              <h2 className="text-2xl font-bold text-gray-900">
                게시물 AI 생성 구독 신청
              </h2>
              <p className="text-sm text-gray-500">
                이미지를 업로드하면 AI가 게시물을 자동으로 생성해드립니다.
              </p>
              <p className="text-xs text-gray-500 leading-relaxed">
                1회 무료 체험 후 월 {formattedSubscriptionPrice}원 구독으로 이용할 수
                있습니다. 매월 {POST_GENERATOR_MONTHLY_CREDITS}회, 하루 최대{" "}
                {POST_GENERATOR_DAILY_LIMIT}회까지 게시물 생성이 가능합니다.
              </p>
            </div>

            <Card className="space-y-4 border-violet-100">
              <SectionLabel>요금 안내</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-4">
                  <p className="text-xs font-semibold text-violet-500">월 요금</p>
                  <p className="mt-2 text-lg font-bold text-gray-900">
                    {formattedSubscriptionPrice}원
                  </p>
                </div>
                <div className="rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-4">
                  <p className="text-xs font-semibold text-violet-500">월 제공량</p>
                  <p className="mt-2 text-lg font-bold text-gray-900">
                    {POST_GENERATOR_MONTHLY_CREDITS}회
                  </p>
                </div>
                <div className="rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-4">
                  <p className="text-xs font-semibold text-violet-500">일일 한도</p>
                  <p className="mt-2 text-lg font-bold text-gray-900">
                    {POST_GENERATOR_DAILY_LIMIT}회
                  </p>
                </div>
              </div>
            </Card>

            <Card className="space-y-4 border-violet-100">
              <SectionLabel>결제 방법</SectionLabel>
              <div className="rounded-2xl bg-gradient-to-r from-violet-500 to-purple-500 text-white px-5 py-4">
                <p className="text-xs font-semibold text-white/80">결제 방식</p>
                <p className="mt-2 text-2xl font-extrabold tracking-tight">무통장 입금</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-400">은행</span>
                  <span className="text-sm font-semibold text-gray-900">
                    {POST_SUBSCRIPTION_BANK_TRANSFER_INFO.bankName}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-400">계좌번호</span>
                  <span className="text-sm font-semibold text-gray-900">
                    {POST_SUBSCRIPTION_BANK_TRANSFER_INFO.accountNumber}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-400">예금주</span>
                  <span className="text-sm font-semibold text-gray-900">
                    {POST_SUBSCRIPTION_BANK_TRANSFER_INFO.accountHolder}
                  </span>
                </div>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">
                입금자명은 신청 시 입력한 이름과 동일하게 입력해주세요. 입금 확인 후
                서비스가 시작됩니다.
              </p>
              <button
                onClick={() =>
                  handleCopy(
                    "tools-postsub-account-number",
                    POST_SUBSCRIPTION_BANK_TRANSFER_INFO.accountNumber
                  )
                }
                className={`${getPrimaryActionButtonClass({
                  theme: "violet",
                })} py-3`}
              >
                {copiedField === "tools-postsub-account-number"
                  ? "복사됨"
                  : "계좌번호 복사"}
              </button>
            </Card>

            <Card className="space-y-5">
              <SectionLabel>신청자 정보</SectionLabel>
              <InputField
                label="담당자명"
                value={postSubManagerName}
                onChange={setPostSubManagerName}
                onBlur={() => markFieldTouched("postSubManagerName")}
                placeholder="홍길동"
                required
                error={postSubManagerNameError}
                fieldKey="postSubManagerName"
                theme="violet"
              />
              <InputField
                label="연락처"
                value={postSubPhone}
                onChange={setPostSubPhone}
                onBlur={() => markFieldTouched("postSubPhone")}
                placeholder="010-0000-0000"
                type="tel"
                required
                error={postSubPhoneError}
                fieldKey="postSubPhone"
                theme="violet"
              />
              <InputField
                label="아이디(이메일)"
                value={postSubEmail}
                onChange={setPostSubEmail}
                onBlur={() => markFieldTouched("postSubEmail")}
                placeholder="예: brand@company.com"
                type="email"
                required
                error={postSubEmailError}
                fieldKey="postSubEmail"
                theme="violet"
              />
              <InputField
                label="입금자명"
                value={postSubDepositorName}
                onChange={setPostSubDepositorName}
                onBlur={() => markFieldTouched("postSubDepositorName")}
                placeholder="홍길동"
                required
                error={postSubDepositorNameError}
                fieldKey="postSubDepositorName"
                theme="violet"
              />

              <div className="pt-3 border-t border-gray-100">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={postSubTaxInvoiceRequested}
                      onChange={(e) => setPostSubTaxInvoiceRequested(e.target.checked)}
                      className="sr-only"
                    />
                    <div
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                        postSubTaxInvoiceRequested
                          ? "bg-violet-500 border-violet-500"
                          : "border-gray-300 group-hover:border-gray-400"
                      }`}
                    >
                      {postSubTaxInvoiceRequested && (
                        <span className="text-white text-xs font-bold">✓</span>
                      )}
                    </div>
                  </div>
                  <span className="text-sm font-medium text-gray-700">
                    세금계산서 발행 요청
                  </span>
                </label>
              </div>

              {postSubTaxInvoiceRequested && (
                <div className="space-y-4 pt-3 border-t border-gray-100">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    세금계산서 정보
                  </p>
                  <InputField
                    label="사업자등록번호"
                    value={postSubBusinessNumber}
                    onChange={setPostSubBusinessNumber}
                    onBlur={() => markFieldTouched("postSubBusinessNumber")}
                    placeholder="000-00-00000"
                    error={postSubBusinessNumberError}
                    fieldKey="postSubBusinessNumber"
                    theme="violet"
                  />
                  <InputField
                    label="상호"
                    value={postSubCompanyName}
                    onChange={setPostSubCompanyName}
                    onBlur={() => markFieldTouched("postSubCompanyName")}
                    placeholder="(주)회사명"
                    error={postSubCompanyNameError}
                    fieldKey="postSubCompanyName"
                    theme="violet"
                  />
                  <InputField
                    label="대표자명"
                    value={postSubCeoName}
                    onChange={setPostSubCeoName}
                    onBlur={() => markFieldTouched("postSubCeoName")}
                    placeholder="홍길동"
                    error={postSubCeoNameError}
                    fieldKey="postSubCeoName"
                    theme="violet"
                  />
                  <InputField
                    label="사업장 주소"
                    value={postSubBusinessAddress}
                    onChange={setPostSubBusinessAddress}
                    onBlur={() => markFieldTouched("postSubBusinessAddress")}
                    placeholder="서울시 강남구 ..."
                    error={postSubBusinessAddressError}
                    fieldKey="postSubBusinessAddress"
                    theme="violet"
                  />
                  <InputField
                    label="업태/종목"
                    value={postSubBusinessType}
                    onChange={setPostSubBusinessType}
                    onBlur={() => markFieldTouched("postSubBusinessType")}
                    placeholder="서비스업 / 마케팅"
                    error={postSubBusinessTypeError}
                    fieldKey="postSubBusinessType"
                    theme="violet"
                  />
                  <InputField
                    label="세금계산서 아이디(이메일)"
                    value={postSubInvoiceEmail}
                    onChange={setPostSubInvoiceEmail}
                    onBlur={() => markFieldTouched("postSubInvoiceEmail")}
                    placeholder="예: tax@company.com"
                    type="email"
                    error={postSubInvoiceEmailError}
                    fieldKey="postSubInvoiceEmail"
                    theme="violet"
                  />
                </div>
              )}
            </Card>

            <button
              onClick={handlePostSubscriptionSubmit}
              disabled={submittingPostSubscription}
              aria-disabled={
                submittingPostSubscription || !isPostSubscriptionPaymentReady
              }
              className={`${getPrimaryActionButtonClass({
                theme: "violet",
                isInactive:
                  submittingPostSubscription || !isPostSubscriptionPaymentReady,
              })} py-4`}
            >
              {submittingPostSubscription
                ? "구독 신청 정보를 저장하고 있습니다..."
                : "구독 신청 완료 (입금 진행하기)"}
            </button>
          </div>
        </main>
        <ValidationToast
          message={validationToast}
          onClose={() => setValidationToast(null)}
          theme="violet"
        />
      </>
    );
  }

  if (step === "postsub-status") {
    return (
      <>
        <main className={wrapper}>
          <div className="max-w-2xl w-full space-y-6">
            <ToolsHeader
              onBack={navigateBack}
              onHome={() => router.push("/")}
              onMyPage={() => router.push("/mypage")}
              progress={progress}
            />

            <Card className="text-center space-y-3 py-8">
              <div className="w-16 h-16 bg-gradient-to-br from-violet-400 to-purple-500 rounded-full flex items-center justify-center mx-auto shadow-lg">
                <span className="text-white text-2xl">✓</span>
              </div>
              <h2 className="text-2xl font-bold text-gray-900">
                구독 신청이 접수되었습니다
              </h2>
              <p className="text-sm text-gray-500">
                입금 확인 후 구독이 활성화됩니다
              </p>
            </Card>

            <Card className="space-y-4 border-violet-100">
              <SectionLabel>구독 상태 안내</SectionLabel>
              <div className="rounded-2xl border border-violet-100 bg-violet-50/60 px-5 py-5 space-y-3">
                <p className="text-sm font-semibold text-violet-700">
                  구독 시작 예정 안내
                </p>
                <p className="text-sm text-violet-600 leading-relaxed">
                  입금 확인이 완료되면 게시물 AI 생성 기능이 즉시 활성화됩니다.
                </p>
                <p className="text-sm text-violet-600 leading-relaxed">
                  활성화 후 매월 {POST_GENERATOR_MONTHLY_CREDITS}회, 하루 최대{" "}
                  {POST_GENERATOR_DAILY_LIMIT}회까지 이용할 수 있습니다.
                </p>
                {postSubRequestedAt && (
                  <p className="text-xs text-violet-500">
                    신청 시각: {formatDateKorean(postSubRequestedAt)}
                  </p>
                )}
              </div>
            </Card>

            <Card className="space-y-3">
              <SectionLabel>입금 정보</SectionLabel>
              <div className="text-sm space-y-1 text-gray-700">
                <p>
                  <span className="text-gray-400">은행:</span>{" "}
                  {POST_SUBSCRIPTION_BANK_TRANSFER_INFO.bankName}
                </p>
                <p>
                  <span className="text-gray-400">계좌번호:</span>{" "}
                  {POST_SUBSCRIPTION_BANK_TRANSFER_INFO.accountNumber}
                </p>
                <p>
                  <span className="text-gray-400">예금주:</span>{" "}
                  {POST_SUBSCRIPTION_BANK_TRANSFER_INFO.accountHolder}
                </p>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">
                입금자명은 신청 시 입력한 이름과 동일하게 입력해주세요. 입금 확인 후
                서비스가 시작됩니다.
              </p>
            </Card>

            <div className="space-y-3">
              <button
                onClick={handleActivatePostSubscription}
                disabled={startingSubscription}
                className={`${getPrimaryActionButtonClass({
                  theme: "violet",
                  isInactive: startingSubscription,
                })} py-4`}
              >
                {startingSubscription
                  ? "입금 확인을 반영하고 있습니다..."
                  : "입금 확인 완료 처리하고 구독 시작하기"}
              </button>
              <button
                onClick={() => setStep("postgen")}
                className="w-full py-4 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                게시물 AI 생성 화면으로 돌아가기
              </button>
            </div>
          </div>
        </main>
        <ValidationToast
          message={validationToast}
          onClose={() => setValidationToast(null)}
          theme="violet"
        />
      </>
    );
  }

  return (
    <>
      <main className={wrapper}>
        <div className="max-w-2xl w-full space-y-6">
          <ToolsHeader
            onBack={navigateBack}
            onHome={() => router.push("/")}
            onMyPage={() => router.push("/mypage")}
            progress={progress}
          />

          <div className="flex items-center justify-end gap-2">
            {hasHydrated ? (
              isAuthenticated ? (
                <>
                  {isTestAccountAuthenticated && (
                    <span className="text-[10px] font-semibold bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full">
                      체험 계정
                    </span>
                  )}
                  <span className="text-xs font-medium text-gray-500 bg-white border border-gray-200 px-3 py-1.5 rounded-full">
                    {authName
                      ? `${authName}님 로그인됨`
                      : authEmail
                        ? `${authEmail} 로그인됨`
                        : "로그인됨"}
                  </span>
                  <button
                    onClick={handleLogout}
                    className="text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
                  >
                    로그아웃
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => openAuthPage("login")}
                    className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    로그인
                  </button>
                  <button
                    onClick={() => openAuthPage("signup")}
                    className="text-sm font-medium text-violet-600 hover:text-violet-700 transition-colors"
                  >
                    회원가입
                  </button>
                </>
              )
            ) : (
              <div className="h-6 w-32" aria-hidden="true" />
            )}
          </div>

          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-2 bg-violet-50 text-violet-600 text-xs font-semibold px-4 py-1.5 rounded-full border border-violet-100">
              AI 콘텐츠 생성
            </div>
            <h2 className="text-2xl font-bold text-gray-900">게시물 AI 생성</h2>
            <p className="text-sm text-gray-500">
              이미지를 업로드하면 AI가 게시물을 완성해드립니다
            </p>
          </div>

          <div className="space-y-4">
            <Card className="bg-violet-50/60 border-violet-100 space-y-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-violet-700">
                  게시물 AI 생성은 구독형으로 운영됩니다
                </p>
                <p className="text-xs text-violet-600 leading-relaxed">
                  1회 무료 체험 후 월 {formattedSubscriptionPrice}원 구독으로 매월{" "}
                  {POST_GENERATOR_MONTHLY_CREDITS}회, 하루 최대{" "}
                  {POST_GENERATOR_DAILY_LIMIT}회까지 바로 생성할 수 있습니다.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-2xl border border-violet-100 bg-white/80 px-4 py-4">
                  <p className="text-xs font-semibold text-violet-500">구독 상태</p>
                  <p className="mt-2 text-lg font-bold text-gray-900">
                    {loadingSubscription
                      ? "확인 중"
                      : hasActivePostGeneratorSubscription
                        ? "월 구독 이용중"
                        : "무료 체험 또는 미구독"}
                  </p>
                </div>
                <div className="rounded-2xl border border-violet-100 bg-white/80 px-4 py-4">
                  <p className="text-xs font-semibold text-violet-500">
                    남은 생성 횟수
                  </p>
                  <p className="mt-2 text-lg font-bold text-gray-900">
                    {hasActivePostGeneratorSubscription
                      ? `${remainingSubscriptionCredits}회`
                      : hasConsumedFreeTrial
                        ? "구독 필요"
                        : "무료 1회 가능"}
                  </p>
                </div>
                <div className="rounded-2xl border border-violet-100 bg-white/80 px-4 py-4">
                  <p className="text-xs font-semibold text-violet-500">오늘 남은 횟수</p>
                  <p className="mt-2 text-lg font-bold text-gray-900">
                    {hasActivePostGeneratorSubscription
                      ? `${remainingDailyGenerations}회`
                      : `하루 최대 ${POST_GENERATOR_DAILY_LIMIT}회`}
                  </p>
                </div>
              </div>
            </Card>

            {shouldShowPostLock ? (
              <Card className="text-center space-y-4 py-10">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                  <span className="text-2xl">🔒</span>
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-gray-700 text-lg">
                    {isDailyLimitReached
                      ? "오늘 생성 가능한 횟수를 모두 사용했습니다"
                      : isSubscriptionCreditEmpty
                        ? "이번 달 남은 생성 횟수가 없습니다"
                        : hasConsumedFreeTrial
                          ? "무료 체험 1회를 모두 사용하셨습니다"
                          : "이용 조건을 확인해주세요"}
                  </p>
                  <p className="text-sm text-gray-500 max-w-sm mx-auto">
                    새 게시물 생성은 잠겨 있지만, 이전에 생성한 게시물은 계속 확인할 수 있습니다
                  </p>
                  <p className="text-sm text-gray-500 max-w-sm mx-auto">
                    {isDailyLimitReached
                      ? "하루 제한이 초기화되면 다시 생성할 수 있습니다"
                      : hasActivePostGeneratorSubscription
                        ? "다음 결제 주기에 다시 충전되거나 이후 추가 크레딧 기능으로 확장될 예정입니다"
                        : "계속 이용하려면 로그인 후 월 구독을 시작해주세요"}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {hasActivePostGeneratorSubscription && !isDailyLimitReached ? (
                    <button
                      disabled
                      className={`${getPrimaryActionButtonClass({
                        theme: "violet",
                        isInactive: true,
                      })} py-3`}
                    >
                      구독 이용중 (재시작 불가)
                    </button>
                  ) : (
                    <button
                      onClick={
                        isAuthenticated
                          ? handleMoveToPostSubscriptionPayment
                          : () => openAuthPage("login")
                      }
                      disabled={startingSubscription || isDailyLimitReached}
                      className={`${getPrimaryActionButtonClass({
                        theme: "violet",
                        isInactive: startingSubscription || isDailyLimitReached,
                      })} py-3`}
                    >
                      {isDailyLimitReached
                        ? "내일 다시 이용하기"
                        : startingSubscription
                          ? "구독을 준비하고 있습니다..."
                          : isAuthenticated
                            ? `월 구독 시작하기 (${formattedSubscriptionPrice}원)`
                            : "회원가입 또는 로그인"}
                    </button>
                  )}
                  <button
                    onClick={() => router.push("/?screen=account-check")}
                    className="w-full py-3 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    AI 마케팅 서비스 신청하기
                  </button>
                </div>
              </Card>
            ) : (
              <Card className="space-y-5">
                <div className="flex items-center justify-between mb-4">
                  <SectionLabel>게시물 제작</SectionLabel>
                  <span className="text-xs font-semibold text-violet-600 bg-violet-50 px-3 py-1 rounded-full">
                    {canUseSubscriptionPostGeneration
                      ? `남은 횟수: ${remainingSubscriptionCredits}개`
                      : hasConsumedFreeTrial
                        ? "무료 체험 완료"
                        : "무료 체험 가능"}
                  </span>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-semibold text-gray-900">
                    참고 이미지 업로드
                  </p>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    제품 사진이나 참고하고 싶은 인스타그램 게시물을 올려주세요.
                  </p>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    AI가 분위기, 색감, 구도, 스타일을 참고해 게시물을 제작합니다.
                    업로드는 선택 사항이며 최대 2장까지 가능합니다.
                  </p>
                </div>

                {uploadedImages.length === 0 ? (
                  <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-2xl py-10 px-4 cursor-pointer hover:border-violet-300 hover:bg-violet-50/30 transition-colors">
                    <div className="text-3xl text-gray-300 mb-2">📷</div>
                    <p className="text-sm font-medium text-gray-500">
                      참고 이미지를 선택하세요
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      제품 사진, 인스타 참고 이미지 모두 가능 · 최대 2장
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </label>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {uploadedImages.map((image, index) => (
                        <div
                          key={`${image.slice(0, 24)}-${index}`}
                          className="relative rounded-2xl overflow-hidden border border-gray-100 bg-gray-50 aspect-square"
                        >
                          <Image
                            src={image}
                            alt={`업로드된 참고 이미지 ${index + 1}`}
                            fill
                            unoptimized
                            sizes="(max-width: 768px) 100vw, 50vw"
                            className="object-cover"
                          />
                          <button
                            onClick={() => handleRemoveUploadedImage(index)}
                            className="absolute top-2 right-2 w-8 h-8 bg-black/50 text-white rounded-full flex items-center justify-center text-sm hover:bg-black/70 transition-colors"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      {uploadedImages.length < 2 && (
                        <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-2xl px-4 cursor-pointer hover:border-violet-300 hover:bg-violet-50/30 transition-colors aspect-square">
                          <div className="text-3xl text-gray-300 mb-2">＋</div>
                          <p className="text-sm font-medium text-gray-500">
                            참고 이미지 추가
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            한 장 더 올릴 수 있습니다
                          </p>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={handleImageUpload}
                            className="hidden"
                          />
                        </label>
                      )}
                    </div>
                    <p className="text-xs text-violet-600 font-medium">
                      제품 사진, 참고 게시물, 분위기 이미지를 함께 참고해 제작합니다
                    </p>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-gray-900">
                      이런 게시물은 어떠세요?
                    </p>
                    <p className="text-xs text-gray-500">
                      입력하신 정보를 바탕으로 첫 게시물 아이디어를 추천해드립니다
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {suggestedPostPrompts.map((suggestion, index) => {
                      const isSelected = postPrompt.trim() === suggestion;

                      return (
                        <button
                          key={`${suggestion}-${index}`}
                          type="button"
                          onClick={() => setPostPrompt(suggestion)}
                          className={`text-left rounded-xl border px-4 py-3 transition-all ${
                            isSelected
                              ? "border-violet-400 bg-violet-50 shadow-sm"
                              : "border-gray-200 bg-white hover:border-violet-200 hover:bg-violet-50/40"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p
                              className={`text-sm leading-relaxed ${
                                isSelected ? "text-violet-700 font-medium" : "text-gray-700"
                              }`}
                            >
                              {suggestion}
                            </p>
                            <span
                              className={`text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${
                                isSelected
                                  ? "bg-violet-100 text-violet-600"
                                  : "bg-gray-100 text-gray-500"
                              }`}
                            >
                              {isSelected ? "선택됨" : "빠른 시작"}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <TextareaField
                  label="원하는 게시물 방향"
                  value={postPrompt}
                  onChange={setPostPrompt}
                  placeholder="예: 참고 이미지는 그대로 두고 더 감성적인 분위기로 만들어주세요. 20대 여성 대상의 따뜻한 홍보 게시물 느낌이면 좋겠어요."
                  rows={5}
                  error={postInputError}
                  fieldKey="postInput"
                />

                <div className="rounded-xl bg-violet-50/60 border border-violet-100 px-4 py-3 space-y-1">
                  <p className="text-sm font-medium text-violet-700">
                    어떤 내용을 적으면 좋을까요?
                  </p>
                  <p className="text-xs text-violet-600 leading-relaxed">
                    원하는 분위기, 타깃 고객, 홍보 목적, 강조하고 싶은 문구를
                    자유롭게 적어주세요. AI가 정사각형 피드 이미지와 제목, 내용,
                    해시태그까지 한 번에 완성해드립니다.
                  </p>
                </div>

                <button
                  onClick={handleGeneratePost}
                  disabled={generatingPost}
                  aria-disabled={generatingPost || !isPostGenerationReady}
                  className={`${getPrimaryActionButtonClass({
                    theme: "violet",
                    isInactive: generatingPost || !isPostGenerationReady,
                  })} py-3`}
                >
                  {generatingPost ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      게시물을 만들고 있습니다...
                    </span>
                  ) : canUseSubscriptionPostGeneration ? (
                    "게시물 생성하기"
                  ) : canUseFreeTrial ? (
                    "무료로 게시물 체험하기"
                  ) : (
                    "이용 조건을 확인해주세요"
                  )}
                </button>
              </Card>
            )}

            {postError && (
              <Card className="bg-red-50 border-red-100 text-center space-y-2">
                <p className="text-sm font-medium text-red-600">{postError}</p>
                <button
                  onClick={() => setPostError(null)}
                  className="text-xs text-red-500 underline hover:text-red-700"
                >
                  확인
                </button>
              </Card>
            )}

            {loadingSavedPosts && (
              <Card className="text-center py-4">
                <p className="text-sm text-gray-500">
                  저장된 게시물을 불러오는 중입니다
                </p>
              </Card>
            )}

            {mergedGeneratedPosts.length > 0 && (
              <Card className="space-y-2">
                <div className="space-y-1">
                  <SectionLabel>생성된 게시물 히스토리</SectionLabel>
                  <p className="text-sm text-gray-500">
                    이전에 생성한 게시물을 다시 확인하고 복사하거나 다운로드할 수 있습니다
                  </p>
                </div>
              </Card>
            )}

            {!loadingSavedPosts && mergedGeneratedPosts.length === 0 && isAuthenticated && (
              <Card className="text-center py-6">
                <p className="text-sm text-gray-500">
                  아직 저장된 게시물이 없습니다
                </p>
              </Card>
            )}

            {mergedGeneratedPosts.map((post, i) => {
              const postKey = post.id?.trim() || buildGeneratedPostSignature(post);

              return (
                <Card key={postKey} className="space-y-3">
                  <SectionLabel>
                    생성된 게시물 #{mergedGeneratedPosts.length - i}
                  </SectionLabel>
                  <div className="grid grid-cols-1 md:grid-cols-[260px,1fr] gap-4 items-start">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">
                            정사각형 피드 이미지
                          </p>
                          <p className="text-xs text-gray-500">
                            깔끔한 피드용 이미지 미리보기
                          </p>
                        </div>
                        <a
                          href={post.imagePreview}
                          download={`인스타그램-게시물-${mergedGeneratedPosts.length - i}.png`}
                          className="inline-flex items-center justify-center px-3 py-2 text-xs font-semibold rounded-lg bg-violet-50 text-violet-600 hover:bg-violet-100 transition-colors"
                        >
                          이미지 다운로드
                        </a>
                      </div>
                      <div className="relative max-w-[260px] w-full rounded-xl overflow-hidden border border-gray-100 aspect-square bg-gray-50 mx-auto md:mx-0 shadow-sm">
                        <Image
                          src={post.imagePreview}
                          alt="게시물 이미지"
                          fill
                          unoptimized
                          sizes="260px"
                          className="object-cover"
                        />
                      </div>
                    </div>
                    <div className="p-3 bg-gray-50 rounded-xl space-y-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-gray-400">제목</span>
                          <button
                            onClick={() => handleCopy(`title-${postKey}`, post.title)}
                            className="text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors"
                          >
                            {copiedField === `title-${postKey}` ? "복사됨" : "제목 복사"}
                          </button>
                        </div>
                        <p className="text-sm font-medium text-gray-800">{post.title}</p>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-gray-400">내용</span>
                          <button
                            onClick={() => handleCopy(`content-${postKey}`, post.content)}
                            className="text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors"
                          >
                            {copiedField === `content-${postKey}`
                              ? "복사됨"
                              : "내용 복사"}
                          </button>
                        </div>
                        <p className="text-sm text-gray-700 leading-relaxed">
                          {post.content}
                        </p>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-gray-400">해시태그</span>
                          <button
                            onClick={() => handleCopy(`hashtags-${postKey}`, post.hashtags)}
                            className="text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors"
                          >
                            {copiedField === `hashtags-${postKey}`
                              ? "복사됨"
                              : "해시태그 복사"}
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {post.hashtags.split(" ").map((tag, j) => (
                            <span
                              key={j}
                              className="text-xs bg-violet-50 text-violet-500 px-2 py-0.5 rounded-full font-medium"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}

            {mergedGeneratedPosts.length > 0 && !canUseSubscriptionPostGeneration && (
              <Card className="space-y-4 border-violet-100 bg-violet-50/50">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-violet-700">
                    {hasActivePostGeneratorSubscription
                      ? "오늘 생성 가능한 횟수를 모두 사용했습니다"
                      : "무료 체험이 완료되었습니다"}
                  </p>
                  <p className="text-sm text-violet-600">
                    {hasActivePostGeneratorSubscription
                      ? "내일 다시 이용하거나 다음 결제 주기에 맞춰 계속 사용해보세요"
                      : `월 ${formattedSubscriptionPrice}원 구독으로 매월 ${POST_GENERATOR_MONTHLY_CREDITS}회 생성할 수 있습니다`}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={
                      isAuthenticated
                        ? handleMoveToPostSubscriptionPayment
                        : () => openAuthPage("login")
                    }
                    disabled={startingSubscription || isDailyLimitReached}
                    className={`${getPrimaryActionButtonClass({
                      theme: "violet",
                      isInactive: startingSubscription || isDailyLimitReached,
                    })} py-3`}
                  >
                    {isDailyLimitReached
                      ? "오늘은 모두 사용했습니다"
                      : startingSubscription
                        ? "구독을 준비하고 있습니다..."
                        : isAuthenticated
                          ? `월 구독 시작하기 (${formattedSubscriptionPrice}원)`
                          : "회원가입 또는 로그인"}
                  </button>
                  <button
                    onClick={() => router.push("/?screen=account-check")}
                    className="w-full py-3 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    AI 마케팅 서비스 신청하기
                  </button>
                </div>
              </Card>
            )}
          </div>
        </div>
      </main>
      <ValidationToast
        message={validationToast}
        onClose={() => setValidationToast(null)}
        theme="violet"
      />
    </>
  );
}
