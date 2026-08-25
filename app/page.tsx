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
  isValidHttpUrl,
  isValidPlanSelection,
  type ApplicationValidationField,
  type ValidationIssue,
} from "@/lib/form-validation";
import {
  getSupabaseBrowserClientOrNull,
} from "@/lib/supabase/client";
import {
  compressImageToDataUrl,
  getAiErrorMessage,
  isRequestBodyTooLarge,
  readAiJsonResponse,
} from "@/lib/client/ai-request";
import { stripTrailingPunct } from "@/lib/text/korean";
import {
  addMonthsToKoreaDateString,
  getKoreaDateString,
  getRemainingSubscriptionCredits,
  isPostGeneratorSubscriptionActive,
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
  persistGrantedApplicationSubmission,
  persistGeneratedPost,
  startPostGeneratorSubscription,
  type SavedSubscription,
  type SavedGeneratedPost,
  syncProfileAndLinkData,
} from "@/lib/supabase/persistence";

/* ─── Types ─── */

type Step =
  | "landing"
  | "channel"
  | "account-check"
  | "input"
  | "result"
  | "names"
  | "confirm"
  | "channel-materials"
  | "payment"
  | "status"
  | "postgen"
  | "postsub-payment"
  | "postsub-status";

type MarketingChannel = "instagram" | "youtube";

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

const MARKETING_CHANNEL_OPTIONS: Array<{
  value: MarketingChannel;
  label: string;
  icon: string;
  description: string;
}> = [
  {
    value: "instagram",
    label: "인스타그램",
    icon: "📱",
    description:
      "제품을 '보는 순간 사고 싶게' 만드는 채널 (브랜드·감성·바이럴)",
  },
  {
    value: "youtube",
    label: "유튜브",
    icon: "▶",
    description:
      "제품을 '이해하고 신뢰하게' 만드는 채널 (설명·검색·신뢰)",
  },
];

const CHANNEL_COMPARISON_ROWS = [
  ["10~30대 비중이 높은 소비재", "전 연령 대상 서비스"],
  [
    "굿즈, 캐릭터, 뷰티, 패션, 카페, 음식",
    "B2B, B2G, SaaS, 교육, 의료, 제조",
  ],
  [
    "감성과 브랜드 이미지를 전달해야 하는 경우",
    "전문성과 신뢰를 전달해야 하는 경우",
  ],
  [
    "팬을 만들고 팔로워를 늘리고 싶은 경우",
    "서비스를 이해시키고 설득해야 하는 경우",
  ],
  ["충동구매가 많은 상품", "구매 결정까지 시간이 오래 걸리는 상품"],
  ["릴스 중심의 바이럴이 중요한 경우", "검색과 누적 조회가 중요한 경우"],
] as const;

const CHANNEL_MATERIAL_VALIDATION_FIELDS = new Set<HomeValidationField>([
  "marketingChannel",
  "channelUrl",
  "mainContentUrl",
]);

const CUSTOM_INDUSTRY_OPTION = "__custom__";

const INDUSTRY_OPTIONS = [
  "뷰티/패션",
  "카페/음식(F&B)",
  "굿즈/캐릭터",
  "교육/에듀테크",
  "IT/SaaS/정보통신",
  "의료/헬스케어",
  "제조",
  "로컬/소상공인",
  "B2B·B2G 서비스",
] as const;

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
  if (plan === 1 && duration === 2) return 600000;
  if (plan === 2 && duration === 1) return 550000;
  if (plan === 2 && duration === 2) return 1000000;
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

function isMarketingChannel(value?: string | null): value is MarketingChannel {
  return value === "instagram" || value === "youtube";
}

function normalizeInstagramHandle(handle?: string | null) {
  return (handle ?? "").trim().replace(/^@+/, "").replace(/\s+/g, "");
}

function buildInstagramPageUrl(handle?: string | null) {
  const normalizedHandle = normalizeInstagramHandle(handle);
  return normalizedHandle
    ? `https://www.instagram.com/${normalizedHandle}`
    : "";
}

function getResolvedChannelUrl(
  channel: MarketingChannel | "",
  instagramHandle: string,
  currentChannelUrl: string
) {
  if (channel === "instagram") {
    return buildInstagramPageUrl(instagramHandle);
  }

  return currentChannelUrl.trim();
}

