"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collectValidationIssues,
  getFieldError,
  getApplicationValidationIssues,
  getFirstValidationIssue,
  getIssueFields,
  isValidDurationSelection,
  isBlank,
  isValidPlanSelection,
  type ApplicationValidationField,
  type ValidationIssue,
} from "@/lib/form-validation";
import {
  getSupabaseBrowserClientOrNull,
} from "@/lib/supabase/client";
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
  TEST_ACCOUNT_DEFAULT_DURATION,
  TEST_ACCOUNT_DEFAULT_PLAN,
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
  persistApplicationSubmission,
  persistGeneratedPost,
  startPostGeneratorSubscription,
  type SavedSubscription,
  type SavedGeneratedPost,
  syncProfileAndLinkData,
} from "@/lib/supabase/persistence";

/* ─── Types ─── */

type Step =
  | "landing"
  | "account-check"
  | "input"
  | "result"
  | "names"
  | "confirm"
  | "payment"
  | "status"
  | "postgen"
  | "postsub-payment"
  | "postsub-status";

type ApplicationLifecycleStatus =
  | "idle"
  | "submitted"
  | "payment_pending"
  | "in_progress"
  | "completed";

type PaymentLifecycleStatus = "pending" | "confirmed";

type AccountName = {
  name: string;
  meaning: string;
};

type AiResult = {
  accountNames: AccountName[];
  accountPlan: {
    direction: string;
    bio: string;
    concept: string;
  };
};

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

type HomeValidationField =
  | ApplicationValidationField
  | "finalInstagramId"
  | "postInput"
  | "planningResult"
  | "accountNames"
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

type OutcomeMetricKey = "followers" | "likes" | "comments";

type ExpectedOutcome = Record<OutcomeMetricKey, number>;

const EXPECTED_OUTCOME_DATA: Record<1 | 2, Record<1 | 2, ExpectedOutcome>> = {
  1: {
    1: { followers: 500, likes: 100, comments: 30 },
    2: { followers: 1000, likes: 200, comments: 60 },
  },
  2: {
    1: { followers: 1000, likes: 200, comments: 60 },
    2: { followers: 2000, likes: 400, comments: 120 },
  },
};

const OUTCOME_META: Array<{
  key: OutcomeMetricKey;
  label: string;
  shortLabel: string;
  description: string;
  max: number;
  barClassName: string;
}> = [
  {
    key: "followers",
    label: "예상 팔로우",
    shortLabel: "팔로우",
    description: "신규 관심 고객이 유입되는 기준",
    max: 2000,
    barClassName: "from-rose-500 to-pink-500",
  },
  {
    key: "likes",
    label: "예상 좋아요",
    shortLabel: "좋아요",
    description: "콘텐츠 반응이 쌓이기 시작하는 흐름",
    max: 400,
    barClassName: "from-rose-400 to-pink-400",
  },
  {
    key: "comments",
    label: "예상 댓글",
    shortLabel: "댓글",
    description: "대화형 반응이 붙는 운영 기준",
    max: 120,
    barClassName: "from-rose-300 to-pink-300",
  },
];

/* ─── Helpers ─── */

function getPrice(plan: number, duration: number): number {
  if (plan === 1 && duration === 1) return 300000;
  if (plan === 1 && duration === 2) return 500000;
  if (plan === 2 && duration === 1) return 500000;
  if (plan === 2 && duration === 2) return 800000;
  return 300000;
}

function getExpressFee(isExpress: boolean): number {
  return isExpress ? 10000 : 0;
}

function getPostLimit(duration: number): number {
  return duration === 1 ? 4 : 8;
}

function getDefaultCompletionDate(duration: number): string {
  const date = new Date();
  date.setMonth(date.getMonth() + duration);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDateKorean(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${y}년 ${parseInt(m)}월 ${parseInt(d)}일`;
}

function getExpectedOutcome(plan: number, duration: number): ExpectedOutcome {
  const safePlan: 1 | 2 = plan === 2 ? 2 : 1;
  const safeDuration: 1 | 2 = duration === 2 ? 2 : 1;
  return EXPECTED_OUTCOME_DATA[safePlan][safeDuration];
}

function getExpectedOutcomeDiff(
  current: ExpectedOutcome,
  next: ExpectedOutcome
): ExpectedOutcome {
  return {
    followers: next.followers - current.followers,
    likes: next.likes - current.likes,
    comments: next.comments - current.comments,
  };
}

function formatOutcomeValue(metric: OutcomeMetricKey, value: number): string {
  if (metric === "followers") {
    return `${value.toLocaleString()}명`;
  }

  return `${value.toLocaleString()}개 이상`;
}

function formatOutcomeDiff(metric: OutcomeMetricKey, value: number): string {
  if (metric === "followers") {
    return `+${value.toLocaleString()}명`;
  }

  return `+${value.toLocaleString()}개 이상`;
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

const BANK_TRANSFER_INFO = {
  bankName: "하나은행",
  accountNumber: "588-910292-72307",
  accountHolder: "큐밋(Qmeet)",
};

const POST_SUBSCRIPTION_BANK_TRANSFER_INFO = {
  bankName: "하나은행",
  accountNumber: "588-910292-72307",
  accountHolder: "큐밋(Qmeet)",
};

const APP_STORAGE_KEY = "qmeet-app-state";
const AUTH_STORAGE_KEY = "qmeet-auth-state";

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

function getServiceFlowProgress(
  step: Step,
  hasAccount: boolean | null
): { current: number; total: number } | null {
  if (step === "landing" || step === "postgen") {
    return null;
  }

  if (step === "postsub-payment") {
    return { current: 1, total: 2 };
  }

  if (step === "postsub-status") {
    return { current: 2, total: 2 };
  }

  const total = 5;

  if (step === "account-check") {
    return { current: 1, total };
  }

  if (step === "input") {
    return { current: 2, total };
  }

  if (step === "result") {
    return { current: 3, total };
  }

  if (step === "names" || step === "confirm") {
    return { current: hasAccount ? 3 : 4, total };
  }

  if (step === "payment" || step === "status") {
    return { current: 5, total };
  }

  return null;
}

function getApplicationStageIndexFromState(input: {
  applicationStatus: ApplicationLifecycleStatus;
  paymentStatus: PaymentLifecycleStatus;
}) {
  if (input.applicationStatus === "completed") {
    return 3;
  }

  if (input.applicationStatus === "in_progress") {
    return 2;
  }

  if (input.paymentStatus === "confirmed") {
    return 2;
  }

  if (
    input.applicationStatus === "payment_pending" ||
    input.applicationStatus === "submitted"
  ) {
    return 1;
  }

  return 0;
}

/* ─── Reusable Components ─── */

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
  theme = "rose",
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
  onBlur,
  placeholder,
  required = false,
  rows = 4,
  error,
  fieldKey,
  theme = "rose",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  required?: boolean;
  rows?: number;
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
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
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

function StepUtilityHeader({
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
              <span>진행 단계</span>
              <span>
                {progress.current}/{progress.total}
              </span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-rose-500 to-pink-500 transition-all duration-300"
                style={{
                  width: `${Math.max(
                    (progress.current / progress.total) * 100,
                    10
                  )}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Main ─── */

export default function Home() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("landing");
  const [hasAccount, setHasAccount] = useState<boolean | null>(null);

  // Input
  const [instagramId, setInstagramId] = useState("");
  const [industry, setIndustry] = useState("");
  const [productService, setProductService] = useState("");

  // AI
  const [loading, setLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AiResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSource, setAiSource] = useState<"api" | null>(null);
  const [postError, setPostError] = useState<string | null>(null);

  // Confirm (for no-account flow)
  const [finalInstagramId, setFinalInstagramId] = useState("");

  // Plan
  const [selectedPlan, setSelectedPlan] = useState(1);
  const [selectedDuration, setSelectedDuration] = useState(1);
  const [completionDate, setCompletionDate] = useState("");
  const [isExpress, setIsExpress] = useState(false);

  // Payment form
  const [managerName, setManagerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [depositorName, setDepositorName] = useState("");

  const [taxInvoiceRequested, setTaxInvoiceRequested] = useState(false);
  const [businessNumber, setBusinessNumber] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [ceoName, setCeoName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [invoiceEmail, setInvoiceEmail] = useState("");

  // 게시물 AI 생성 구독 결제(별도 플로우)
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

  // 신청 / 결제 상태
  const [isPaid, setIsPaid] = useState(false);
  const [applicationStatus, setApplicationStatus] =
    useState<ApplicationLifecycleStatus>("idle");
  const [paymentStatus, setPaymentStatus] =
    useState<PaymentLifecycleStatus>("pending");

  // Post generation (separate feature)
  const [remainingPosts, setRemainingPosts] = useState(0);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [postPrompt, setPostPrompt] = useState("");
  const [generatingPost, setGeneratingPost] = useState(false);
  const [generatedPosts, setGeneratedPosts] = useState<GeneratedPost[]>([]);
  const [savedGeneratedPosts, setSavedGeneratedPosts] = useState<GeneratedPost[]>([]);
  const [loadingSavedPosts, setLoadingSavedPosts] = useState(false);
  const [loadingSubscription, setLoadingSubscription] = useState(false);
  const [startingSubscription, setStartingSubscription] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [freeTrialUsed, setFreeTrialUsed] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authName, setAuthName] = useState("");
  const [userId, setUserId] = useState("");
  const [postGeneratorSubscription, setPostGeneratorSubscription] =
    useState<SavedSubscription | null>(null);
  const [isRequestLinked, setIsRequestLinked] = useState(false);
  const [applicationId, setApplicationId] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submittingApplication, setSubmittingApplication] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [hasTestAccess, setHasTestAccess] = useState(false);
  const [validationToast, setValidationToast] = useState<string | null>(null);
  const [touchedFields, setTouchedFields] = useState<
    Partial<Record<HomeValidationField, boolean>>
  >({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const suggestedPostPrompts = [
    `${industry || "브랜드"}의 첫 인사를 전하면서 ${productService || "서비스"}의 매력을 자연스럽게 소개하는 게시물로 만들어주세요.`,
    `${productService || "서비스"}를 처음 보는 사람이 한눈에 이해하고 관심을 가질 수 있는 홍보 게시물로 만들어주세요.`,
    `${aiResult?.accountPlan.concept || aiResult?.accountPlan.direction || "브랜드 방향"}을 살려 팔로우를 유도할 수 있는 분위기의 게시물로 만들어주세요.`,
  ].map((item) => item.replace(/\s+/g, " ").trim());

  const effectiveInstagramId = hasAccount ? instagramId : finalInstagramId;
  const mergedGeneratedPosts = mergeGeneratedPostHistory(
    generatedPosts,
    savedGeneratedPosts
  );
  const hasConsumedFreeTrial =
    freeTrialUsed || mergedGeneratedPosts.some((post) => post.isFreeTrial);
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
  const isTestAccountAuthenticated =
    hasTestAccess && isTestAccountUser(userId, authEmail);
  const effectivePaymentStatus: PaymentLifecycleStatus = isPaid
    ? "confirmed"
    : paymentStatus;
  const isPaymentConfirmed = effectivePaymentStatus === "confirmed";
  const hasPersistedApplicationRecord =
    !!applicationId.trim() && !!paymentId.trim();

  function showValidationToast(message: string) {
    setValidationToast(message);
  }

  function markFieldsTouched(fields: HomeValidationField[]) {
    if (!fields.length) return;

    setTouchedFields((current) => {
      const next = { ...current };

      for (const field of fields) {
        next[field] = true;
      }

      return next;
    });
  }

  function markFieldTouched(field: HomeValidationField) {
    markFieldsTouched([field]);
  }

  function focusValidationField(field: HomeValidationField) {
    if (typeof document === "undefined") return;

    const target = document.querySelector<HTMLElement>(
      `[data-validation-field="${field}"]`
    );

    target?.focus();
  }

  function surfaceValidationIssues(issues: ValidationIssue<HomeValidationField>[]) {
    const firstIssue = getFirstValidationIssue(issues);

    if (!firstIssue) {
      return true;
    }

    markFieldsTouched(getIssueFields(issues));
    showValidationToast(firstIssue.message);
    focusValidationField(firstIssue.field);
    return false;
  }

  const selectedExpectedOutcome = getExpectedOutcome(
    selectedPlan,
    selectedDuration
  );
  const planOneExpectedOutcome = getExpectedOutcome(1, selectedDuration);
  const planTwoExpectedOutcome = getExpectedOutcome(2, selectedDuration);
  const oneMonthExpectedOutcome = getExpectedOutcome(selectedPlan, 1);
  const twoMonthExpectedOutcome = getExpectedOutcome(selectedPlan, 2);
  const planUpgradeDiff =
    selectedPlan === 1
      ? getExpectedOutcomeDiff(selectedExpectedOutcome, planTwoExpectedOutcome)
      : null;
  const durationUpgradeDiff =
    selectedDuration === 1
      ? getExpectedOutcomeDiff(selectedExpectedOutcome, twoMonthExpectedOutcome)
      : null;
  const expectedOutcomeCards = OUTCOME_META.map((metric) => {
    const value = selectedExpectedOutcome[metric.key];
    const barHeight = Math.max((value / metric.max) * 100, 18);

    return {
      ...metric,
      value,
      formattedValue: formatOutcomeValue(metric.key, value),
      barHeight: `${barHeight}%`,
    };
  });

  function hasPlanningInput() {
    return (
      !!industry.trim() &&
      !!productService.trim() &&
      (hasAccount !== true || !!instagramId.trim())
    );
  }

  function hasPlanningOutput() {
    return Boolean(aiResult?.accountPlan && hasPlanningInput());
  }

  function hasRecommendedNames() {
    return !hasAccount && Boolean(aiResult?.accountNames?.length);
  }

  function hasPaymentPrerequisites() {
    return hasPlanningOutput() && !!effectiveInstagramId.trim();
  }

  function hasSubmittedApplication() {
    return (
      hasPaymentPrerequisites() &&
      hasPersistedApplicationRecord &&
      !!managerName.trim() &&
      !!phone.trim() &&
      !!email.trim() &&
      !!depositorName.trim()
    );
  }

  function getPlanningValidationIssues() {
    return collectValidationIssues<HomeValidationField>([
      {
        field: "instagramId",
        message: "인스타그램 아이디를 입력해주세요",
        isMissing: Boolean(hasAccount) && isBlank(instagramId),
      },
      {
        field: "industry",
        message: "업종을 입력해주세요",
        isMissing: isBlank(industry),
      },
      {
        field: "productService",
        message: "판매하는 상품 또는 서비스를 입력해주세요",
        isMissing: isBlank(productService),
      },
    ]);
  }

  function getResultStepValidationIssues() {
    if (getPlanningValidationIssues().length > 0) {
      return getPlanningValidationIssues();
    }

    if (!hasPlanningOutput()) {
      return [
        {
          field: "planningResult" as const,
          message: "AI 기획 결과를 다시 생성해주세요",
        },
      ];
    }

    return [];
  }

  function getNamesStepValidationIssues() {
    if (hasRecommendedNames()) {
      return [];
    }

    return [
      {
        field: "accountNames" as const,
        message: "추천 계정명을 다시 생성해주세요",
      },
    ];
  }

  function getConfirmValidationIssues(nextInstagramId?: string) {
    const handle = typeof nextInstagramId === "string" ? nextInstagramId : finalInstagramId;

    return collectValidationIssues<HomeValidationField>([
      {
        field: "finalInstagramId",
        message: "인스타그램 아이디를 입력해주세요",
        isMissing: isBlank(handle),
      },
    ]);
  }

  function getPaymentValidationIssues() {
    return getApplicationValidationIssues({
      selectedPlan,
      selectedDuration,
      instagramId: effectiveInstagramId,
      industry,
      productService,
      managerName,
      phone,
      email,
      depositorName,
      isExpress,
      completionDate,
    });
  }

  function getPostGenerationValidationIssues() {
    return collectValidationIssues<HomeValidationField>([
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
    return collectValidationIssues<HomeValidationField>([
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
        isMissing:
          postSubTaxInvoiceRequested && isBlank(postSubBusinessNumber),
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
        isMissing:
          postSubTaxInvoiceRequested && isBlank(postSubBusinessAddress),
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

  const planningValidationIssues = getPlanningValidationIssues();
  const resultValidationIssues = getResultStepValidationIssues();
  const namesValidationIssues = getNamesStepValidationIssues();
  const confirmValidationIssues = getConfirmValidationIssues();
  const paymentValidationIssues = getPaymentValidationIssues();
  const postGenerationValidationIssues = getPostGenerationValidationIssues();
  const postSubscriptionPaymentValidationIssues =
    getPostSubscriptionPaymentValidationIssues();

  const instagramIdError = getFieldError(
    planningValidationIssues,
    "instagramId",
    touchedFields
  );
  const industryError = getFieldError(
    planningValidationIssues,
    "industry",
    touchedFields
  );
  const productServiceError = getFieldError(
    planningValidationIssues,
    "productService",
    touchedFields
  );
  const finalInstagramIdError = getFieldError(
    confirmValidationIssues,
    "finalInstagramId",
    touchedFields
  );
  const selectedPlanError = getFieldError(
    paymentValidationIssues,
    "selectedPlan",
    touchedFields
  );
  const selectedDurationError = getFieldError(
    paymentValidationIssues,
    "selectedDuration",
    touchedFields
  );
  const managerNameError = getFieldError(
    paymentValidationIssues,
    "managerName",
    touchedFields
  );
  const phoneError = getFieldError(
    paymentValidationIssues,
    "phone",
    touchedFields
  );
  const emailError = getFieldError(
    paymentValidationIssues,
    "email",
    touchedFields
  );
  const depositorNameError = getFieldError(
    paymentValidationIssues,
    "depositorName",
    touchedFields
  );
  const completionDateError = getFieldError(
    paymentValidationIssues,
    "completionDate",
    touchedFields
  );
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

  const isPlanningReady = planningValidationIssues.length === 0;
  const isResultNextReady = resultValidationIssues.length === 0;
  const isNamesNextReady = namesValidationIssues.length === 0;
  const isConfirmReady = confirmValidationIssues.length === 0;
  const isPaymentSubmitReady = paymentValidationIssues.length === 0;
  const isPostGenerationReady = postGenerationValidationIssues.length === 0;
  const isPostSubscriptionPaymentReady =
    postSubscriptionPaymentValidationIssues.length === 0;

  function getSafeStep(nextStep: Step): Step {
    switch (nextStep) {
      case "landing":
      case "postgen":
        return nextStep;
      case "postsub-payment":
        if (!isAuthenticated) return "postgen";
        if (hasActivePostGeneratorSubscription) return "postgen";
        return "postsub-payment";
      case "postsub-status":
        if (!isAuthenticated) return "postgen";
        if (!postSubSubmitted) return "postsub-payment";
        return "postsub-status";
      case "account-check":
        return "account-check";
      case "input":
        return hasAccount === null ? "account-check" : "input";
      case "result":
        return hasAccount === null
          ? "account-check"
          : hasPlanningInput() || loading || aiError
            ? "result"
            : "input";
      case "names":
        return hasRecommendedNames()
          ? "names"
          : hasPlanningOutput()
            ? "result"
            : hasAccount === null
              ? "account-check"
              : "input";
      case "confirm":
        return hasRecommendedNames()
          ? "confirm"
          : hasPlanningOutput()
            ? "result"
            : hasAccount === null
              ? "account-check"
              : "input";
      case "payment":
        if (hasPaymentPrerequisites()) return "payment";
        if (hasRecommendedNames() && !hasAccount) return "confirm";
        if (hasPlanningOutput()) return "result";
        return hasAccount === null ? "account-check" : "input";
      case "status":
        if (hasSubmittedApplication()) return "status";
        if (hasPaymentPrerequisites()) return "payment";
        if (hasRecommendedNames() && !hasAccount) return "confirm";
        if (hasPlanningOutput()) return "result";
        return hasAccount === null ? "account-check" : "input";
      default:
        return "landing";
    }
  }

  function goToStep(nextStep: Step) {
    setStep(getSafeStep(nextStep));
  }

  function getPreviousStep(currentStep: Step): Step {
    switch (currentStep) {
      case "account-check":
        return "landing";
      case "input":
        return "account-check";
      case "result":
        return "input";
      case "names":
        return "result";
      case "confirm":
        return "names";
      case "payment":
        return hasAccount ? "result" : "confirm";
      case "status":
        return hasPaymentPrerequisites() ? "payment" : "landing";
      case "postgen":
        return "landing";
      case "postsub-payment":
        return "postgen";
      case "postsub-status":
        return "postsub-payment";
      default:
        return "landing";
    }
  }

  function navigateBack(currentStep: Step) {
    goToStep(getPreviousStep(currentStep));
  }

  function openAuthPage(
    target: "landing" | "status" | "postgen",
    tab?: "login" | "signup"
  ) {
    const params = new URLSearchParams({ redirect: target });
    if (tab) params.set("tab", tab);
    router.push(`/auth?${params.toString()}`);
  }

  function moveToPayment(nextInstagramId?: string) {
    const issues = [
      ...getResultStepValidationIssues(),
      ...(hasAccount ? [] : getConfirmValidationIssues(nextInstagramId)),
    ];

    if (!surfaceValidationIssues(issues)) {
      return;
    }

    if (typeof nextInstagramId === "string") {
      setFinalInstagramId(nextInstagramId);
    }

    if (isExpress && !completionDate) {
      setCompletionDate(getDefaultCompletionDate(selectedDuration));
    }

    goToStep("payment");
  }

  function handleResultNext() {
    if (!surfaceValidationIssues(resultValidationIssues)) {
      return;
    }

    if (hasAccount) {
      moveToPayment(instagramId);
      return;
    }

    goToStep("names");
  }

  function handleNamesNext() {
    if (!surfaceValidationIssues(namesValidationIssues)) {
      return;
    }

    goToStep("confirm");
  }

  const activeStep = hasHydrated ? getSafeStep(step) : step;
  const serviceFlowProgress = getServiceFlowProgress(activeStep, hasAccount);

  /* ─── Handlers ─── */

  useEffect(() => {
    if (typeof window === "undefined") return;

    const savedAppState = window.localStorage.getItem(APP_STORAGE_KEY);
    const savedAuthState = window.localStorage.getItem(AUTH_STORAGE_KEY);

    if (savedAppState) {
      try {
        const parsed = JSON.parse(savedAppState) as {
          hasAccount?: boolean | null;
          instagramId?: string;
          industry?: string;
          productService?: string;
          aiResult?: AiResult | null;
          step?: Step;
          finalInstagramId?: string;
          selectedPlan?: number;
          selectedDuration?: number;
          completionDate?: string;
          isExpress?: boolean;
          managerName?: string;
          phone?: string;
          email?: string;
          depositorName?: string;
          taxInvoiceRequested?: boolean;
          businessNumber?: string;
          companyName?: string;
          ceoName?: string;
          businessAddress?: string;
          businessType?: string;
          invoiceEmail?: string;
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
          isPaid?: boolean;
          applicationStatus?: ApplicationLifecycleStatus;
          paymentStatus?: PaymentLifecycleStatus;
          remainingPosts?: number;
          freeTrialUsed?: boolean;
          applicationId?: string;
          paymentId?: string;
          generatedPosts?: GeneratedPost[];
        };

        if ("hasAccount" in parsed) setHasAccount(parsed.hasAccount ?? null);
        if (
          parsed.step === "postgen" ||
          parsed.step === "postsub-payment" ||
          parsed.step === "postsub-status"
        ) {
          setStep("landing");
        } else if (parsed.step) {
          setStep(parsed.step);
        }
        setInstagramId(parsed.instagramId ?? "");
        setIndustry(parsed.industry ?? "");
        setProductService(parsed.productService ?? "");
        setAiResult(parsed.aiResult ?? null);
        setFinalInstagramId(parsed.finalInstagramId ?? "");
        if (isValidPlanSelection(parsed.selectedPlan)) {
          setSelectedPlan(parsed.selectedPlan);
        }
        if (isValidDurationSelection(parsed.selectedDuration)) {
          setSelectedDuration(parsed.selectedDuration);
        }
        setCompletionDate(parsed.completionDate ?? "");
        setIsExpress(Boolean(parsed.isExpress));
        setManagerName(parsed.managerName ?? "");
        setPhone(parsed.phone ?? "");
        setEmail(parsed.email ?? "");
        setDepositorName(parsed.depositorName ?? "");
        setTaxInvoiceRequested(Boolean(parsed.taxInvoiceRequested));
        setBusinessNumber(parsed.businessNumber ?? "");
        setCompanyName(parsed.companyName ?? "");
        setCeoName(parsed.ceoName ?? "");
        setBusinessAddress(parsed.businessAddress ?? "");
        setBusinessType(parsed.businessType ?? "");
        setInvoiceEmail(parsed.invoiceEmail ?? "");
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
        setIsPaid(Boolean(parsed.isPaid));
        if (
          parsed.applicationStatus === "idle" ||
          parsed.applicationStatus === "submitted" ||
          parsed.applicationStatus === "payment_pending" ||
          parsed.applicationStatus === "in_progress" ||
          parsed.applicationStatus === "completed"
        ) {
          setApplicationStatus(parsed.applicationStatus);
        }
        if (
          parsed.paymentStatus === "pending" ||
          parsed.paymentStatus === "confirmed"
        ) {
          setPaymentStatus(parsed.paymentStatus);
        } else if (parsed.isPaid) {
          setPaymentStatus("confirmed");
        }
        if (typeof parsed.remainingPosts === "number") {
          setRemainingPosts(parsed.remainingPosts);
        }
        setFreeTrialUsed(Boolean(parsed.freeTrialUsed));
        setApplicationId(parsed.applicationId ?? "");
        setPaymentId(parsed.paymentId ?? "");
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
        const isStoredTestAccount =
          Boolean(parsed.isAuthenticated) &&
          isTestAccountUser(parsed.userId, parsed.authEmail);
        setIsAuthenticated(Boolean(parsed.isAuthenticated));
        setAuthEmail(parsed.authEmail ?? "");
        setAuthName(parsed.authName ?? "");
        setUserId(parsed.userId ?? "");
        setIsRequestLinked(Boolean(parsed.isRequestLinked));
        setHasTestAccess(isStoredTestAccount);
      } catch {
        window.localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    }

    setHasHydrated(true);
  }, []);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    let isActive = true;

    void fetchTestAccountAccess().then((active) => {
      if (!isActive) {
        return;
      }

      setHasTestAccess(active);
    });

    return () => {
      isActive = false;
    };
  }, [hasHydrated]);

  useEffect(() => {
    if (!hasHydrated || !hasTestAccess) {
      return;
    }

    setIsAuthenticated(true);
    setAuthEmail(TEST_ACCOUNT_AUTH_ID);
    if (!authName.trim()) {
      setAuthName(TEST_ACCOUNT_NAME);
    }
    setUserId(TEST_ACCOUNT_USER_ID);
    setIsRequestLinked(true);
    setIsPaid(true);
    setPaymentStatus("confirmed");
    if (applicationStatus === "idle" || applicationStatus === "submitted") {
      setApplicationStatus("in_progress");
    }

    if (selectedPlan !== TEST_ACCOUNT_DEFAULT_PLAN) {
      setSelectedPlan(TEST_ACCOUNT_DEFAULT_PLAN);
    }

    if (selectedDuration !== TEST_ACCOUNT_DEFAULT_DURATION) {
      setSelectedDuration(TEST_ACCOUNT_DEFAULT_DURATION);
    }

    if (remainingPosts <= 0) {
      setRemainingPosts(TEST_ACCOUNT_DEFAULT_REMAINING_POSTS);
    }

    if (
      !postGeneratorSubscription ||
      !isPostGeneratorSubscriptionActive(postGeneratorSubscription)
    ) {
      setPostGeneratorSubscription(
        buildTestAccountSubscription(
          remainingPosts > 0 ? remainingPosts : TEST_ACCOUNT_DEFAULT_REMAINING_POSTS
        )
      );
    }
  }, [
    hasHydrated,
    hasTestAccess,
    authName,
    applicationStatus,
    selectedPlan,
    selectedDuration,
    remainingPosts,
    postGeneratorSubscription,
  ]);

  useEffect(() => {
    if (!hasHydrated) {
      return;
    }

    if (hasPersistedApplicationRecord && applicationStatus === "idle") {
      setApplicationStatus("payment_pending");
    }
  }, [hasHydrated, hasPersistedApplicationRecord, applicationStatus]);

  useEffect(() => {
    if (!hasHydrated || typeof window === "undefined") return;

    const appStatePayload = {
        step,
        hasAccount,
        instagramId,
        industry,
        productService,
        aiResult,
        finalInstagramId,
        selectedPlan,
        selectedDuration,
        completionDate,
        isExpress,
        managerName,
        phone,
        email,
        depositorName,
        applicationStatus,
        paymentStatus: effectivePaymentStatus,
        taxInvoiceRequested,
        businessNumber,
        companyName,
        ceoName,
        businessAddress,
        businessType,
        invoiceEmail,
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
        isPaid,
        remainingPosts,
        freeTrialUsed,
        applicationId,
        paymentId,
        generatedPosts: buildPersistedSessionPosts(generatedPosts),
      };

    try {
      window.localStorage.setItem(
        APP_STORAGE_KEY,
        JSON.stringify(appStatePayload)
      );
    } catch {
      const fallbackPayload = {
        ...appStatePayload,
        generatedPosts: [],
      };

      window.localStorage.setItem(
        APP_STORAGE_KEY,
        JSON.stringify(fallbackPayload)
      );
    }

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
    hasAccount,
    instagramId,
    industry,
    productService,
    aiResult,
    finalInstagramId,
    selectedPlan,
    selectedDuration,
    completionDate,
    isExpress,
    managerName,
    phone,
    email,
    depositorName,
    applicationStatus,
    effectivePaymentStatus,
    taxInvoiceRequested,
    businessNumber,
    companyName,
    ceoName,
    businessAddress,
    businessType,
    invoiceEmail,
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
    isPaid,
    remainingPosts,
    freeTrialUsed,
    applicationId,
    paymentId,
    generatedPosts,
    isAuthenticated,
    authEmail,
    authName,
    userId,
    isRequestLinked,
  ]);

  useEffect(() => {
    if (!hasHydrated) return;
    if (hasTestAccess) return;

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
        setPostGeneratorSubscription(null);
        setIsRequestLinked(false);
        return;
      }

      const { snapshot } = await syncProfileAndLinkData({
        user,
        requestEmail: email,
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
        setPostGeneratorSubscription(null);
        setIsRequestLinked(false);
        return;
      }

      void syncProfileAndLinkData({
        user: session.user,
        requestEmail: email,
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
  }, [hasHydrated, email, hasTestAccess]);

  useEffect(() => {
    if (!hasHydrated || typeof window === "undefined") return;

    const screen = new URLSearchParams(window.location.search).get("screen");
    const hasInput =
      !!industry.trim() &&
      !!productService.trim() &&
      (hasAccount !== true || !!instagramId.trim());
    const hasOutput = Boolean(aiResult?.accountPlan && hasInput);
    const hasNames = !hasAccount && Boolean(aiResult?.accountNames?.length);
    const hasInstagramHandle = !!effectiveInstagramId.trim();
    const hasPaymentReady = hasOutput && hasInstagramHandle;
    const hasApplicationReady =
      hasPaymentReady &&
      hasPersistedApplicationRecord &&
      !!managerName.trim() &&
      !!phone.trim() &&
      !!email.trim() &&
      !!depositorName.trim();

    let resolvedStep: Step | null = null;

    if (screen === "landing") {
      resolvedStep = "landing";
    }

    if (screen === "status") {
      if (hasApplicationReady) resolvedStep = "status";
      else if (hasPaymentReady) resolvedStep = "payment";
      else if (hasNames && !hasAccount) resolvedStep = "confirm";
      else if (hasOutput) resolvedStep = "result";
      else resolvedStep = hasAccount === null ? "account-check" : "input";
    }

    if (
      screen === "postgen" ||
      screen === "postsub-payment" ||
      screen === "postsub-status"
    ) {
      router.replace(`/tools?screen=${screen}`);
      return;
    }

    if (resolvedStep) {
      setStep(resolvedStep);
      router.replace("/");
    }
  }, [
    hasHydrated,
    router,
    hasAccount,
    industry,
    productService,
    instagramId,
    effectiveInstagramId,
    hasPersistedApplicationRecord,
    aiResult,
    finalInstagramId,
    managerName,
    phone,
    email,
    depositorName,
    loading,
    aiError,
    isAuthenticated,
    postSubSubmitted,
  ]);

  async function handleGenerate(targetStep: Step = step) {
    if (loading) {
      return;
    }

    if (!surfaceValidationIssues(planningValidationIssues)) {
      return;
    }

    setLoading(true);
    setAiError(null);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "planning",
          industry,
          productService,
          requestId: crypto.randomUUID(),
          previousResult: aiResult,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error ?? "AI 생성에 실패했습니다.");
      }

      if (data.source !== "api") {
        console.warn("[AI Generate] Non-API response detected:", data.source);
        throw new Error("실제 OpenRouter API 응답이 아닙니다.");
      }

      setAiSource("api");
      setAiResult(data);
      goToStep(targetStep);
    } catch (err) {
      console.error("[AI Generate] Network error:", err);
      const message =
        err instanceof Error
          ? err.message
          : "AI 생성에 실패했습니다. 잠시 후 다시 시도해주세요.";
      setAiError(message);
      setAiSource(null);
      goToStep(targetStep);
    } finally {
      setLoading(false);
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
        const message = "로그인 정보가 필요합니다. 다시 로그인해주세요.";
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
          isInternalTestAccount: isTestAccountAuthenticated,
          images: uploadedImages,
          userPrompt: postPrompt,
          instagramHandle: effectiveInstagramId.trim(),
          industry,
          productService,
          accountDirection: aiResult?.accountPlan.direction ?? "",
          accountBio: aiResult?.accountPlan.bio ?? "",
          accountConcept: aiResult?.accountPlan.concept ?? "",
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
        console.warn("[Post Generate] Non-API response detected:", data.source);
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
              current ??
              buildTestAccountSubscription(
                remainingPosts > 0
                  ? remainingPosts
                  : TEST_ACCOUNT_DEFAULT_REMAINING_POSTS
              );
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
          email: authEmail || email || null,
          applicationId: applicationId || null,
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

        if (persistenceResult.error) {
          console.warn(
            "[Generated Post] Persistence warning:",
            persistenceResult.error
          );
        }
      }

      setGeneratedPosts((prev) => [nextPost, ...prev]);

      if (isFreeTrialGeneration) {
        setFreeTrialUsed(true);
      }
    } catch (err) {
      console.error("[Post Generate] Network error:", err);
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

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    if (!email.trim() && authEmail.trim()) {
      setEmail(authEmail.trim());
    }

    if (!managerName.trim() && authName.trim()) {
      setManagerName(authName.trim());
    }

    if (!postSubEmail.trim() && authEmail.trim()) {
      setPostSubEmail(authEmail.trim());
    }

    if (!postSubManagerName.trim() && authName.trim()) {
      setPostSubManagerName(authName.trim());
    }
  }, [
    isAuthenticated,
    authEmail,
    authName,
    email,
    managerName,
    postSubEmail,
    postSubManagerName,
  ]);

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
      email: authEmail || email || null,
    })
      .then(({ posts, error }) => {
        if (!isActive) return;

        if (error) {
          console.warn("[Generated Posts] Load warning:", error);
        }

        setSavedGeneratedPosts(
          posts.map((post) => mapSavedPostToGeneratedPost(post))
        );
      })
      .finally(() => {
        if (isActive) {
          setLoadingSavedPosts(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [isAuthenticated, userId, authEmail, email, isTestAccountAuthenticated]);

  useEffect(() => {
    if (!savedGeneratedPosts.length) {
      return;
    }

    if (savedGeneratedPosts.some((post) => post.isFreeTrial)) {
      setFreeTrialUsed(true);
    }
  }, [savedGeneratedPosts]);

  useEffect(() => {
    if (isTestAccountAuthenticated) {
      setPostGeneratorSubscription((current) => {
        if (current && isPostGeneratorSubscriptionActive(current)) {
          return current;
        }

        return buildTestAccountSubscription(
          remainingPosts > 0 ? remainingPosts : TEST_ACCOUNT_DEFAULT_REMAINING_POSTS
        );
      });
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
  }, [isAuthenticated, userId, isTestAccountAuthenticated, remainingPosts]);

  function handleSignupCta() {
    openAuthPage("status");
  }

  function handleMoveToPostSubscriptionPayment() {
    if (hasActivePostGeneratorSubscription) {
      showValidationToast("이미 월 구독이 활성화되어 있습니다");
      goToStep("postgen");
      return;
    }

    if (!isAuthenticated) {
      openAuthPage("postgen");
      return;
    }

    goToStep("postsub-payment");
  }

  async function handlePostSubscriptionSubmit() {
    if (submittingPostSubscription) {
      return;
    }

    if (!surfaceValidationIssues(postSubscriptionPaymentValidationIssues)) {
      return;
    }

    setSubmittingPostSubscription(true);
    setPostError(null);

    try {
      setPostSubSubmitted(true);
      setPostSubRequestedAt(new Date().toISOString());
      goToStep("postsub-status");
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
      goToStep("postgen");
      return;
    }

    if (isTestAccountAuthenticated) {
      setPostGeneratorSubscription(
        buildTestAccountSubscription(POST_GENERATOR_MONTHLY_CREDITS)
      );
      setPostSubSubmitted(true);
      setPostSubRequestedAt((current) => current || new Date().toISOString());
      showValidationToast("체험 계정 월 구독이 활성화되었습니다");
      goToStep("postgen");
      return;
    }

    if (!isAuthenticated || !userId) {
      openAuthPage("postgen");
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
      goToStep("postgen");
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

  async function handleApplicationSubmit() {
    if (submittingApplication) {
      return;
    }

    if (!surfaceValidationIssues(paymentValidationIssues)) {
      setSubmissionError(null);
      return;
    }

    setSubmissionError(null);
    setSubmittingApplication(true);
    setApplicationStatus("submitted");

    const totalPrice =
      getPrice(selectedPlan, selectedDuration) + getExpressFee(isExpress);

    try {
      const result = await persistApplicationSubmission({
        userId: isTestAccountAuthenticated ? null : userId || null,
        email,
        instagramId: effectiveInstagramId.trim(),
        hasAccount: Boolean(hasAccount),
        industry,
        productService,
        accountDirection: aiResult?.accountPlan.direction,
        accountBio: aiResult?.accountPlan.bio,
        accountConcept: aiResult?.accountPlan.concept,
        selectedPlan,
        selectedDuration,
        isExpress,
        completionDate,
        managerName,
        phone,
        depositorName,
        taxInvoiceRequested,
        businessNumber,
        companyName,
        ceoName,
        businessAddress,
        businessType,
        invoiceEmail,
        amount: totalPrice,
        bankName: BANK_TRANSFER_INFO.bankName,
        accountNumber: BANK_TRANSFER_INFO.accountNumber,
        accountHolder: BANK_TRANSFER_INFO.accountHolder,
      });

      if (result.error) {
        throw new Error(result.error);
      }

      setApplicationId(result.applicationId ?? "");
      setPaymentId(result.paymentId ?? "");
      setIsPaid(false);
      setApplicationStatus("payment_pending");
      setPaymentStatus("pending");
      goToStep("status");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "신청 정보를 저장하지 못했습니다. 다시 시도해주세요.";
      setSubmissionError(message);
      if (!applicationId.trim()) {
        setApplicationStatus("idle");
      }
      showValidationToast(message);
    } finally {
      setSubmittingApplication(false);
    }
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
    setPostGeneratorSubscription(null);
    setIsRequestLinked(false);
    setHasTestAccess(false);
  }

  const wrapper =
    "min-h-screen bg-[#f8f9fb] flex items-start justify-center px-4 py-12";

  function buildPersistedSessionPosts(posts: GeneratedPost[]) {
    return posts.slice(0, 2).map((post) => ({
      id: post.id,
      title: post.title,
      content: post.content,
      hashtags: post.hashtags,
      imagePreview: post.imagePreview,
      imageModelText: post.imageModelText,
      createdAt: post.createdAt,
      isPersisted: post.isPersisted,
      isFreeTrial: post.isFreeTrial,
    }));
  }

  /* ═══════════════ LANDING ═══════════════ */

  if (activeStep === "landing") {
    return (
      <main className="min-h-screen bg-[#f8f9fb] flex items-center justify-center px-4">
        <div className="max-w-xl w-full text-center space-y-10">
          <div className="space-y-2">
            <div className="flex items-center justify-end gap-2">
              {hasHydrated ? (
                isAuthenticated ? (
                  <>
                    {isTestAccountAuthenticated && (
                      <span className="text-[10px] font-semibold bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full">
                        체험 계정
                      </span>
                    )}
                    <button
                      onClick={() => router.push("/mypage")}
                      className="text-sm font-medium text-rose-600 hover:text-rose-700 transition-colors"
                    >
                      마이페이지
                    </button>
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
                    onClick={() => openAuthPage("landing", "login")}
                      className="text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
                    >
                      로그인
                    </button>
                    <button
                    onClick={() => openAuthPage("landing", "signup")}
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
            {hasHydrated && isTestAccountAuthenticated && (
              <p className="text-xs text-violet-600 text-right">
                현재 체험 계정으로 로그인되어 있으며 일부 기능이 미리 활성화되어 있습니다.
              </p>
            )}
          </div>

          {/* Hero */}
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 bg-rose-50 text-rose-600 text-xs font-semibold px-4 py-1.5 rounded-full border border-rose-100">
              AI 마케팅 서비스
            </div>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-gray-900 leading-tight">
              AI 마케터를
              <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-rose-500 to-pink-500">
                월 30만원
              </span>
              에 고용하세요
            </h1>
            <p className="text-gray-500 text-base leading-relaxed max-w-md mx-auto">
              일반 마케터 대비 최대 90% 비용 절감
              <br />
              전문 마케터 수준의 결과를 더 빠르고 합리적인 비용으로
            </p>
          </div>

          {/* Feature selection */}
          <div className="space-y-4">
            <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">
              원하시는 서비스를 선택하세요
            </p>
            <div className="grid grid-cols-1 gap-3">
              {/* Feature 1: AI 마케터 */}
              <button
                onClick={() => goToStep("account-check")}
                className="group text-left p-6 rounded-2xl bg-white border-2 border-gray-100 hover:border-rose-300 hover:shadow-lg active:scale-[0.99] transition-all"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center text-white text-xl flex-shrink-0">
                    📱
                  </div>
                  <div className="space-y-1">
                    <p className="font-bold text-gray-900 text-lg group-hover:text-rose-600 transition-colors">
                      AI 인스타그램 마케터
                    </p>
                    <p className="text-sm text-gray-500">
                      AI가 계정 기획부터 마케팅 전략까지 한번에
                    </p>
                  </div>
                </div>
              </button>

              {/* Feature 2: 게시물 AI 생성 */}
              <button
                onClick={() => router.push("/tools")}
                className={`group text-left p-6 rounded-2xl border-2 transition-all ${
                  canGeneratePost ||
                  hasActivePostGeneratorSubscription ||
                  isAuthenticated
                    ? "bg-white border-gray-100 hover:border-violet-300 hover:shadow-lg active:scale-[0.99]"
                    : "bg-gray-50 border-gray-100 opacity-70"
                }`}
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-400 to-purple-500 flex items-center justify-center text-white text-xl flex-shrink-0">
                    ✨
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-gray-900 text-lg group-hover:text-violet-600 transition-colors">
                        게시물 AI 생성
                      </p>
                      {!hasConsumedFreeTrial ? (
                        <span className="text-[10px] font-semibold bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full">
                          1회 무료 체험
                        </span>
                      ) : hasActivePostGeneratorSubscription ? (
                        <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-600 px-2 py-0.5 rounded-full">
                          월 구독 이용중
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">
                          월 {formattedSubscriptionPrice}원
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">
                      무료 체험 뒤 월 구독으로 이어지고, 이후 AI 마케터 서비스로 확장할 수 있습니다
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  /* ═══════════════ ACCOUNT CHECK ═══════════════ */

  if (activeStep === "account-check") {
    return (
      <main className="min-h-screen bg-[#f8f9fb] flex items-center justify-center px-4">
        <div className="max-w-xl w-full text-center space-y-8">
          <StepUtilityHeader
            onBack={() => navigateBack("account-check")}
            onHome={() => goToStep("landing")}
            onMyPage={() => router.push("/mypage")}
            progress={serviceFlowProgress}
          />

          <div className="space-y-3">
            <div className="w-16 h-16 bg-gradient-to-br from-rose-400 to-pink-500 rounded-full flex items-center justify-center mx-auto shadow-lg">
              <span className="text-white text-2xl">📱</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900">
              계정이 있으신가요?
            </h2>
            <p className="text-sm text-gray-500">
              인스타그램 계정 유무에 따라 맞춤 기획을 진행합니다
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => {
                setHasAccount(true);
                goToStep("input");
              }}
              className="p-6 rounded-2xl bg-gradient-to-r from-rose-500 to-pink-500 text-white font-semibold shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all space-y-1"
            >
              <div className="text-2xl">📱</div>
              <div className="font-semibold">계정이 있어요</div>
              <div className="text-sm text-white/80">기존 계정으로 시작</div>
            </button>
            <button
              onClick={() => {
                setHasAccount(false);
                goToStep("input");
              }}
              className="p-6 rounded-2xl border-2 border-gray-200 bg-white text-gray-700 font-semibold hover:border-gray-300 hover:shadow-md active:scale-[0.98] transition-all space-y-1"
            >
              <div className="text-2xl">✨</div>
              <div className="font-semibold">계정이 없어요</div>
              <div className="text-sm text-gray-500">새 계정으로 시작</div>
            </button>
          </div>
        </div>
      </main>
    );
  }

  /* ═══════════════ INPUT ═══════════════ */

  if (activeStep === "input") {
    return (
      <>
        <main className={wrapper}>
          <div className="max-w-xl w-full space-y-6">
            <StepUtilityHeader
              onBack={() => navigateBack("input")}
              onHome={() => goToStep("landing")}
              onMyPage={() => router.push("/mypage")}
              progress={serviceFlowProgress}
            />

            <div className="text-center space-y-1">
              <h2 className="text-2xl font-bold text-gray-900">
                정보를 알려주세요
              </h2>
              <p className="text-sm text-gray-500">
                AI가 맞춤 마케팅 전략을 기획합니다
              </p>
            </div>

            <Card className="space-y-5">
              {hasAccount && (
                <InputField
                  label="인스타그램 아이디"
                  value={instagramId}
                  onChange={setInstagramId}
                  onBlur={() => markFieldTouched("instagramId")}
                  placeholder="예: our_brand"
                  required
                  error={instagramIdError}
                  fieldKey="instagramId"
                />
              )}
              <InputField
                label="업종"
                value={industry}
                onChange={setIndustry}
                onBlur={() => markFieldTouched("industry")}
                placeholder="예: 정보통신업"
                required
                error={industryError}
                fieldKey="industry"
              />
              <TextareaField
                label="판매하는 상품 / 서비스"
                value={productService}
                onChange={setProductService}
                onBlur={() => markFieldTouched("productService")}
                placeholder="기획부터 완결까지 한 번에 끝내는 웹소설 올인원 창작 웹. 세계관 구축, 집필, AI 검증, 카드 뽑기를 통한 영감까지 모두 지원합니다."
                required
                rows={4}
                error={productServiceError}
                fieldKey="productService"
              />
            </Card>

            <button
              onClick={() => handleGenerate("result")}
              disabled={loading}
              aria-disabled={loading || !isPlanningReady}
              className={`${getPrimaryActionButtonClass({
                theme: "rose",
                isInactive: loading || !isPlanningReady,
              })} py-4`}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  AI가 기획 중입니다...
                </span>
              ) : (
                "AI로 기획하기"
              )}
            </button>
          </div>
        </main>
        <ValidationToast
          message={validationToast}
          onClose={() => setValidationToast(null)}
          theme="rose"
        />
      </>
    );
  }

  /* ═══════════════ RESULT (account planning only) ═══════════════ */

  if (activeStep === "result") {
    if (loading) {
      return (
        <main className={wrapper}>
          <div className="max-w-2xl w-full space-y-6">
            <StepUtilityHeader
              onBack={() => navigateBack("result")}
              onHome={() => goToStep("landing")}
              onMyPage={() => router.push("/mypage")}
              progress={serviceFlowProgress}
            />
            <div className="text-center space-y-4 py-12">
              <div className="w-10 h-10 border-4 border-rose-200 border-t-rose-500 rounded-full animate-spin mx-auto" />
              <p className="text-gray-500 text-sm">
                AI가 기획안을 생성 중입니다...
              </p>
            </div>
          </div>
        </main>
      );
    }

    return (
      <>
      <main className={wrapper}>
        <div className="max-w-2xl w-full space-y-6">
          <StepUtilityHeader
            onBack={() => navigateBack("result")}
            onHome={() => goToStep("landing")}
            onMyPage={() => router.push("/mypage")}
            progress={serviceFlowProgress}
          />

          <div className="text-center space-y-1">
            <h2 className="text-2xl font-bold text-gray-900">AI 기획 결과</h2>
            <p className="text-sm text-gray-500">
              아래 전략을 바탕으로 인스타그램을 운영해 보세요
            </p>
            {aiSource && (
              <span className={`inline-block text-[10px] font-mono px-2 py-0.5 rounded-full ${aiSource === "api" ? "bg-green-50 text-green-600" : "bg-amber-50 text-amber-600"}`}>
                {aiSource === "api" ? "API 결과" : "예비 결과"}
              </span>
            )}
          </div>

          {aiError && (
            <Card className="bg-red-50 border-red-100 text-center space-y-2">
              <p className="text-sm font-medium text-red-600">{aiError}</p>
              <button
                onClick={() => handleGenerate("result")}
                className="text-xs text-red-500 underline hover:text-red-700"
              >
                다시 시도하기
              </button>
            </Card>
          )}

          {/* 계정 기획 */}
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <SectionLabel>계정 기획</SectionLabel>
              <button
                onClick={() => handleGenerate("result")}
                disabled={loading}
                className="text-xs text-rose-500 hover:text-rose-600 font-medium transition-colors disabled:opacity-50"
              >
                {loading ? "생성 중..." : "다시 생성하기"}
              </button>
            </div>
            {[
              {
                label: "추천 계정 방향",
                value: aiResult?.accountPlan.direction,
              },
              { label: "소개글 (Bio)", value: aiResult?.accountPlan.bio },
              { label: "운영 컨셉", value: aiResult?.accountPlan.concept },
            ].map((item, i) => (
              <div key={i} className="p-3 bg-gray-50 rounded-xl">
                <span className="text-gray-400 text-xs block mb-0.5">
                  {item.label}
                </span>
                <span className="text-gray-800 text-sm font-medium whitespace-pre-line">
                  {item.value}
                </span>
              </div>
            ))}
          </Card>

          {/* Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => navigateBack("result")}
              className="py-4 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              다시 기획하기
            </button>
            <button
              onClick={handleResultNext}
              aria-disabled={!isResultNextReady}
              className={`${getPrimaryActionButtonClass({
                theme: "rose",
                isInactive: !isResultNextReady,
              })} py-4`}
            >
              다음
            </button>
          </div>
        </div>
      </main>
      <ValidationToast
        message={validationToast}
        onClose={() => setValidationToast(null)}
        theme="rose"
      />
      </>
    );
  }

  /* ═══════════════ NAMES (no-account flow only) ═══════════════ */

  if (activeStep === "names") {
    return (
      <>
      <main className={wrapper}>
        <div className="max-w-2xl w-full space-y-6">
          <StepUtilityHeader
            onBack={() => navigateBack("names")}
            onHome={() => goToStep("landing")}
            onMyPage={() => router.push("/mypage")}
            progress={serviceFlowProgress}
          />

          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-2 bg-rose-50 text-rose-600 text-xs font-semibold px-4 py-1.5 rounded-full border border-rose-100">
              AI 추천
            </div>
            <h2 className="text-2xl font-bold text-gray-900">
              추천 인스타그램 계정명
            </h2>
            <p className="text-sm text-gray-500">
              AI가 브랜드에 맞는 인스타그램 계정명을 추천해드립니다
            </p>
            {aiSource && (
              <span className={`inline-block text-[10px] font-mono px-2 py-0.5 rounded-full ${aiSource === "api" ? "bg-green-50 text-green-600" : "bg-amber-50 text-amber-600"}`}>
                {aiSource === "api" ? "API 결과" : "예비 결과"}
              </span>
            )}
          </div>

          {aiError && (
            <Card className="bg-red-50 border-red-100 text-center space-y-2">
              <p className="text-sm font-medium text-red-600">{aiError}</p>
              <button
                onClick={() => handleGenerate("names")}
                className="text-xs text-red-500 underline hover:text-red-700"
              >
                다시 시도하기
              </button>
            </Card>
          )}

          <Card className="space-y-4">
            <div className="flex items-center justify-between">
              <SectionLabel>추천 계정명</SectionLabel>
              <button
                onClick={() => handleGenerate("names")}
                disabled={loading}
                className="text-xs text-rose-500 hover:text-rose-600 font-medium transition-colors disabled:opacity-50"
              >
                {loading ? "생성 중..." : "다시 생성하기"}
              </button>
            </div>
            <div className="space-y-3">
              {aiResult?.accountNames.map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 p-4 bg-gray-50 rounded-xl"
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                    {item.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="space-y-0.5">
                    <p className="font-semibold text-gray-900">@{item.name}</p>
                    <p className="text-sm text-gray-500">{item.meaning}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => navigateBack("names")}
              className="py-4 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              이전으로
            </button>
            <button
              onClick={handleNamesNext}
              aria-disabled={!isNamesNextReady}
              className={`${getPrimaryActionButtonClass({
                theme: "rose",
                isInactive: !isNamesNextReady,
              })} py-4`}
            >
              다음 단계로
            </button>
          </div>
        </div>
      </main>
      <ValidationToast
        message={validationToast}
        onClose={() => setValidationToast(null)}
        theme="rose"
      />
      </>
    );
  }

  /* ═══════════════ CONFIRM (no-account flow only) ═══════════════ */

  if (activeStep === "confirm") {
    return (
      <>
      <main className={wrapper}>
        <div className="max-w-xl w-full space-y-6">
          <StepUtilityHeader
            onBack={() => navigateBack("confirm")}
            onHome={() => goToStep("landing")}
            onMyPage={() => router.push("/mypage")}
            progress={serviceFlowProgress}
          />

          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold text-gray-900">
              인스타그램 계정 생성 확인
            </h2>
            <p className="text-sm text-gray-500 leading-relaxed max-w-md mx-auto">
              추천 계정명을 참고해 인스타그램 계정을 생성해주세요.
              <br />
              생성 완료 후 최종 아이디를 입력해주세요.
            </p>
          </div>

          {/* 추천 이름 요약 */}
          <Card className="space-y-2">
            <SectionLabel>추천 계정명</SectionLabel>
            <p className="text-xs text-gray-500">
              추천 계정명을 누르면 자동 입력됩니다
            </p>
            <div className="flex flex-wrap gap-2">
              {aiResult?.accountNames.map((item, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setFinalInstagramId(item.name)}
                  className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-all ${
                    finalInstagramId.trim() === item.name
                      ? "bg-rose-50 text-rose-600 border border-rose-200 shadow-sm"
                      : "bg-gray-50 text-gray-700 border border-transparent hover:border-gray-200 hover:bg-white"
                  }`}
                >
                  @{item.name}
                </button>
              ))}
            </div>
          </Card>

          <Card className="space-y-4">
            <InputField
              label="최종 인스타그램 아이디"
              value={finalInstagramId}
              onChange={setFinalInstagramId}
              onBlur={() => markFieldTouched("finalInstagramId")}
              placeholder="예: our_brand"
              required
              error={finalInstagramIdError}
              fieldKey="finalInstagramId"
            />
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => navigateBack("confirm")}
              className="py-4 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              이전으로
            </button>
            <button
              onClick={() => {
                moveToPayment(finalInstagramId.trim());
              }}
              aria-disabled={!isConfirmReady}
              className={`${getPrimaryActionButtonClass({
                theme: "rose",
                isInactive: !isConfirmReady,
              })} py-4`}
            >
              확인하고 다음으로
            </button>
          </div>
        </div>
      </main>
      <ValidationToast
        message={validationToast}
        onClose={() => setValidationToast(null)}
        theme="rose"
      />
      </>
    );
  }

  /* ═══════════════ PAYMENT ═══════════════ */

  if (activeStep === "payment") {
    const basePrice = getPrice(selectedPlan, selectedDuration);
    const expressFee = getExpressFee(isExpress);
    const totalPrice = basePrice + expressFee;

    return (
      <>
      <main className={wrapper}>
        <div className="max-w-2xl w-full space-y-6">
          <StepUtilityHeader
            onBack={() => {
              navigateBack("payment");
            }}
            onHome={() => goToStep("landing")}
            onMyPage={() => router.push("/mypage")}
            progress={serviceFlowProgress}
          />

          <div className="text-center space-y-1">
            <h2 className="text-2xl font-bold text-gray-900">
              마케팅 서비스 신청
            </h2>
            <p className="text-sm text-gray-500">
              필요한 옵션만 선택하고 바로 신청하세요
            </p>
          </div>

          {/* Plan selection */}
          <div>
            <SectionLabel>플랜 선택</SectionLabel>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Plan 1 */}
              <button
                onClick={() => setSelectedPlan(1)}
                onBlur={() => markFieldTouched("selectedPlan")}
                data-validation-field="selectedPlan"
                aria-invalid={Boolean(selectedPlanError)}
                className={`text-left p-5 rounded-2xl border-2 transition-all ${
                  selectedPlan === 1
                    ? "border-rose-500 bg-rose-50/50 shadow-md"
                    : selectedPlanError
                      ? "border-rose-300 bg-rose-50/40"
                      : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-bold text-gray-900 text-lg">
                    AI 마케터 1명
                  </p>
                  <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-full">
                    2개월 17% 할인
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-1">
                  가볍게 시작하는 기본 운영
                </p>
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-sm text-gray-700">
                    <span>1개월</span>
                    <span className="font-semibold">30만원</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-gray-700">
                    <span>2개월</span>
                    <span className="font-semibold">50만원</span>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-500">
                    첫 운영, 핵심 콘텐츠 중심
                  </p>
                  <p
                    className={`mt-2 text-xs leading-relaxed ${
                      selectedPlan === 1 ? "text-rose-600" : "text-gray-500"
                    }`}
                  >
                    현재 기간 기준 예상 팔로우{" "}
                    {formatOutcomeValue(
                      "followers",
                      planOneExpectedOutcome.followers
                    )}
                    , 좋아요{" "}
                    {formatOutcomeValue("likes", planOneExpectedOutcome.likes)},
                    댓글{" "}
                    {formatOutcomeValue(
                      "comments",
                      planOneExpectedOutcome.comments
                    )}
                  </p>
                </div>
              </button>

              {/* Plan 2 */}
              <button
                onClick={() => setSelectedPlan(2)}
                onBlur={() => markFieldTouched("selectedPlan")}
                aria-invalid={Boolean(selectedPlanError)}
                className={`text-left p-5 rounded-2xl border-2 transition-all relative overflow-hidden ${
                  selectedPlan === 2
                    ? "border-rose-500 bg-rose-50/50 shadow-md"
                    : selectedPlanError
                      ? "border-rose-300 bg-rose-50/40"
                      : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <div className="absolute top-0 right-0 bg-gradient-to-r from-rose-500 to-pink-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl">
                  추천
                </div>
                <div className="flex items-center justify-between gap-3 pr-14">
                  <p className="font-bold text-gray-900 text-lg">
                    AI 마케터 2명
                  </p>
                  <span className="text-[10px] font-semibold bg-rose-100 text-rose-500 px-2.5 py-1 rounded-full">
                    2개월 20% 할인
                  </span>
                </div>
                <p className="text-sm text-rose-500 font-medium mt-1">
                  더 빠르게 키우는 파워 운영
                </p>
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between text-sm text-gray-700">
                    <span>1개월</span>
                    <span className="font-semibold">50만원</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-gray-700">
                    <span>2개월</span>
                    <span className="font-semibold">80만원</span>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-500">
                    더 많은 실행, 더 빠른 성장
                  </p>
                  <p
                    className={`mt-2 text-xs leading-relaxed ${
                      selectedPlan === 2 ? "text-rose-600" : "text-gray-500"
                    }`}
                  >
                    현재 기간 기준 예상 팔로우{" "}
                    {formatOutcomeValue(
                      "followers",
                      planTwoExpectedOutcome.followers
                    )}
                    , 좋아요{" "}
                    {formatOutcomeValue("likes", planTwoExpectedOutcome.likes)},
                    댓글{" "}
                    {formatOutcomeValue(
                      "comments",
                      planTwoExpectedOutcome.comments
                    )}
                  </p>
                </div>
              </button>
            </div>
            {selectedPlanError && (
              <p className={`mt-2 ${getHelperTextClass("rose")}`}>{selectedPlanError}</p>
            )}
          </div>

          {/* Duration selection */}
          <div>
            <SectionLabel>운영 기간</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              {[1, 2].map((d) => (
                <button
                  key={d}
                  onClick={() => {
                    setSelectedDuration(d);
                    if (isExpress) {
                      setCompletionDate(getDefaultCompletionDate(d));
                    }
                  }}
                  onBlur={() => markFieldTouched("selectedDuration")}
                  data-validation-field={d === 1 ? "selectedDuration" : undefined}
                  aria-invalid={Boolean(selectedDurationError)}
                  className={`p-4 rounded-xl border-2 font-medium transition-all ${
                    selectedDuration === d
                      ? "border-rose-500 bg-rose-50/50 text-rose-600"
                      : selectedDurationError
                        ? "border-rose-300 bg-rose-50/40 text-gray-700"
                        : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                  }`}
                >
                  <div>{d === 1 ? "1개월 운영" : "2개월 운영"}</div>
                  <p
                    className={`mt-1 text-xs ${
                      selectedDuration === d ? "text-rose-500" : "text-gray-500"
                    }`}
                  >
                    예상 팔로우{" "}
                    {formatOutcomeValue(
                      "followers",
                      d === 1
                        ? oneMonthExpectedOutcome.followers
                        : twoMonthExpectedOutcome.followers
                    )}
                  </p>
                </button>
              ))}
            </div>
            {selectedDurationError && (
              <p className={`mt-2 ${getHelperTextClass("rose")}`}>
                {selectedDurationError}
              </p>
            )}
            <p className="text-xs text-emerald-600 mt-3 font-medium">
              2개월 운영이 더 경제적입니다
            </p>
          </div>

          <Card className="space-y-5 border-rose-100">
            <div className="space-y-1">
              <SectionLabel>예상 성과</SectionLabel>
              <h3 className="text-xl font-bold text-gray-900">
                선택한 운영 기준으로 기대할 수 있는 흐름
              </h3>
              <p className="text-sm text-gray-500">
                플랜과 기간을 바꾸면 아래 수치와 그래프가 바로 반영됩니다
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {expectedOutcomeCards.map((metric) => (
                <div
                  key={metric.key}
                  className="rounded-2xl border border-rose-100 bg-gradient-to-br from-rose-50 to-white px-4 py-4"
                >
                  <p className="text-xs font-semibold text-rose-500">
                    {metric.label}
                  </p>
                  <p className="mt-2 text-2xl font-bold text-gray-900">
                    {metric.formattedValue}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                    {metric.description}
                  </p>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-rose-100 bg-gradient-to-br from-rose-50 via-white to-pink-50 px-5 py-5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-gray-900">
                    성장 미리보기 그래프
                  </p>
                  <p className="text-xs text-gray-500">
                    막대가 클수록 현재 선택 기준 예상 반응 폭이 큽니다
                  </p>
                </div>
                <span className="text-[10px] font-semibold bg-white text-rose-500 border border-rose-100 px-2.5 py-1 rounded-full">
                  현재 선택 기준
                </span>
              </div>

              <div className="mt-6 grid grid-cols-3 gap-3 items-end">
                {expectedOutcomeCards.map((metric) => (
                  <div key={metric.key} className="space-y-3">
                    <div className="h-40 rounded-2xl bg-white/80 border border-white px-3 py-3 flex items-end">
                      <div className="w-full h-full flex items-end">
                        <div
                          className={`w-full rounded-t-2xl bg-gradient-to-t ${metric.barClassName} shadow-[0_10px_30px_rgba(244,63,94,0.18)] transition-all duration-300`}
                          style={{ height: metric.barHeight }}
                        />
                      </div>
                    </div>
                    <div className="text-center space-y-1">
                      <p className="text-sm font-semibold text-gray-800">
                        {metric.shortLabel}
                      </p>
                      <p className="text-xs text-gray-500">
                        {metric.formattedValue}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {planUpgradeDiff && (
                <div className="rounded-2xl border border-rose-100 bg-white px-4 py-4">
                  <p className="text-xs font-semibold text-rose-500">
                    AI 마케터 2명으로 올리면
                  </p>
                  <p className="mt-2 text-sm text-gray-700 leading-relaxed">
                    현재 기간 기준 팔로우{" "}
                    {formatOutcomeDiff("followers", planUpgradeDiff.followers)},
                    좋아요{" "}
                    {formatOutcomeDiff("likes", planUpgradeDiff.likes)}, 댓글{" "}
                    {formatOutcomeDiff("comments", planUpgradeDiff.comments)}{" "}
                    차이를 기대할 수 있어요.
                  </p>
                </div>
              )}

              {durationUpgradeDiff && (
                <div className="rounded-2xl border border-rose-100 bg-white px-4 py-4">
                  <p className="text-xs font-semibold text-rose-500">
                    운영 기간을 2개월로 늘리면
                  </p>
                  <p className="mt-2 text-sm text-gray-700 leading-relaxed">
                    반응이 누적되는 구간까지 보면서 팔로우{" "}
                    {formatOutcomeDiff(
                      "followers",
                      durationUpgradeDiff.followers
                    )}
                    , 좋아요{" "}
                    {formatOutcomeDiff("likes", durationUpgradeDiff.likes)},
                    댓글{" "}
                    {formatOutcomeDiff(
                      "comments",
                      durationUpgradeDiff.comments
                    )}{" "}
                    추가 흐름을 기대할 수 있어요.
                  </p>
                </div>
              )}

              {!planUpgradeDiff && !durationUpgradeDiff && (
                <div className="rounded-2xl border border-rose-100 bg-white px-4 py-4 sm:col-span-2">
                  <p className="text-xs font-semibold text-rose-500">
                    현재 가장 높은 운영 기준을 선택하셨습니다
                  </p>
                  <p className="mt-2 text-sm text-gray-700 leading-relaxed">
                    도달과 반응을 더 크게 가져가고 싶은 경우를 기준으로 잡은
                    현재 최고 성과 구간입니다.
                  </p>
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-gray-50 border border-gray-100 px-4 py-3">
              <p className="text-xs text-gray-500 leading-relaxed">
                업종, 콘텐츠 주제, 계정 상태에 따라 실제 성과는 달라질 수
                있습니다. 위 수치는 운영 기준 예상치이며, 보장 수치는 아닙니다.
              </p>
            </div>
          </Card>

          <Card className="space-y-4 border-rose-100">
            <div className="space-y-1">
              <SectionLabel>성과는 언제부터 보이나요?</SectionLabel>
              <p className="text-sm text-gray-500">
                초반에는 방향을 정리하고, 이후부터 노출과 반응이 차근차근
                쌓이는 흐름으로 이해하시면 됩니다.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  title: "초반",
                  summary: "계정 정리 및 콘텐츠 방향 설정",
                  description:
                    "프로필, 메시지, 게시물 톤을 맞추며 운영의 기준을 세웁니다.",
                },
                {
                  title: "이후",
                  summary: "노출과 반응이 점차 누적",
                  description:
                    "콘텐츠가 쌓이면서 좋아요와 저장, 프로필 방문 흐름이 붙기 시작합니다.",
                },
                {
                  title: "일정 기간 후",
                  summary: "팔로우와 댓글 증가 흐름",
                  description:
                    "반복 노출과 콘텐츠 축적으로 팔로우와 댓글 반응이 더 또렷해집니다.",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-gray-100 bg-white px-4 py-4"
                >
                  <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-1 text-[10px] font-semibold text-rose-500">
                    {item.title}
                  </span>
                  <p className="mt-3 text-sm font-semibold text-gray-900">
                    {item.summary}
                  </p>
                  <p className="mt-2 text-xs text-gray-500 leading-relaxed">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="space-y-3">
            <SectionLabel>급행 마무리 요청</SectionLabel>
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="relative pt-0.5">
                <input
                  type="checkbox"
                  checked={isExpress}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setIsExpress(checked);
                    setCompletionDate(
                      checked ? getDefaultCompletionDate(selectedDuration) : ""
                    );
                  }}
                  className="sr-only"
                />
                <div
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                    isExpress
                      ? "bg-rose-500 border-rose-500"
                      : "border-gray-300 group-hover:border-gray-400"
                  }`}
                >
                  {isExpress && (
                    <span className="text-white text-xs font-bold">✓</span>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-gray-900">
                  급행으로 진행하기 (+1만원)
                </p>
                <p className="text-xs text-gray-500">
                  원하시는 날짜에 맞춰 우선적으로 작업을 진행합니다
                </p>
              </div>
            </label>
            {isExpress && (
              <div className="space-y-1.5 pt-3 border-t border-gray-100">
                <label className="block text-sm font-medium text-gray-700">
                  급행 마무리 날짜
                </label>
                <input
                  type="date"
                  value={completionDate}
                  onChange={(e) => setCompletionDate(e.target.value)}
                  onBlur={() => markFieldTouched("completionDate")}
                  data-validation-field="completionDate"
                  aria-invalid={Boolean(completionDateError)}
                  className={getTextFieldClass({
                    theme: "rose",
                    hasError: Boolean(completionDateError),
                  })}
                />
                <p className="text-xs text-gray-500">
                  원하시는 날짜에 맞춰 우선적으로 작업을 진행합니다
                </p>
                {completionDateError && (
                  <p className={getHelperTextClass("rose")}>{completionDateError}</p>
                )}
              </div>
            )}
          </Card>

          {/* Summary */}
          <Card className="bg-gradient-to-br from-gray-900 to-gray-800 border-none text-white space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              결제 요약
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">선택 상품</span>
                <span className="font-medium">
                  AI 마케터 {selectedPlan}명 · {selectedDuration}달
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">운영 기간</span>
                <span className="font-medium">
                  {selectedDuration === 1 ? "1개월 운영" : "2개월 운영"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">급행 여부</span>
                <span className="font-medium">
                  {isExpress ? "급행 진행" : "일반 진행"}
                </span>
              </div>
              {isExpress && completionDate && (
                <div className="flex justify-between">
                  <span className="text-gray-400">마무리 날짜</span>
                  <span className="font-medium">
                    {formatDateKorean(completionDate)}
                  </span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-gray-700">
                <span className="text-gray-400">결제 금액</span>
                <span className="text-xl font-bold text-rose-400">
                  {totalPrice.toLocaleString()}원
                </span>
              </div>
            </div>
          </Card>

          {/* Bank info */}
          <Card className="space-y-2">
            <SectionLabel>입금 정보</SectionLabel>
            <div className="text-sm space-y-1 text-gray-700">
              <p>
                <span className="text-gray-400">은행:</span>{" "}
                {BANK_TRANSFER_INFO.bankName}
              </p>
              <p>
                <span className="text-gray-400">계좌번호:</span>{" "}
                {BANK_TRANSFER_INFO.accountNumber}
              </p>
              <p>
                <span className="text-gray-400">예금주:</span>{" "}
                {BANK_TRANSFER_INFO.accountHolder}
              </p>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">
              입금자명은 신청 시 입력한 이름과 동일하게 입력해주세요. 입금 확인 후
              서비스가 시작됩니다.
            </p>
          </Card>

          {/* Form */}
          <Card className="space-y-5">
            <SectionLabel>신청자 정보</SectionLabel>
            <InputField
              label="담당자명"
              value={managerName}
              onChange={setManagerName}
              onBlur={() => markFieldTouched("managerName")}
              placeholder="홍길동"
              required
              error={managerNameError}
              fieldKey="managerName"
            />
            <InputField
              label="연락처"
              value={phone}
              onChange={setPhone}
              onBlur={() => markFieldTouched("phone")}
              placeholder="010-0000-0000"
              type="tel"
              required
              error={phoneError}
              fieldKey="phone"
            />
            <InputField
              label="아이디(이메일)"
              value={email}
              onChange={setEmail}
              onBlur={() => markFieldTouched("email")}
              placeholder="예: brand@company.com"
              type="email"
              required
              error={emailError}
              fieldKey="email"
            />
            <InputField
              label="입금자명"
              value={depositorName}
              onChange={setDepositorName}
              onBlur={() => markFieldTouched("depositorName")}
              placeholder="홍길동"
              required
              error={depositorNameError}
              fieldKey="depositorName"
            />

            {/* Tax invoice */}
            <div className="pt-3 border-t border-gray-100">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={taxInvoiceRequested}
                    onChange={(e) => setTaxInvoiceRequested(e.target.checked)}
                    className="sr-only"
                  />
                  <div
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      taxInvoiceRequested
                        ? "bg-rose-500 border-rose-500"
                        : "border-gray-300 group-hover:border-gray-400"
                    }`}
                  >
                    {taxInvoiceRequested && (
                      <span className="text-white text-xs font-bold">✓</span>
                    )}
                  </div>
                </div>
                <span className="text-sm font-medium text-gray-700">
                  세금계산서 발행 요청
                </span>
              </label>
            </div>

            {taxInvoiceRequested && (
              <div className="space-y-4 pt-3 border-t border-gray-100">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  세금계산서 정보
                </p>
                <InputField
                  label="사업자등록번호"
                  value={businessNumber}
                  onChange={setBusinessNumber}
                  placeholder="000-00-00000"
                />
                <InputField
                  label="상호"
                  value={companyName}
                  onChange={setCompanyName}
                  placeholder="(주)회사명"
                />
                <InputField
                  label="대표자명"
                  value={ceoName}
                  onChange={setCeoName}
                  placeholder="홍길동"
                />
                <InputField
                  label="사업장 주소"
                  value={businessAddress}
                  onChange={setBusinessAddress}
                  placeholder="서울시 강남구 ..."
                />
                <InputField
                  label="업태 / 종목"
                  value={businessType}
                  onChange={setBusinessType}
                  placeholder="서비스업 / 마케팅"
                />
                <InputField
                  label="세금계산서 아이디(이메일)"
                  value={invoiceEmail}
                  onChange={setInvoiceEmail}
                  placeholder="예: tax@company.com"
                  type="email"
                />
              </div>
            )}
          </Card>

          {submissionError && (
            <Card className="bg-red-50 border-red-100 text-center space-y-2">
              <p className="text-sm font-medium text-red-600">
                {submissionError}
              </p>
              <p className="text-xs text-red-500">
                잠시 후 다시 시도해주세요
              </p>
            </Card>
          )}

          <button
            onClick={handleApplicationSubmit}
            disabled={submittingApplication}
            aria-disabled={submittingApplication || !isPaymentSubmitReady}
            className={`${getPrimaryActionButtonClass({
              theme: "rose",
              isInactive: submittingApplication || !isPaymentSubmitReady,
            })} py-4`}
          >
            {submittingApplication
              ? "신청 정보를 저장하고 있습니다..."
              : `신청 완료 (${totalPrice.toLocaleString()}원 입금 진행하기)`}
          </button>
        </div>
      </main>
      <ValidationToast
        message={validationToast}
        onClose={() => setValidationToast(null)}
        theme="rose"
      />
      </>
    );
  }

  /* ═══════════════ STATUS ═══════════════ */

  if (activeStep === "status") {
    const statusStages = ["접수됨", "입금 확인중", "진행중", "완료"];
    const currentStage = getApplicationStageIndexFromState({
      applicationStatus,
      paymentStatus: effectivePaymentStatus,
    });
    const totalPrice =
      getPrice(selectedPlan, selectedDuration) + getExpressFee(isExpress);

    return (
      <>
      <main className={wrapper}>
        <div className="max-w-2xl w-full space-y-6">
          <StepUtilityHeader
            onBack={() => goToStep("landing")}
            onHome={() => goToStep("landing")}
            onMyPage={() => router.push("/mypage")}
            progress={serviceFlowProgress}
          />
          {/* Hero */}
          <Card className="text-center space-y-3 py-8">
            <div className="w-16 h-16 bg-gradient-to-br from-rose-400 to-pink-500 rounded-full flex items-center justify-center mx-auto shadow-lg">
              <span className="text-white text-2xl">✓</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900">
              {isPaymentConfirmed
                ? "입금 확인이 완료되었습니다"
                : "신청이 접수되었습니다"}
            </h2>
            <p className="text-gray-500 text-sm">
              {isPaymentConfirmed
                ? "마케팅 준비가 진행중입니다"
                : "입금 확인 후 마케팅이 시작됩니다"}
            </p>
          </Card>

          {/* Payment instruction */}
          <Card className="space-y-4 border-rose-100 shadow-md">
            <div className="space-y-1">
              <SectionLabel>입금 안내</SectionLabel>
              <h3 className="text-xl font-bold text-gray-900">
                아래 계좌로 입금해주세요
              </h3>
              <p className="text-sm text-gray-500">
                아래 계좌로 입금해주시면 확인 후 마케팅이 시작됩니다
              </p>
              <p className="text-xs text-gray-500">
                신청 시 입력한 입금자명과 동일하게 입금해주세요
              </p>
            </div>

            <div className="rounded-2xl bg-gradient-to-r from-rose-500 to-pink-500 text-white px-5 py-4">
              <p className="text-xs font-semibold text-white/80 mb-1">
                입금 금액
              </p>
              <p className="text-3xl font-extrabold tracking-tight">
                {totalPrice.toLocaleString()}원
              </p>
            </div>

            <div className="rounded-xl bg-gray-50 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-400">은행명</span>
                <span className="text-sm font-semibold text-gray-900">
                  {BANK_TRANSFER_INFO.bankName}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-400">계좌번호</span>
                <span className="text-sm font-semibold text-gray-900">
                  {BANK_TRANSFER_INFO.accountNumber}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-gray-400">예금주</span>
                <span className="text-sm font-semibold text-gray-900">
                  {BANK_TRANSFER_INFO.accountHolder}
                </span>
              </div>
            </div>

            <button
              onClick={() =>
                handleCopy("status-account-number", BANK_TRANSFER_INFO.accountNumber)
              }
              className="w-full py-3 bg-gradient-to-r from-rose-500 to-pink-500 text-white font-semibold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all"
            >
              {copiedField === "status-account-number"
                ? "복사됨"
                : "계좌번호 복사"}
            </button>
          </Card>

          {/* Schedule summary */}
          <Card className="space-y-3">
            <SectionLabel>진행 안내</SectionLabel>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-gray-400">운영 기간</span>
                <span className="font-medium text-gray-900">
                  {selectedDuration === 1 ? "1개월 운영" : "2개월 운영"}
                </span>
              </div>
              {isExpress && completionDate ? (
                <div className="flex justify-between gap-3">
                  <span className="text-gray-400">급행 마무리 날짜</span>
                  <span className="font-medium text-gray-900">
                    {formatDateKorean(completionDate)}
                  </span>
                </div>
              ) : (
                <div className="flex justify-between gap-3">
                  <span className="text-gray-400">진행 방식</span>
                  <span className="font-medium text-gray-900">일반 진행</span>
                </div>
              )}
            </div>
          </Card>

          {/* Progress */}
          <Card>
            <SectionLabel>진행 상태</SectionLabel>
            <div className="grid grid-cols-4 gap-3 mt-2 items-start">
              {statusStages.map((label, i) => (
                <div key={i} className="relative flex flex-col items-center gap-1.5">
                  {i < statusStages.length - 1 && (
                    <div
                      className={`absolute top-4 left-1/2 w-full h-px ${
                        i < currentStage ? "bg-rose-500" : "bg-gray-200"
                      }`}
                    />
                  )}
                  <div className="relative z-10 flex flex-col items-center gap-1.5 bg-white px-1">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                        i === currentStage
                          ? "bg-gradient-to-r from-rose-500 to-pink-500 text-white ring-4 ring-rose-100"
                          : i < currentStage
                          ? "bg-rose-500 text-white"
                          : "bg-gray-100 text-gray-400"
                      }`}
                    >
                      {i < currentStage ? "✓" : i + 1}
                    </div>
                    <span
                      className={`text-[10px] text-center leading-tight ${
                        i <= currentStage
                          ? "text-gray-800 font-medium"
                          : "text-gray-400"
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {!isTestAccountAuthenticated && (
            <Card className="space-y-3">
              <SectionLabel>회원가입 안내</SectionLabel>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-gray-900">
                  {isAuthenticated
                    ? "회원가입이 완료되었습니다"
                    : "입금 후 회원가입을 진행해주세요"}
                </h3>
                <p className="text-sm text-gray-500">
                  {isAuthenticated
                    ? "이제 진행 상태 확인과 게시물 AI 생성 기능을 이용하실 수 있습니다"
                    : "회원가입을 완료하면 진행 상태 확인과 게시물 AI 생성 기능을 이용하실 수 있습니다"}
                </p>
                <p className="text-xs text-gray-500">
                  {isRequestLinked
                    ? "신청 시 입력한 아이디(이메일)와 연결되어 진행 정보가 자동으로 준비되었습니다"
                    : "신청 시 입력한 아이디(이메일)로 가입하시면 진행 정보가 더 자연스럽게 연결됩니다"}
                </p>
              </div>
            </Card>
          )}

          <div className="space-y-3">
            <button
              onClick={() => {
                if (isAuthenticated) {
                  router.push("/tools");
                  return;
                }

                handleSignupCta();
              }}
              className="w-full py-4 bg-gradient-to-r from-violet-500 to-purple-500 text-white font-semibold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all"
            >
              {isAuthenticated ? "게시물 AI 생성하러 가기" : "입금 후 회원가입하기"}
            </button>
            <button
              onClick={() => goToStep("landing")}
              className="w-full py-4 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              처음으로 돌아가기
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

  /* ═══════════════ POST SUBSCRIPTION PAYMENT ═══════════════ */

  if (activeStep === "postsub-payment") {
    return (
      <>
        <main className={wrapper}>
          <div className="max-w-2xl w-full space-y-6">
            <StepUtilityHeader
              onBack={() => navigateBack("postsub-payment")}
              onHome={() => goToStep("landing")}
              onMyPage={() => router.push("/mypage")}
              progress={serviceFlowProgress}
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
                    "postsub-account-number",
                    POST_SUBSCRIPTION_BANK_TRANSFER_INFO.accountNumber
                  )
                }
                className={`${getPrimaryActionButtonClass({
                  theme: "violet",
                })} py-3`}
              >
                {copiedField === "postsub-account-number"
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
                      onChange={(e) =>
                        setPostSubTaxInvoiceRequested(e.target.checked)
                      }
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

  /* ═══════════════ POST SUBSCRIPTION STATUS ═══════════════ */

  if (activeStep === "postsub-status") {
    return (
      <>
        <main className={wrapper}>
          <div className="max-w-2xl w-full space-y-6">
            <StepUtilityHeader
              onBack={() => navigateBack("postsub-status")}
              onHome={() => goToStep("landing")}
              onMyPage={() => router.push("/mypage")}
              progress={serviceFlowProgress}
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
                onClick={() => goToStep("postgen")}
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

  /* ═══════════════ POST GENERATION (SEPARATE) ═══════════════ */

  if (activeStep === "postgen") {
    return (
      <>
      <main className={wrapper}>
        <div className="max-w-2xl w-full space-y-6">
          <StepUtilityHeader
            onBack={() => navigateBack("postgen")}
            onHome={() => goToStep("landing")}
            onMyPage={() => router.push("/mypage")}
            progress={serviceFlowProgress}
          />

          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-2 bg-violet-50 text-violet-600 text-xs font-semibold px-4 py-1.5 rounded-full border border-violet-100">
              AI 콘텐츠 생성
            </div>
            <h2 className="text-2xl font-bold text-gray-900">
              게시물 AI 생성
            </h2>
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
                  <p className="text-xs font-semibold text-violet-500">
                    구독 상태
                  </p>
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
                  <p className="text-xs font-semibold text-violet-500">
                    오늘 남은 횟수
                  </p>
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
                          : () => openAuthPage("postgen")
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
                    onClick={() => goToStep("account-check")}
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
                    {hasActivePostGeneratorSubscription
                      ? `남은 생성 횟수: ${remainingSubscriptionCredits}회`
                      : hasConsumedFreeTrial
                        ? "월 구독 필요"
                        : "무료 체험 가능"}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-4">
                    <p className="text-xs font-semibold text-violet-500">
                      이번 달 사용 현황
                    </p>
                    <p className="mt-2 text-lg font-bold text-gray-900">
                      {hasActivePostGeneratorSubscription
                        ? `${POST_GENERATOR_MONTHLY_CREDITS - remainingSubscriptionCredits}회 사용 / ${POST_GENERATOR_MONTHLY_CREDITS}회 제공`
                        : hasConsumedFreeTrial
                          ? `월 ${formattedSubscriptionPrice}원 구독으로 ${POST_GENERATOR_MONTHLY_CREDITS}회`
                          : "무료 체험 1회 제공"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-4">
                    <p className="text-xs font-semibold text-violet-500">
                      오늘 남은 횟수
                    </p>
                    <p className="mt-2 text-lg font-bold text-gray-900">
                      {hasActivePostGeneratorSubscription
                        ? `${remainingDailyGenerations}회`
                        : `하루 최대 ${POST_GENERATOR_DAILY_LIMIT}회`}
                    </p>
                  </div>
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
                  <label
                    data-validation-field="postInput"
                    tabIndex={-1}
                    className={`flex flex-col items-center justify-center border-2 border-dashed rounded-2xl py-10 px-4 cursor-pointer transition-colors ${
                      postInputError
                        ? "border-violet-300 bg-violet-50/50"
                        : "border-gray-200 hover:border-violet-300 hover:bg-violet-50/30"
                    }`}
                  >
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
                        <label
                          data-validation-field="postInput"
                          tabIndex={-1}
                          className={`flex flex-col items-center justify-center border-2 border-dashed rounded-2xl px-4 cursor-pointer transition-colors aspect-square ${
                            postInputError
                              ? "border-violet-300 bg-violet-50/50"
                              : "border-gray-200 hover:border-violet-300 hover:bg-violet-50/30"
                          }`}
                        >
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
                {postInputError && (
                  <p className={getHelperTextClass("violet")}>{postInputError}</p>
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
                  onBlur={() => markFieldTouched("postInput")}
                  placeholder="예: 참고 이미지는 그대로 두고 더 감성적인 분위기로 만들어주세요. 20대 여성 대상의 따뜻한 홍보 게시물 느낌이면 좋겠어요."
                  rows={5}
                  error={postInputError}
                  fieldKey="postInput"
                  theme="violet"
                />
                <div className="rounded-xl bg-violet-50/60 border border-violet-100 px-4 py-3 space-y-1">
                  <p className="text-sm font-medium text-violet-700">
                    어떤 내용을 적으면 좋을까요?
                  </p>
                  <p className="text-xs text-violet-600 leading-relaxed">
                    원하는 분위기, 타깃 고객, 홍보 목적, 강조하고 싶은 문구를
                    자유롭게 적어주세요. AI가 정사각형 피드 이미지와 제목,
                    내용, 해시태그까지 한 번에 완성해드립니다.
                  </p>
                  <p className="text-xs text-violet-500">
                    업종이나 상품 정보가 없어도 설명만 입력하면 생성할 수 있습니다
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
                            onClick={() =>
                              handleCopy(`title-${postKey}`, post.title)
                            }
                            className="text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors"
                          >
                            {copiedField === `title-${postKey}` ? "복사됨" : "제목 복사"}
                          </button>
                        </div>
                        <p className="text-sm font-medium text-gray-800">
                          {post.title}
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-xs text-gray-400">내용</span>
                          <button
                            onClick={() =>
                              handleCopy(`content-${postKey}`, post.content)
                            }
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
                            onClick={() =>
                              handleCopy(`hashtags-${postKey}`, post.hashtags)
                            }
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
                        : () => openAuthPage("postgen")
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
                    onClick={() => goToStep("account-check")}
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

  return null;
}