function getIndustrySelectionFromValue(value?: string | null) {
  const normalized = value?.trim() ?? "";

  if (!normalized) {
    return "";
  }

  return (INDUSTRY_OPTIONS as readonly string[]).includes(normalized)
    ? normalized
    : CUSTOM_INDUSTRY_OPTION;
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
  step: Step
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

  const total = 6;

  if (step === "channel") {
    return { current: 1, total };
  }

  if (step === "account-check") {
    return { current: 2, total };
  }

  if (step === "input") {
    return { current: 3, total };
  }

  if (step === "result") {
    return { current: 4, total };
  }

  if (step === "names" || step === "confirm") {
    return { current: 4, total };
  }

  if (step === "channel-materials") {
    return { current: 5, total };
  }

  if (step === "payment" || step === "status") {
    return { current: total, total };
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
  readOnly = false,
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
  readOnly?: boolean;
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
        readOnly={readOnly}
        data-validation-field={fieldKey}
        aria-invalid={Boolean(error)}
        className={`${getTextFieldClass({
          theme,
          hasError: Boolean(error),
        })}${readOnly ? " bg-gray-50 text-gray-600 cursor-default" : ""}`}
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
            <a
              href="/pricing"
              className="text-xs font-medium text-violet-600 hover:text-violet-700 transition-colors border border-violet-100 rounded-full px-3 py-1.5 bg-violet-50"
            >
              가격 안내
            </a>
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
  const [marketingChannel, setMarketingChannel] = useState<MarketingChannel | "">(
    ""
  );
  const [channelUrl, setChannelUrl] = useState("");
  const [mainContentUrl, setMainContentUrl] = useState("");
  // 댓글 이벤트 포함 여부(기본 포함). 마케터 신청 시 사용자가 선택.
  const [commentsIncluded, setCommentsIncluded] = useState(true);

  // Input
  const [instagramId, setInstagramId] = useState("");
  const [industry, setIndustry] = useState("");
  const [industrySelection, setIndustrySelection] = useState("");
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
  const [marketerGrantState, setMarketerGrantState] = useState<
    | { status: "idle" }
    | { status: "none" }
    | { status: "ready"; marketerQuantity: number | null; marketerDuration: number | null }
  >({ status: "idle" });
  const [grantSubmitted, setGrantSubmitted] = useState(false);
  const [grantCheckDone, setGrantCheckDone] = useState(false);
  // null = check pending, "" = no application, "uuid" = existing application found
  const [existingApplicationId, setExistingApplicationId] = useState<string | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [hasTestAccess, setHasTestAccess] = useState(false);
  const [validationToast, setValidationToast] = useState<string | null>(null);
  const [touchedFields, setTouchedFields] = useState<
    Partial<Record<HomeValidationField, boolean>>
  >({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const _conceptOrDirection = stripTrailingPunct(
    aiResult?.accountPlan.concept || aiResult?.accountPlan.direction || ""
  );
  const suggestedPostPrompts = [
    `${industry || "브랜드"}의 첫 인사를 전하면서 ${productService || "서비스"}의 매력을 자연스럽게 소개하는 게시물로 만들어주세요.`,
    `${productService || "서비스"}를 처음 보는 사람이 한눈에 이해하고 관심을 가질 수 있는 홍보 게시물로 만들어주세요.`,
    _conceptOrDirection
      ? `${_conceptOrDirection} — 이 방향성을 살려 팔로우를 유도하는 게시물로 만들어주세요.`
      : `브랜드만의 분위기와 컨셉을 살려 팔로우를 유도하는 게시물로 만들어주세요.`,
  ].map((item) => item.replace(/\s+/g, " ").trim());

  const effectiveInstagramId = hasAccount ? instagramId : finalInstagramId;
  const isYoutubeChannel = marketingChannel === "youtube";
  const channelDisplayName = isYoutubeChannel ? "유튜브" : "인스타그램";
  const resolvedChannelUrl = getResolvedChannelUrl(
    marketingChannel,
    effectiveInstagramId,
    channelUrl
  );
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
  const canUseSubscriptionPostGeneration =
    hasActivePostGeneratorSubscription &&
    remainingSubscriptionCredits > 0;
  const canUseFreeTrial = !hasConsumedFreeTrial;
  const canGeneratePost = canUseSubscriptionPostGeneration || canUseFreeTrial;
  const shouldShowPostLock = !canGeneratePost;
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
    const hasRequiredChannelInput = isYoutubeChannel
      ? isValidHttpUrl(channelUrl)
      : hasAccount !== true || !!instagramId.trim();

    return (
      !!industry.trim() &&
      !!productService.trim() &&
      hasRequiredChannelInput
    );
  }

  function hasPlanningOutput() {
    return Boolean(aiResult?.accountPlan && hasPlanningInput());
  }

  function hasRecommendedNames() {
    return (
      marketingChannel === "instagram" &&
      !hasAccount &&
      Boolean(aiResult?.accountNames?.length)
    );
  }

  function hasPaymentPrerequisites() {
    if (!hasPlanningOutput()) {
      return false;
    }

    if (isYoutubeChannel) {
      return isValidHttpUrl(resolvedChannelUrl);
    }

    return !!effectiveInstagramId.trim();
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
        isMissing:
          marketingChannel === "instagram" &&
          Boolean(hasAccount) &&
          isBlank(instagramId),
      },
      {
        field: "channelUrl",
        message: "유튜브 채널 URL을 입력해주세요",
        isMissing: isYoutubeChannel && isBlank(channelUrl),
      },
      {
        field: "channelUrl",
        message: "유튜브 채널 URL은 http:// 또는 https://로 시작해야 합니다",
        isMissing:
          isYoutubeChannel && !isBlank(channelUrl) && !isValidHttpUrl(channelUrl),
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
      marketingChannel,
      channelUrl: resolvedChannelUrl,
      mainContentUrl,
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

  function getChannelMaterialsValidationIssues() {
    return getPaymentValidationIssues().filter((issue) =>
      CHANNEL_MATERIAL_VALIDATION_FIELDS.has(issue.field)
    );
  }

  function getPostGenerationValidationIssues() {
    return collectValidationIssues<HomeValidationField>([
      {
        field: "postInput",
        message: isSubscriptionCreditEmpty
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
  const channelMaterialsValidationIssues = getChannelMaterialsValidationIssues();
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
  const planningChannelUrlError = getFieldError(
    planningValidationIssues,
    "channelUrl",
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
  const marketingChannelError = getFieldError(
    channelMaterialsValidationIssues,
    "marketingChannel",
    touchedFields
  );
  const channelUrlError = getFieldError(
    channelMaterialsValidationIssues,
    "channelUrl",
    touchedFields
  );
  const mainContentUrlError = getFieldError(
    channelMaterialsValidationIssues,
    "mainContentUrl",
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
  const isChannelMaterialsReady = channelMaterialsValidationIssues.length === 0;
  const isPaymentSubmitReady = paymentValidationIssues.length === 0;
  const isPostGenerationReady = postGenerationValidationIssues.length === 0;
  const isPostSubscriptionPaymentReady =
    postSubscriptionPaymentValidationIssues.length === 0;
  const isAppliedCheckPending = isAuthenticated && existingApplicationId === null;
  const isAlreadyApplied = isAuthenticated && !!existingApplicationId;

  function getSafeStep(nextStep: Step): Step {
    switch (nextStep) {
      case "landing":
      case "channel":
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
        return marketingChannel ? "account-check" : "channel";
      case "input":
        if (!marketingChannel) return "channel";
        return hasAccount === null ? "account-check" : "input";
      case "result":
        if (!marketingChannel) return "channel";
        return hasAccount === null
          ? "account-check"
          : hasPlanningInput() || loading || aiError
            ? "result"
            : "input";
      case "names":
        if (!marketingChannel) return "channel";
        if (isYoutubeChannel) {
          return hasPlanningOutput() ? "channel-materials" : "input";
        }
        return hasRecommendedNames()
          ? "names"
          : hasPlanningOutput()
            ? "result"
            : hasAccount === null
              ? "account-check"
              : "input";
      case "confirm":
        if (!marketingChannel) return "channel";
        if (isYoutubeChannel) {
          return hasPlanningOutput() ? "channel-materials" : "input";
        }
        return hasRecommendedNames()
          ? "confirm"
          : hasPlanningOutput()
            ? "result"
            : hasAccount === null
              ? "account-check"
              : "input";
      case "channel-materials":
        if (!marketingChannel) return "channel";
        if (hasPaymentPrerequisites()) return "channel-materials";
        if (hasRecommendedNames() && !hasAccount) return "confirm";
        if (hasPlanningOutput()) return "result";
        return hasAccount === null ? "account-check" : "input";
      case "payment":
        if (hasPaymentPrerequisites() && isChannelMaterialsReady) return "payment";
        if (hasPaymentPrerequisites()) return "channel-materials";
        if (hasRecommendedNames() && !hasAccount) return "confirm";
        if (hasPlanningOutput()) return "result";
        return hasAccount === null ? "account-check" : "input";
      case "status":
        if (hasSubmittedApplication()) return "status";
        if (hasPaymentPrerequisites() && isChannelMaterialsReady) return "payment";
        if (hasPaymentPrerequisites()) return "channel-materials";
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
      case "channel":
        return "landing";
      case "account-check":
        return "channel";
      case "input":
        return "account-check";
      case "result":
        return "input";
      case "names":
        return "result";
      case "confirm":
        return "names";
      case "channel-materials":
        return hasAccount || isYoutubeChannel ? "result" : "confirm";
      case "payment":
        return "channel-materials";
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

  function moveToChannelMaterials(nextInstagramId?: string) {
    const issues = [
      ...getResultStepValidationIssues(),
      ...(marketingChannel === "instagram" && !hasAccount
        ? getConfirmValidationIssues(nextInstagramId)
        : []),
    ];

    if (!surfaceValidationIssues(issues)) {
      return;
    }

    if (typeof nextInstagramId === "string") {
      setFinalInstagramId(nextInstagramId);
    }

    if (marketingChannel === "instagram") {
      setChannelUrl(
        buildInstagramPageUrl(
          typeof nextInstagramId === "string" ? nextInstagramId : effectiveInstagramId
        )
      );
    }

    if (isExpress && !completionDate) {
      setCompletionDate(getDefaultCompletionDate(selectedDuration));
    }

    goToStep("channel-materials");
  }

  function handleResultNext() {
    if (!surfaceValidationIssues(resultValidationIssues)) {
      return;
    }

    if (hasAccount || isYoutubeChannel) {
      moveToChannelMaterials(isYoutubeChannel ? undefined : instagramId);
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

  function handleChannelMaterialsNext() {
    if (!surfaceValidationIssues(channelMaterialsValidationIssues)) {
      return;
    }

    goToStep("payment");
  }

  const activeStep = hasHydrated ? getSafeStep(step) : step;
  const serviceFlowProgress = getServiceFlowProgress(activeStep);

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
          industrySelection?: string;
          productService?: string;
          marketingChannel?: string;
          channelUrl?: string;
          mainContentUrl?: string;
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
        setIndustrySelection(
          parsed.industrySelection === CUSTOM_INDUSTRY_OPTION ||
            (INDUSTRY_OPTIONS as readonly string[]).includes(
              parsed.industrySelection ?? ""
            )
            ? parsed.industrySelection ?? ""
            : getIndustrySelectionFromValue(parsed.industry)
        );
        setProductService(parsed.productService ?? "");
        setMarketingChannel(
          isMarketingChannel(parsed.marketingChannel)
            ? parsed.marketingChannel
            : ""
        );
        setChannelUrl(parsed.channelUrl ?? "");
        setMainContentUrl(parsed.mainContentUrl ?? "");
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
        industrySelection,
        productService,
        marketingChannel,
        channelUrl,
        mainContentUrl,
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
    industrySelection,
    productService,
    marketingChannel,
    channelUrl,
    mainContentUrl,
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
        requestEmail: user.email ?? "",
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
      (isYoutubeChannel
        ? isValidHttpUrl(channelUrl)
        : hasAccount !== true || !!instagramId.trim());
    const hasOutput = Boolean(aiResult?.accountPlan && hasInput);
    const hasNames =
      marketingChannel === "instagram" &&
      !hasAccount &&
      Boolean(aiResult?.accountNames?.length);
    const hasInstagramHandle = !!effectiveInstagramId.trim();
    const hasPaymentReady =
      hasOutput &&
      (isYoutubeChannel ? isValidHttpUrl(resolvedChannelUrl) : hasInstagramHandle);
    const hasChannelMaterialsReady =
      isMarketingChannel(marketingChannel) &&
      isValidHttpUrl(resolvedChannelUrl) &&
      isValidHttpUrl(mainContentUrl);
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
      else if (hasPaymentReady && hasChannelMaterialsReady)
        resolvedStep = "payment";
      else if (hasPaymentReady) resolvedStep = "channel-materials";
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
    isYoutubeChannel,
    marketingChannel,
    channelUrl,
    resolvedChannelUrl,
    mainContentUrl,
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
      const data = await readAiJsonResponse(res);

      if (!res.ok) {
        throw new Error(getAiErrorMessage(res, data, "AI 생성에 실패했습니다."));
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

    Promise.all(files.map((file) => compressImageToDataUrl(file)))
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
      const requestBody = JSON.stringify({
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
        marketingChannel,
        requestId: crypto.randomUUID(),
        previousPost: latestPostContext
          ? {
              title: latestPostContext.title,
              content: latestPostContext.content,
              hashtags: latestPostContext.hashtags,
            }
          : null,
      });

      if (isRequestBodyTooLarge(requestBody)) {
        throw new Error(
          "업로드한 이미지 용량이 너무 큽니다. 더 작은 이미지로 다시 시도해주세요."
        );
      }

      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });
      const data = await readAiJsonResponse(res);

      if (!res.ok) {
        throw new Error(getAiErrorMessage(res, data, "게시물 생성에 실패했습니다."));
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

  // ── Marketer grant detection ──────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated || !userId) {
      setMarketerGrantState({ status: "none" });
      return;
    }

    const supabase = getSupabaseBrowserClientOrNull();
    if (!supabase) {
      setMarketerGrantState({ status: "none" });
      return;
    }

    let active = true;

    void (async () => {
      const { data: rawGrant } = await (
        supabase
          .from("service_grants")
          .select("ai_marketer, marketer_quantity, marketer_months")
          .maybeSingle() as unknown as Promise<{
            data: {
              ai_marketer: boolean;
              marketer_quantity: number | null;
              marketer_months: string | null;
            } | null;
          }>
      );
      if (!active) return;

      if (!rawGrant || !rawGrant.ai_marketer) {
        setMarketerGrantState({ status: "none" });
        return;
      }

      const monthsCount = rawGrant.marketer_months
        ? rawGrant.marketer_months.split(",").filter((s) => s.trim()).length
        : null;

      setMarketerGrantState({
        status: "ready",
        marketerQuantity: rawGrant.marketer_quantity ?? null,
        marketerDuration: monthsCount && monthsCount > 0 ? monthsCount : null,
      });
    })();

    return () => {
      active = false;
    };
  }, [isAuthenticated, userId]);

  // ── Existing-application check: block re-entry into the editable flow ──────
  // Runs once per auth session. Sets existingApplicationId to "" (none) or a UUID.
  useEffect(() => {
    if (!isAuthenticated) {
      setExistingApplicationId(null);
      return;
    }

    const supabase = getSupabaseBrowserClientOrNull();
    if (!supabase) {
      setExistingApplicationId("");
      return;
    }

    let active = true;
    void (async () => {
      type AppRow = { id: string };
      let existing: AppRow | null = null;

      if (userId) {
        const { data } = await (
          supabase
            .from("applications")
            .select("id")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle() as unknown as Promise<{ data: AppRow | null }>
        );
        existing = data;
      }

      if (!existing && authEmail) {
        const { data } = await (
          supabase
            .from("applications")
            .select("id")
            .ilike("email", authEmail.trim().toLowerCase())
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle() as unknown as Promise<{ data: AppRow | null }>
        );
        existing = data;
      }

      if (!active) return;
      setExistingApplicationId(existing?.id ?? "");
    })();

    return () => {
      active = false;
    };
  }, [isAuthenticated, userId, authEmail]);

  // ── Pre-check: look up existing grant application on entering payment step ─
  // Prevents duplicate submission and shows completion screen immediately on
  // refresh. Runs once per (step, grant-status) combination.
  useEffect(() => {
    if (activeStep !== "payment") return;
    if (marketerGrantState.status !== "ready") return;
    if (grantCheckDone) return;

    const supabase = getSupabaseBrowserClientOrNull();
    if (!supabase) {
      setGrantCheckDone(true);
      return;
    }

    let active = true;
    void (async () => {
      type AppRow = { id: string; main_content_url: string | null };
      let existing: AppRow | null = null;

      if (userId) {
        const { data } = await (
          supabase
            .from("applications")
            .select("id, main_content_url")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle() as unknown as Promise<{ data: AppRow | null }>
        );
        existing = data;
      }

      if (!existing && email) {
        const { data } = await (
          supabase
            .from("applications")
            .select("id, main_content_url")
            .ilike("email", email.trim().toLowerCase())
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle() as unknown as Promise<{ data: AppRow | null }>
        );
        existing = data;
      }

      if (!active) return;

      if (existing?.main_content_url) {
        setApplicationId(existing.id);
        setGrantSubmitted(true);
      }
      setGrantCheckDone(true);
    })();

    return () => {
      active = false;
    };
  }, [activeStep, marketerGrantState.status, grantCheckDone, userId, email]);

  // ── Auto-submit for granted marketer users at the payment step ───────────
  // Only fires after pre-check confirms no existing submission.
  useEffect(() => {
    if (activeStep !== "payment") return;
    if (marketerGrantState.status !== "ready") return;
    if (!grantCheckDone) return;
    if (grantSubmitted || submittingApplication) return;

    void handleGrantedApplicationSubmit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep, marketerGrantState.status, grantCheckDone, grantSubmitted]);

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
        mode: "monthly_start",
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

  async function handleGrantedApplicationSubmit() {
    if (submittingApplication || grantSubmitted) return;
    if (marketerGrantState.status !== "ready") return;

    setSubmittingApplication(true);
    setSubmissionError(null);

    try {
      const result = await persistGrantedApplicationSubmission({
        userId: isTestAccountAuthenticated ? null : userId || null,
        sessionEmail: isTestAccountAuthenticated ? null : authEmail || null,
        email,
        instagramId: isYoutubeChannel ? "" : effectiveInstagramId.trim(),
        industry,
        productService,
        marketingChannel,
        channelUrl: resolvedChannelUrl,
        mainContentUrl,
        commentsIncluded,
        accountDirection: aiResult?.accountPlan.direction,
        accountBio: aiResult?.accountPlan.bio,
        accountConcept: aiResult?.accountPlan.concept,
        managerName,
        phone,
        marketerQuantity: marketerGrantState.marketerQuantity,
        marketerDuration: marketerGrantState.marketerDuration,
      });

      if (result.error) {
        throw new Error(result.error);
      }

      setApplicationId(result.applicationId ?? "");
      setExistingApplicationId(result.applicationId ?? "x");
      setGrantSubmitted(true);
      setSubmissionError(null);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "신청 정보를 저장하지 못했습니다. 다시 시도해주세요.";
      setSubmissionError(message);
    } finally {
      setSubmittingApplication(false);
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
        sessionEmail: isTestAccountAuthenticated ? null : authEmail || null,
        email,
        instagramId: isYoutubeChannel ? "" : effectiveInstagramId.trim(),
        hasAccount: Boolean(hasAccount),
        industry,
        productService,
        marketingChannel,
        channelUrl: resolvedChannelUrl,
        mainContentUrl,
        commentsIncluded,
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
      setExistingApplicationId(result.applicationId ?? "x");
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
                onClick={() => goToStep("channel")}
                className="group text-left p-6 rounded-2xl bg-white border-2 border-gray-100 hover:border-rose-300 hover:shadow-lg active:scale-[0.99] transition-all"
              >
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center text-white text-xl flex-shrink-0">
                    🤖
                  </div>
                  <div className="space-y-1">
                    <p className="font-bold text-gray-900 text-lg group-hover:text-rose-600 transition-colors">
                      AI 마케터
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
                        게시물 AI 생성기
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

  /* ═══════════════ ALREADY-APPLIED GUARD ═══════════════ */
  // Covers channel → channel-materials + payment. Bypassed when the grant
  // completion screen is already showing (grantSubmitted = true), since the
  // grant pre-check handles that case independently.

  const isMarketerFormStep = (
    activeStep === "channel" ||
    activeStep === "account-check" ||
    activeStep === "input" ||
    activeStep === "result" ||
    activeStep === "names" ||
    activeStep === "confirm" ||
    activeStep === "channel-materials" ||
    activeStep === "payment"
  );

  if (isMarketerFormStep && !grantSubmitted && isAppliedCheckPending) {
    return (
      <main className={wrapper}>
        <div className="max-w-2xl w-full flex justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-rose-500" />
        </div>
      </main>
    );
  }

  if (isMarketerFormStep && !grantSubmitted && isAlreadyApplied) {
    return (
      <main className={wrapper}>
        <div className="max-w-2xl w-full space-y-6">
          <StepUtilityHeader
            onBack={() => goToStep("landing")}
            onHome={() => goToStep("landing")}
            onMyPage={() => router.push("/mypage")}
            progress={serviceFlowProgress}
          />
          <Card className="space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="font-bold text-gray-900">AI 마케터 신청 완료</p>
                <p className="text-sm text-gray-500">이미 신청이 접수되어 있습니다</p>
              </div>
            </div>
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex gap-2.5">
              <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 110 18A9 9 0 0112 3z" />
              </svg>
              <p className="text-sm text-amber-800">
                제출한 정보는 직접 변경할 수 없습니다. 변경이 필요하신 경우 1:1 문의로 요청해 주세요.
              </p>
            </div>
            <button
              onClick={() => router.push("/mypage")}
              className="w-full bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-semibold rounded-2xl py-4 shadow-md hover:shadow-lg active:scale-[0.98] transition-all"
            >
              마이페이지에서 현황 보기
            </button>
          </Card>
        </div>
      </main>
    );
  }

  /* ═══════════════ CHANNEL SELECTION ═══════════════ */

  if (activeStep === "channel") {
    return (
      <>
        <main className={wrapper}>
          <div className="max-w-3xl w-full space-y-6">
            <StepUtilityHeader
              onBack={() => navigateBack("channel")}
              onHome={() => goToStep("landing")}
              onMyPage={() => router.push("/mypage")}
              progress={serviceFlowProgress}
            />

            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-gray-900">
                어떤 채널로 마케팅할까요?
              </h2>
              <p className="text-sm text-gray-500">
                운영 중인 계정이 있다면 마케팅을 진행할 계정을 선택해 주세요.
                <br />
                <br />
                아직 계정이 없다면 계정명 추천부터 도와드리며,
                <br />
                동일한 목표 기준으로 운영해드립니다.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {MARKETING_CHANNEL_OPTIONS.map((option) => {
                const isSelected = marketingChannel === option.value;
                const isYoutube = option.value === "youtube";

                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setMarketingChannel(option.value);
                      markFieldTouched("marketingChannel");
                    }}
                    onBlur={() => markFieldTouched("marketingChannel")}
                    data-validation-field={
                      option.value === "instagram"
                        ? "marketingChannel"
                        : undefined
                    }
                    className={`text-left p-6 rounded-2xl border-2 transition-all active:scale-[0.99] ${
                      isSelected
                        ? "border-rose-500 bg-rose-50/50 shadow-md"
                        : marketingChannelError
                          ? "border-rose-300 bg-rose-50/40"
                          : "border-gray-100 bg-white hover:border-rose-300 hover:shadow-lg"
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-400 to-pink-500 flex items-center justify-center text-white text-xl flex-shrink-0">
                        {option.icon}
                      </div>
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-bold text-gray-900 text-lg">
                            {option.label}
                          </p>
                          {isYoutube && (
                            <span className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                              추천
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500 leading-relaxed">
                          {option.description}
                        </p>
                        {isYoutube ? (
                          <p className="text-xs leading-relaxed text-blue-600">
                            검색 노출과 누적 조회 효과가 높고 장기적인 AI 운영 효율이
                            우수하여 기본 추천 채널입니다.
                          </p>
                        ) : (
                          <p className="text-xs leading-relaxed text-rose-600">
                            브랜드 인지도, 릴스 바이럴, 팔로워 확보, 감성 중심 제품에
                            특히 적합합니다.
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {marketingChannelError && (
              <p className={`text-center ${getHelperTextClass("rose")}`}>
                {marketingChannelError}
              </p>
            )}

            <Card className="space-y-4 border-emerald-100">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                  >
                    <path d="M3 3v18h18" />
                    <path d="m7 15 4-4 3 3 5-6" />
                    <path d="M18 8h1v1" />
                  </svg>
                </span>
                <div>
                  <p className="text-base font-semibold text-gray-900">
                    예상 성과 범위
                  </p>
                  <p className="text-sm text-gray-500">
                    AI 마케터 1명 · 1개월 운영 기준
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-emerald-100 bg-white p-4 space-y-4">
                  <p className="text-sm font-semibold text-gray-900">
                    인스타그램 예상 성과
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-emerald-50 px-3 py-3 text-center">
                      <p className="text-2xl font-extrabold text-emerald-700">
                        +500
                      </p>
                      <p className="text-xs font-medium text-emerald-800">팔로워</p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 px-3 py-3 text-center">
                      <p className="text-2xl font-extrabold text-emerald-700">
                        +100
                      </p>
                      <p className="text-xs font-medium text-emerald-800">좋아요</p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 px-3 py-3 text-center">
                      <p className="text-2xl font-extrabold text-emerald-700">
                        +30
                      </p>
                      <p className="text-xs font-medium text-emerald-800">댓글</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {["팔로워 +500명", "좋아요 100개 이상", "댓글 30개 이상"].map(
                      (item) => (
                        <div key={item} className="flex items-start gap-2.5">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="mt-0.5 h-[18px] w-[18px] shrink-0 text-emerald-600"
                          >
                            <path d="m20 6-11 11-5-5" />
                          </svg>
                          <p className="text-sm leading-relaxed text-gray-800">
                            {item}
                          </p>
                        </div>
                      )
                    )}
                  </div>
                  <div className="rounded-xl border border-amber-100 bg-amber-50 p-3">
                    <div className="flex items-start gap-2.5">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="mt-0.5 h-[18px] w-[18px] shrink-0 text-amber-600"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="8" x2="12" y2="12" />
                        <line x1="12" y1="16" x2="12.01" y2="16" />
                      </svg>
                      <p className="text-sm leading-relaxed text-amber-800">
                        ※ 좋아요와 댓글은 플랫폼 특성상 보장되지 않습니다.
                        <br />
                        목표에 도달하지 못할 경우, 대신 팔로워를 약 50명을 추가 확보하여
                        총 팔로워 550명 이상 달성을 목표로 운영합니다.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-100 bg-white p-4 space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900">
                      유튜브 예상 성과
                    </p>
                    <span className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                      추천
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-emerald-50 px-3 py-3 text-center">
                      <p className="text-2xl font-extrabold text-emerald-700">
                        +200
                      </p>
                      <p className="text-xs font-medium text-emerald-800">구독자</p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 px-3 py-3 text-center">
                      <p className="text-2xl font-extrabold text-emerald-700">
                        +1,000
                      </p>
                      <p className="text-xs font-medium text-emerald-800">조회수</p>
                    </div>
                    <div className="rounded-xl bg-emerald-50 px-3 py-3 text-center">
                      <p className="text-2xl font-extrabold text-emerald-700">
                        +10
                      </p>
                      <p className="text-xs font-medium text-emerald-800">댓글</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-2.5">
                    {["구독자 +200명", "조회수 1,000회 이상", "댓글 10개 이상"].map(
                      (item) => (
                        <div key={item} className="flex items-start gap-2.5">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="mt-0.5 h-[18px] w-[18px] shrink-0 text-emerald-600"
                          >
                            <path d="m20 6-11 11-5-5" />
                          </svg>
                          <p className="text-sm leading-relaxed text-gray-800">
                            {item}
                          </p>
                        </div>
                      )
                    )}
                  </div>
                  <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                    <div className="flex items-start gap-2.5">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="mt-0.5 h-[18px] w-[18px] shrink-0 text-blue-600"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="16" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          💡 왜 추천인가요?
                        </p>
                        <p className="mt-1 text-sm leading-relaxed text-gray-700">
                          유튜브는 구독자 증가 속도는 인스타그램보다 느리지만,
                          검색과 추천을 통해 콘텐츠가 장기간 노출됩니다. 초기
                          수치보다 장기적인 조회수, 신뢰 형성, 문의 전환에 강점이
                          있어 대부분의 업종에 추천드립니다.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                <div className="flex items-start gap-2.5">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mt-0.5 h-[18px] w-[18px] shrink-0 text-blue-600"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">성과 안내</p>
                    <p className="mt-1 text-sm leading-relaxed text-gray-700">
                      ※ 위 성과는 AI 마케터 1명 · 1개월 운영 기준입니다.
                      <br />
                      AI 마케터 인원 또는 운영 기간이 늘어나면 추가 혜택을 드립니다.
                    </p>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="space-y-4">
              <div>
                <SectionLabel>내 사업에 적합한 채널 비교</SectionLabel>
                <p className="mt-2 text-sm leading-relaxed text-gray-500">
                  아래 특징을 참고하여 내 사업에 더 적합한 채널을 선택해 주세요.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl bg-rose-50 px-4 py-3">
                  <p className="font-semibold text-rose-600">
                    인스타그램에 적합한 경우
                  </p>
                </div>
                <div className="rounded-2xl bg-blue-50 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-blue-700">
                      유튜브에 적합한 경우
                    </p>
                    <span className="rounded-md bg-white px-2.5 py-1 text-xs font-medium text-blue-700">
                      추천
                    </span>
                  </div>
                </div>
                <div className="rounded-xl border border-rose-100 bg-white px-4 py-3 text-gray-700 leading-relaxed">
                  <p className="mb-1 text-xs font-semibold text-rose-500">주요 타겟</p>
                  10~30대 비중이 높은 소비재
                </div>
                <div className="rounded-xl border border-blue-100 bg-white px-4 py-3 text-gray-700 leading-relaxed">
                  <p className="mb-1 text-xs font-semibold text-blue-600">주요 타겟</p>
                  전 연령 대상 서비스
                </div>
                <div className="rounded-xl border border-rose-100 bg-white px-4 py-3 text-gray-700 leading-relaxed">
                  <p className="mb-1 text-xs font-semibold text-rose-500">대표 업종</p>
                  굿즈, 캐릭터, 뷰티, 패션, 카페, 음식
                </div>
                <div className="rounded-xl border border-blue-100 bg-white px-4 py-3 text-gray-700 leading-relaxed">
                  <p className="mb-1 text-xs font-semibold text-blue-600">대표 업종</p>
                  B2B, B2G, SaaS, 교육, 의료, 제조
                </div>
                {CHANNEL_COMPARISON_ROWS.slice(2).map(
                  ([instagramText, youtubeText]) => (
                    <div key={instagramText} className="contents">
                      <div className="rounded-xl border border-rose-100 bg-white px-4 py-3 text-gray-700 leading-relaxed">
                        <p className="mb-1 text-xs font-semibold text-rose-500">
                          추천 상황
                        </p>
                        {instagramText}
                      </div>
                      <div className="rounded-xl border border-blue-100 bg-white px-4 py-3 text-gray-700 leading-relaxed">
                        <p className="mb-1 text-xs font-semibold text-blue-600">
                          추천 상황
                        </p>
                        {youtubeText}
                      </div>
                    </div>
                  )
                )}
              </div>
            </Card>

            <button
              type="button"
              onClick={() => goToStep("account-check")}
              disabled={!marketingChannel}
              aria-disabled={!marketingChannel}
              className={`${getPrimaryActionButtonClass({
                theme: "rose",
                isInactive: !marketingChannel,
              })} py-4`}
            >
              다음
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

  /* ═══════════════ ACCOUNT CHECK ═══════════════ */

  if (activeStep === "account-check") {
    const selectedChannelIcon = isYoutubeChannel ? "▶" : "📱";
    const selectedChannelLabel = isYoutubeChannel ? "유튜브" : "인스타그램";
    const accountCheckTitle = isYoutubeChannel
      ? "유튜브 채널이 있으신가요?"
      : "인스타그램 계정이 있으신가요?";
    const accountCheckSubtitle = isYoutubeChannel
      ? "유튜브 채널 보유 여부에 따라"
      : "인스타그램 계정 보유 여부에 따라";

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
            <div className="inline-flex items-center gap-2 rounded-full border border-rose-100 bg-white px-3 py-1.5 text-xs font-medium text-rose-600">
              <span className="text-gray-400">현재 선택</span>
              <span>
                {selectedChannelIcon} {selectedChannelLabel}
              </span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900">
              {accountCheckTitle}
            </h2>
            <p className="text-sm text-gray-500">
              {accountCheckSubtitle}
              <br />
              맞춤 설정을 진행합니다.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => {
                setHasAccount(true);
                setStep("input");
              }}
              className="p-6 rounded-2xl bg-gradient-to-r from-rose-500 to-pink-500 text-white font-semibold shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all space-y-1"
            >
              <div className="text-2xl">✅</div>
              <div className="font-semibold">계정이 있어요</div>
              <div className="text-sm text-white/80">기존 계정으로 시작</div>
            </button>
            <button
              onClick={() => {
                setHasAccount(false);
                setStep("input");
              }}
              className="p-6 rounded-2xl border-2 border-gray-200 bg-white text-gray-700 font-semibold hover:border-gray-300 hover:shadow-md active:scale-[0.98] transition-all space-y-1"
            >
              <div className="text-2xl">🪄</div>
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
              {isYoutubeChannel ? (
                <InputField
                  label="유튜브 채널 (URL)"
                  value={channelUrl}
                  onChange={setChannelUrl}
                  onBlur={() => markFieldTouched("channelUrl")}
                  placeholder="https://www.youtube.com/@our_brand"
                  type="url"
                  required
                  error={planningChannelUrlError}
                  fieldKey="channelUrl"
                />
              ) : (
                hasAccount && (
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
                )
              )}

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-gray-700">
                  업종
                  <span className="text-rose-500 ml-0.5">*</span>
                </label>
                <select
                  value={industrySelection}
                  onChange={(event) => {
                    const nextSelection = event.target.value;
                    setIndustrySelection(nextSelection);
                    setIndustry(
                      nextSelection === CUSTOM_INDUSTRY_OPTION
                        ? ""
                        : nextSelection
                    );
                  }}
                  onBlur={() => markFieldTouched("industry")}
                  data-validation-field="industry"
                  aria-invalid={Boolean(
                    industryError && industrySelection !== CUSTOM_INDUSTRY_OPTION
                  )}
                  className={getTextFieldClass({
                    theme: "rose",
                    hasError:
                      Boolean(industryError) &&
                      industrySelection !== CUSTOM_INDUSTRY_OPTION,
                  })}
                >
                  <option value="">업종을 선택해주세요</option>
                  {INDUSTRY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                  <option value={CUSTOM_INDUSTRY_OPTION}>
                    기타(직접 입력)
                  </option>
                </select>
                {industryError &&
                  industrySelection !== CUSTOM_INDUSTRY_OPTION && (
                    <p className={getHelperTextClass("rose")}>
                      {industryError}
                    </p>
                  )}
              </div>

              {industrySelection === CUSTOM_INDUSTRY_OPTION && (
                <InputField
                  label="업종 직접 입력"
                  value={industry}
                  onChange={setIndustry}
                  onBlur={() => markFieldTouched("industry")}
                  placeholder="예: 반려동물 용품"
                  required
                  error={industryError}
                  fieldKey="industry"
                />
              )}
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
              아래 전략을 바탕으로 {channelDisplayName}를 운영해 보세요
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

          {/* 운영 안내 박스 — Tailwind v4, 아이콘 라이브러리 불필요(인라인 SVG), info(blue) 톤 */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                >
                  <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                  <path d="M12 11h4" />
                  <path d="M12 16h4" />
                  <path d="M8 11h.01" />
                  <path d="M8 16h.01" />
                </svg>
              </span>
              <div>
                <p className="text-base font-semibold text-gray-900">
                  운영 안내
                </p>
                <p className="text-sm text-gray-500">
                  AI 마케터 서비스 이용 전 확인해 주세요
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2.5">
              <div className="flex items-start gap-2.5">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gray-400"
                >
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <p className="text-sm leading-relaxed text-gray-800">
                  본 기획안을 바탕으로{" "}
                  <span className="font-semibold">월 1~2회</span> 게시물
                  업로드를 권장드립니다.
                </p>
              </div>
              <div className="flex items-start gap-2.5">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gray-400"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <p className="text-sm leading-relaxed text-gray-800">
                  AI 마케터는 콘텐츠 기획 및 마케팅 전략을 지원하는
                  서비스이며,{" "}
                  <span className="text-gray-500">
                    게시물 업로드는 직접 진행
                  </span>
                  해 주셔야 합니다.
                </p>
              </div>
              <div className="flex items-start gap-2.5">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gray-400"
                >
                  <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                </svg>
                <p className="text-sm leading-relaxed text-gray-800">
                  직접 운영이 어려우신 경우, 콘텐츠 제작 및 업로드를 포함한{" "}
                  <span className="font-semibold">운영 대행 서비스</span>를
                  별도로 신청하실 수 있습니다.
                </p>
              </div>
              <div className="flex items-start gap-2.5">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mt-0.5 h-[18px] w-[18px] shrink-0 text-blue-600"
                >
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
                <p className="text-sm leading-relaxed text-gray-800">
                  비즈니스 문의:{" "}
                  <a
                    href="mailto:ceo.qmeet@gmail.com"
                    className="font-medium text-blue-600 hover:underline"
                  >
                    ceo.qmeet@gmail.com
                  </a>
                </p>
              </div>
            </div>
          </div>

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
                moveToChannelMaterials(finalInstagramId.trim());
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

  /* ═══════════════ CHANNEL MATERIALS ═══════════════ */

  if (activeStep === "channel-materials") {
    const isInstagramChannel = marketingChannel === "instagram";
    const channelUrlLabel = isInstagramChannel
      ? "인스타그램 페이지 (URL)"
      : "유튜브 채널 (URL)";
    const mainContentUrlLabel = isInstagramChannel
      ? "대표 게시물 (URL)"
      : "대표 영상 (URL)";
    const representativeContentLabel = isInstagramChannel
      ? "대표 게시물"
      : "대표 영상";
    const mainContentHelp = isInstagramChannel
      ? "대표님의 아이템 소개를 담은, 대표적으로 홍보하고 싶은 게시물 1개"
      : "대표님의 아이템 소개를 담은, 대표적으로 홍보하고 싶은 영상 1개";

    return (
      <>
        <main className={wrapper}>
          <div className="max-w-xl w-full space-y-6">
            <StepUtilityHeader
              onBack={() => navigateBack("channel-materials")}
              onHome={() => goToStep("landing")}
              onMyPage={() => router.push("/mypage")}
              progress={serviceFlowProgress}
            />

            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-gray-900">
                대표 URL을 알려주세요
              </h2>
              <p className="text-sm text-gray-500">
                AI 마케터가 홍보에 활용할 기준 콘텐츠를 확인합니다
              </p>
            </div>

            <Card className="space-y-5">
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-rose-50 px-4 py-3">
                <span className="text-sm font-semibold text-rose-600">
                  선택 채널
                </span>
                <span className="text-sm font-bold text-gray-900">
                  {isInstagramChannel ? "인스타그램" : "유튜브"}
                </span>
              </div>

              <InputField
                label={channelUrlLabel}
                value={resolvedChannelUrl}
                onChange={() => undefined}
                onBlur={() => markFieldTouched("channelUrl")}
                placeholder={
                  isInstagramChannel
                    ? "https://www.instagram.com/our_brand"
                    : "https://www.youtube.com/@our_brand"
                }
                type="url"
                required
                error={channelUrlError}
                fieldKey="channelUrl"
                readOnly
              />

              <div className="space-y-1.5">
                <InputField
                  label={mainContentUrlLabel}
                  value={mainContentUrl}
                  onChange={setMainContentUrl}
                  onBlur={() => markFieldTouched("mainContentUrl")}
                  placeholder={
                    isInstagramChannel
                      ? "https://www.instagram.com/p/..."
                      : "https://www.youtube.com/watch?v=..."
                  }
                  type="url"
                  required
                  error={mainContentUrlError}
                  fieldKey="mainContentUrl"
                />
                <p className="text-xs text-gray-500 leading-relaxed">
                  {mainContentHelp}
                </p>
              </div>
            </Card>

            {/* 댓글 이벤트 포함/미포함 선택 */}
            <Card className="space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-gray-900">댓글 이벤트</p>
                <p className="text-xs leading-relaxed text-gray-500">
                  댓글은 <span className="font-semibold">하루 이벤트</span>로
                  진행됩니다. 실제로는 불특정 다수가 참여해 직접 작성하기 때문에{" "}
                  <span className="font-semibold">특정 댓글 내용은 지정할 수
                  없습니다.</span> 원치 않으시면 댓글 대신{" "}
                  <span className="font-semibold">좋아요·팔로우 등으로 대체</span>
                  해 마저 진행해 드립니다.
                </p>
              </div>
              <div className="flex gap-2">
                {(
                  [
                    [true, "댓글 포함"],
                    [false, "미포함 (좋아요·팔로우로 대체)"],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={String(val)}
                    onClick={() => setCommentsIncluded(val)}
                    className={`flex-1 rounded-xl border py-2.5 text-sm font-medium transition-colors ${
                      commentsIncluded === val
                        ? "border-rose-400 bg-rose-50 text-rose-600"
                        : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Card>

            {/* 실행 전 경고 박스 — Tailwind v4, 아이콘 라이브러리 불필요(인라인 SVG), warning(red) 톤 */}
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red-100 text-red-600">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                  >
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </span>
                <div>
                  <p className="text-base font-semibold text-red-900">
                    실행 전 꼭 확인해 주세요
                  </p>
                  <p className="text-sm text-red-700">
                    실행 이후에는 되돌릴 수 없습니다
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2.5">
                <div className="flex items-start gap-2.5">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mt-0.5 h-[18px] w-[18px] shrink-0 text-red-500"
                  >
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <p className="text-sm leading-relaxed text-red-800">
                    <span className="font-semibold">채널 URL</span>과{" "}
                    <span className="font-semibold">
                      {representativeContentLabel}
                    </span>
                    을 꼭 확인해 주세요.
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mt-0.5 h-[18px] w-[18px] shrink-0 text-red-500"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                  </svg>
                  <p className="text-sm leading-relaxed text-red-800">
                    실행(운영 시작) 이후에는{" "}
                    <span className="font-semibold">취소 및 수정이 불가능</span>
                    합니다.
                  </p>
                </div>
              </div>
            </div>

            {/* 급행 지원 안내 박스 — Tailwind v4, 아이콘 라이브러리 불필요(인라인 SVG) */}
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-5 w-5"
                  >
                    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
                    <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
                    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
                    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
                  </svg>
                </span>
                <div>
                  <p className="text-base font-semibold text-gray-900">
                    메인 게시물·영상 업로드가 어렵다면?
                  </p>
                  <p className="text-sm text-gray-500">
                    일정이 빠듯해도 마케팅 성과는 챙겨드립니다
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2.5">
                <div className="flex items-start gap-2.5">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gray-400"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <p className="text-sm leading-relaxed text-gray-800">
                    업로드가 어려운 경우(예: MVP 개발 지연, 서비스 제작 일정)에는{" "}
                    <span className="text-gray-500">미리 말씀해 주세요.</span>
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gray-400"
                  >
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <line x1="19" y1="8" x2="19" y2="14" />
                    <line x1="22" y1="11" x2="16" y2="11" />
                  </svg>
                  <p className="text-sm leading-relaxed text-gray-800">
                    AI 마케터를{" "}
                    <span className="font-semibold">2~3명 추가 투입</span>해
                    우선적으로 운영해드립니다.
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="mt-0.5 h-[18px] w-[18px] shrink-0 text-emerald-600"
                  >
                    <polyline points="20 12 20 22 4 22 4 12" />
                    <rect x="2" y="7" width="20" height="5" />
                    <line x1="12" y1="22" x2="12" y2="7" />
                    <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
                    <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
                  </svg>
                  <p className="text-sm leading-relaxed text-gray-800">
                    모두의창업 참여 기업은 별도 비용 없이 제공됩니다.
                  </p>
                </div>
              </div>
              <div className="mt-3.5 flex gap-2 border-t border-gray-100 pt-3">
                <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  무료 제공
                </span>
                <span className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                  모두의창업 한정
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => navigateBack("channel-materials")}
                className="py-4 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                이전으로
              </button>
              <button
                onClick={handleChannelMaterialsNext}
                aria-disabled={!isChannelMaterialsReady}
                className={`${getPrimaryActionButtonClass({
                  theme: "rose",
                  isInactive: !isChannelMaterialsReady,
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

  /* ═══════════════ PAYMENT ═══════════════ */

  if (activeStep === "payment") {
    // ── Institution-granted users: skip the paid flow entirely ───────────
    if (marketerGrantState.status === "idle") {
      // Waiting for grant check to resolve — show spinner to prevent paid-UI flash.
      return (
        <main className={wrapper}>
          <div className="max-w-2xl w-full flex justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-rose-500" />
          </div>
        </main>
      );
    }

    if (marketerGrantState.status === "ready") {
      if (grantSubmitted) {
        // Completion screen for granted users.
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

              <Card className="text-center space-y-3 py-10">
                <div className="w-16 h-16 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-full flex items-center justify-center mx-auto shadow-lg">
                  <span className="text-white text-2xl">✓</span>
                </div>
                <h2 className="text-2xl font-bold text-gray-900">
                  세팅이 완료되었습니다
                </h2>
                <p className="text-gray-500 text-sm">
                  제출해주신 정보를 바탕으로 AI 마케터 운영을 준비하겠습니다.
                </p>
              </Card>

              <Card className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700">결제 상태</p>
                  <span className="inline-block text-xs font-semibold bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full">
                    기관 결제 완료
                  </span>
                </div>
                <p className="text-sm text-gray-500">
                  지원기관을 통해 이용 중입니다. 추가 결제 없이 서비스가 진행됩니다.
                </p>
              </Card>

              <button
                onClick={() => router.push("/mypage")}
                className="w-full bg-gradient-to-r from-rose-500 to-violet-500 text-white font-semibold rounded-2xl py-4 shadow-md hover:shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-5 h-5"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                    clipRule="evenodd"
                  />
                </svg>
                마이페이지로 이동
              </button>
            </div>
          </main>
          </>
        );
      }

      if (submissionError) {
        // Error state with retry.
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

              <Card className="space-y-4">
                <p className="text-sm font-semibold text-rose-600">
                  제출에 실패했습니다
                </p>
                <p className="text-sm text-gray-600">{submissionError}</p>
                <button
                  onClick={() => void handleGrantedApplicationSubmit()}
                  disabled={submittingApplication}
                  className={getPrimaryActionButtonClass({ theme: "rose" })}
                >
                  {submittingApplication ? "재시도 중..." : "다시 시도"}
                </button>
              </Card>
            </div>
          </main>
          </>
        );
      }

      // Pre-check in progress or submitting.
      return (
        <main className={wrapper}>
          <div className="max-w-2xl w-full space-y-6">
            <StepUtilityHeader
              onBack={() => goToStep("landing")}
              onHome={() => goToStep("landing")}
              onMyPage={() => router.push("/mypage")}
              progress={serviceFlowProgress}
            />
            <Card className="flex flex-col items-center gap-4 py-14">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-rose-500" />
              <p className="text-sm text-gray-500">
                {grantCheckDone ? "제출 중입니다..." : "확인 중입니다..."}
              </p>
            </Card>
          </div>
        </main>
      );
    }
    // marketerGrantState.status === "none": fall through to the existing paid flow.

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
                    <span className="font-semibold">60만원</span>
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
                    <span className="font-semibold">55만원</span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-gray-700">
                    <span>2개월</span>
                    <span className="font-semibold">100만원</span>
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

            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex items-start gap-2.5">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mt-0.5 h-[18px] w-[18px] shrink-0 text-blue-600"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                <p className="text-sm leading-relaxed text-gray-800">
                  업종, 콘텐츠 주제, 계정 상태에 따라 실제 성과는 달라질 수
                  있습니다.{" "}
                  <span className="text-gray-500">
                    위 수치는 운영 기준 예상치이며, 보장 수치는 아닙니다.
                  </span>
                </p>
              </div>
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
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex items-start gap-2.5">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mt-0.5 h-[18px] w-[18px] shrink-0 text-blue-600"
                >
                  <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                  <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                </svg>
                <p className="text-sm leading-relaxed text-gray-800">
                  입금자명은 신청 시 입력한 이름과 동일하게 입력해주세요.{" "}
                  <span className="text-gray-500">
                    입금 확인 후 서비스가 시작됩니다.
                  </span>
                </p>
              </div>
            </div>
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
              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-start gap-2.5">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="mt-0.5 h-[18px] w-[18px] shrink-0 text-blue-600"
                    >
                      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                    </svg>
                    <p className="text-sm leading-relaxed text-gray-800">
                      아래 계좌로 입금해주시면 확인 후 마케팅이 시작됩니다
                    </p>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gray-400"
                    >
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    <p className="text-sm leading-relaxed text-gray-800">
                      신청 시 입력한 입금자명과 동일하게 입금해주세요
                    </p>
                  </div>
                </div>
              </div>
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
                <div className="rounded-2xl border border-gray-200 bg-white p-5">
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-start gap-2.5">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="mt-0.5 h-[18px] w-[18px] shrink-0 text-blue-600"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="16" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                      <p className="text-sm leading-relaxed text-gray-800">
                        {isAuthenticated
                          ? "이제 진행 상태 확인과 게시물 AI 생성 기능을 이용하실 수 있습니다"
                          : "회원가입을 완료하면 진행 상태 확인과 게시물 AI 생성 기능을 이용하실 수 있습니다"}
                      </p>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gray-400"
                      >
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                      </svg>
                      <p className="text-sm leading-relaxed text-gray-800">
                        {isRequestLinked
                          ? "신청 시 입력한 아이디(이메일)와 연결되어 진행 정보가 자동으로 준비되었습니다"
                          : "신청 시 입력한 아이디(이메일)로 가입하시면 진행 정보가 더 자연스럽게 연결됩니다"}
                      </p>
                    </div>
                  </div>
                </div>
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
              {hasHydrated && (
                <p className="text-xs text-gray-500 leading-relaxed">
                  1회 무료 체험 후 월 {formattedSubscriptionPrice}원 구독으로 이용할 수
                  있습니다. 매월 40회까지 게시물
                  생성, 이미지 재생성, AI 수정을 함께 이용할 수 있습니다.
                </p>
              )}
            </div>

            <Card className="space-y-4 border-violet-100">
              <SectionLabel>요금 안내</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-4">
                  <p className="text-xs font-semibold text-violet-500">월 요금</p>
                  <p className="mt-2 text-lg font-bold text-gray-900">
                    {formattedSubscriptionPrice}원
                  </p>
                </div>
                <div className="rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-4 space-y-3">
                  <p className="text-xs font-semibold text-violet-500">
                    모두의창업 이용자 전용 혜택
                  </p>
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-gray-600">
                      기본 제공 30회
                    </p>
                    <p className="text-sm font-medium text-violet-600">
                      추가 제공 +10회
                    </p>
                  </div>
                  <p className="text-2xl font-extrabold tracking-tight text-gray-900">
                    총 40회 이용 가능
                  </p>
                  <p className="border-t border-violet-100 pt-3 text-xs leading-relaxed text-gray-500">
                    추가 이용 횟수(토큰) 구매를 원하시는 경우
                    <br />
                    1:1 카카오톡으로 문의해주세요.
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
                  활성화 후 매월 40회까지 이미지
                  생성, 재생성, AI 수정을 함께 이용할 수 있습니다.
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
                {hasHydrated && (
                  <p className="text-xs text-violet-600 leading-relaxed">
                    1회 무료 체험 후 월 {formattedSubscriptionPrice}원 구독으로 매월{" "}
                    40회까지 이미지 생성, 재생성,
                    AI 수정을 함께 이용할 수 있습니다.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                    이번 달 남은 횟수
                  </p>
                  <p className="mt-2 text-lg font-bold text-gray-900">
                    {hasActivePostGeneratorSubscription
                      ? `${remainingSubscriptionCredits}/${POST_GENERATOR_MONTHLY_CREDITS}`
                      : hasConsumedFreeTrial
                        ? "구독 필요"
                        : "무료 1회 가능"}
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
                    {isSubscriptionCreditEmpty
                        ? "이번 달 남은 생성 횟수가 없습니다"
                        : hasConsumedFreeTrial
                          ? "무료 체험 1회를 모두 사용하셨습니다"
                          : "이용 조건을 확인해주세요"}
                  </p>
                  <p className="text-sm text-gray-500 max-w-sm mx-auto">
                    새 게시물 생성은 잠겨 있지만, 이전에 생성한 게시물은 계속 확인할 수 있습니다
                  </p>
                  <p className="text-sm text-gray-500 max-w-sm mx-auto">
                    {hasActivePostGeneratorSubscription
                        ? "다음 결제 주기에 다시 충전되거나 이후 추가 횟수 기능으로 확장될 예정입니다"
                        : "계속 이용하려면 로그인 후 월 구독을 시작해주세요"}
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {hasActivePostGeneratorSubscription ? (
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
                      disabled={startingSubscription}
                      className={`${getPrimaryActionButtonClass({
                        theme: "violet",
                        isInactive: startingSubscription,
                      })} py-3`}
                    >
                      {startingSubscription
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

                <div className="grid grid-cols-1 gap-3">
                  <div className="rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-4">
                    <p className="text-xs font-semibold text-violet-500">
                      이번 달 남은 횟수
                    </p>
                    <p className="mt-2 text-lg font-bold text-gray-900">
                      {hasActivePostGeneratorSubscription
                        ? `${remainingSubscriptionCredits}/${POST_GENERATOR_MONTHLY_CREDITS}`
                        : hasConsumedFreeTrial
                          ? `월 ${formattedSubscriptionPrice}원 구독으로 ${POST_GENERATOR_MONTHLY_CREDITS}회`
                          : "무료 체험 1회 제공"}
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
                    disabled={startingSubscription}
                    className={`${getPrimaryActionButtonClass({
                      theme: "violet",
                      isInactive: startingSubscription,
                    })} py-3`}
                  >
                    {startingSubscription
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
