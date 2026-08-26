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
  compressImageToDataUrl,
  getAiErrorMessage,
  isRequestBodyTooLarge,
  readAiJsonResponse,
} from "@/lib/client/ai-request";
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
  fetchAccountProfile,
  fetchPostGeneratorSubscription,
  fetchSavedGeneratedPosts,
  persistAccountProfile,
  persistGeneratedPost,
  startPostGeneratorSubscription,
  syncProfileAndLinkData,
  type SavedGeneratedPost,
  type SavedSubscription,
} from "@/lib/supabase/persistence";
import { clearSignedInCookie } from "@/lib/ui/auth-cookie-sync";
import { trackLoginEventOnce } from "@/lib/client/track-login";
import { checkSocialUrl } from "@/lib/client/social-url";
import { BrandProfileEditor } from "@/lib/ui/brand-profile-editor";
import { Card, SectionLabel } from "@/lib/ui/surface-card";
import { InputField, TextareaField } from "@/lib/ui/form-fields";
import { WorkspaceHeader } from "@/lib/ui/workspace-header";
import { AppSurface, useAppTheme } from "@/lib/ui/theme";
import {
  CONTENT_TONE_OPTIONS,
  EMOJI_USAGE_OPTIONS,
  IMAGE_STYLE_OPTIONS,
  loadGenerationPrefs,
  saveGenerationPrefs,
  type ContentTone,
  type EmojiUsage,
  type ImageStyle,
} from "@/lib/client/generation-prefs";
import { stripTrailingPunct } from "@/lib/text/korean";

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
  visualPrompt?: string;
  imageStyle?: string;
  createdAt?: string;
  isPersisted?: boolean;
  isFreeTrial?: boolean;
};

type PostEditState = {
  imageHistory: string[];
  historyIndex: number;
  rerollCount: number;
  editCount: number;
  editPrompt: string;
  rerollSuffix: string;
  rerollLoading: boolean;
  editLoading: boolean;
};

const REROLL_FEEL_VARIATIONS = {
  same: "Subtly refresh the mood while preserving the original image structure.",
  mood: "Change the mood and atmosphere only, making it feel fresh without changing composition.",
  colors: "Change only the color palette and tone while keeping layout, subjects, and text exactly the same.",
  premium: "Make the lighting, color tone, texture, and atmosphere feel more premium and refined only.",
  realistic: "Make the lighting, texture, and atmosphere feel more realistic only.",
} as const;

const REROLL_SUFFIX_OPTIONS = [
  { label: "같은 스타일", value: REROLL_FEEL_VARIATIONS.same },
  { label: "다른 무드", value: REROLL_FEEL_VARIATIONS.mood },
  { label: "다른 색감", value: REROLL_FEEL_VARIATIONS.colors },
  { label: "더 고급스럽게", value: REROLL_FEEL_VARIATIONS.premium },
  { label: "더 사실적으로", value: REROLL_FEEL_VARIATIONS.realistic },
];

type StoredAiResult = {
  accountPlan?: {
    direction?: string;
    bio?: string;
    concept?: string;
  };
};

const APP_STORAGE_KEY = "qmeet-app-state";
const AUTH_STORAGE_KEY = "qmeet-auth-state";

const ONBOARDING_INDUSTRY_OPTIONS = [
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

const ONBOARDING_CUSTOM_INDUSTRY = "__custom__";

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
    visualPrompt: post.visualPrompt ?? undefined,
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

function PrefChipRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-medium text-gray-500 w-16 shrink-0">
        {label}
      </span>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
            value === option.value
              ? "border-violet-400 bg-violet-50 text-violet-700 font-medium"
              : "border-gray-200 bg-white text-gray-500 hover:border-violet-200"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function OnboardingUrlStatus({
  value,
  platform,
}: {
  value: string;
  platform: "instagram" | "youtube";
}) {
  const check = checkSocialUrl(value, platform);
  if (!check) return null;
  const color =
    check.status === "ok"
      ? "text-green-600"
      : check.status === "invalid"
        ? "text-red-500"
        : "text-amber-600";
  return (
    <p className={`text-xs ${color}`}>
      {check.statusLabel}
      {check.kindLabel && ` · ${check.kindLabel}`} — {check.message}
    </p>
  );
}

function ReviewUrlRow({
  label,
  value,
  platform,
}: {
  label: string;
  value: string;
  platform: "instagram" | "youtube";
}) {
  const check = checkSocialUrl(value, platform);
  return (
    <div className="space-y-1">
      <p className="text-xs text-gray-400">{label}</p>
      {!check ? (
        <p className="text-sm text-gray-500">입력 안 함</p>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm text-gray-900 break-all">{check.normalized}</p>
            <OnboardingUrlStatus value={value} platform={platform} />
          </div>
          <a
            href={check.normalized}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-xs px-2.5 py-1.5 rounded-lg border border-violet-200 text-violet-600 hover:bg-violet-50 transition-colors"
          >
            열어보기 ↗
          </a>
        </div>
      )}
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
  // 모두의창업 참여자에게만 전용 혜택 안내를 띄운다. 로그아웃 상태와 일반
  // 가입자는 false 라 노출되지 않는다.
  const [isPartnerMember, setIsPartnerMember] = useState(false);

  const [contextIndustry, setContextIndustry] = useState("");
  const [contextProductService, setContextProductService] = useState("");
  const [contextInstagramHandle, setContextInstagramHandle] = useState("");
  const [contextAccountDirection, setContextAccountDirection] = useState("");
  const [contextAccountBio, setContextAccountBio] = useState("");
  const [contextAccountConcept, setContextAccountConcept] = useState("");
  const [contextMarketingChannel, setContextMarketingChannel] = useState("");
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

  const [postEditStates, setPostEditStates] = useState<Record<string, PostEditState>>({});
  const [contextCompanyName, setContextCompanyName] = useState("");

  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [showPaymentRequiredModal, setShowPaymentRequiredModal] = useState(false);
  const [onboardingInstagramUrl, setOnboardingInstagramUrl] = useState("");
  const [onboardingYoutubeUrl, setOnboardingYoutubeUrl] = useState("");
  const [onboardingBrandName, setOnboardingBrandName] = useState("");
  const [onboardingCompanyName, setOnboardingCompanyName] = useState("");
  const [onboardingIndustry, setOnboardingIndustry] = useState("");
  const [onboardingIndustrySelection, setOnboardingIndustrySelection] = useState("");
  const [onboardingProductService, setOnboardingProductService] = useState("");
  const [onboardingInstagramUrlError, setOnboardingInstagramUrlError] = useState("");
  const [onboardingYoutubeUrlError, setOnboardingYoutubeUrlError] = useState("");
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  // Review step (입력 → 확인 → 최종 제출)
  const [onboardingReview, setOnboardingReview] = useState(false);
  const [onboardingConfirmChecked, setOnboardingConfirmChecked] = useState(false);

  // Tone & style presets — loaded per user, saved after each generation so the
  // brand voice stays consistent across sessions and devices.
  const [contentTone, setContentTone] = useState<ContentTone>("friendly");
  const [emojiUsage, setEmojiUsage] = useState<EmojiUsage>("minimal");
  const [imageStyle, setImageStyle] = useState<ImageStyle>("photoreal");

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
  const canUseSubscriptionPostGeneration =
    hasActivePostGeneratorSubscription &&
    remainingSubscriptionCredits > 0;
  const canUseFreeTrial = !hasConsumedFreeTrial;
  const canGeneratePost = canUseSubscriptionPostGeneration || canUseFreeTrial;
  const shouldShowPostLock = !canGeneratePost;
  const needsAccountInfo = isAuthenticated && (isBlank(contextCompanyName) || isBlank(contextIndustry) || isBlank(contextProductService));
  const isSubscriptionCreditEmpty =
    hasActivePostGeneratorSubscription && remainingSubscriptionCredits === 0;
  const formattedSubscriptionPrice =
    POST_GENERATOR_MONTHLY_PRICE.toLocaleString();

  const _conceptOrDirection = stripTrailingPunct(
    contextAccountConcept || contextAccountDirection || ""
  );
  const suggestedPostPrompts = [
    `${contextIndustry || "브랜드"}의 첫 인사를 전하면서 ${
      contextProductService || "서비스"
    }의 매력을 자연스럽게 소개하는 게시물로 만들어주세요.`,
    `${contextProductService || "서비스"}를 처음 보는 사람이 한눈에 이해하고 관심을 가질 수 있는 홍보 게시물로 만들어주세요.`,
    _conceptOrDirection
      ? `${_conceptOrDirection} — 이 방향성을 살려 팔로우를 유도하는 게시물로 만들어주세요.`
      : `브랜드만의 분위기와 컨셉을 살려 팔로우를 유도하는 게시물로 만들어주세요.`,
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
        message: isSubscriptionCreditEmpty
            ? "남은 생성 횟수가 없습니다"
            : "월 구독 후 이용할 수 있습니다",
        isMissing: !canUseSubscriptionPostGeneration && !canUseFreeTrial,
      },
      {
        field: "postInput",
        message: "계정 정보를 먼저 입력해 주세요",
        isMissing: needsAccountInfo,
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

    let storedUserId = "";
    if (savedAuthState) {
      try {
        const parsedAuth = JSON.parse(savedAuthState) as { userId?: string };
        storedUserId = String(parsedAuth.userId ?? "").trim();
      } catch { /* ignore */ }
    }

    if (savedAppState) {
      try {
        const parsed = JSON.parse(savedAppState) as {
          step?: string;
          hasAccount?: boolean | null;
          instagramId?: string;
          finalInstagramId?: string;
          industry?: string;
          productService?: string;
          marketingChannel?: string;
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
          ownerUserId?: string;
        };

        if (parsed.ownerUserId && storedUserId && parsed.ownerUserId !== storedUserId) {
          window.localStorage.removeItem(APP_STORAGE_KEY);
        } else {
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
          setContextMarketingChannel(
            parsed.marketingChannel === "instagram" || parsed.marketingChannel === "youtube"
              ? parsed.marketingChannel
              : ""
          );
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
        }
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
        visualPrompt: post.visualPrompt,
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
      ownerUserId: userId,
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
    hasTestAccess,
    authName,
    testRemainingPosts,
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
        setIsRequestLinked(false);
        setIsPartnerMember(false);
        return;
      }

      // Returning persisted session that skipped /auth — deduped per browser session
      trackLoginEventOnce(user.id, user.email, "visit");

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
      setIsPartnerMember(snapshot.isPartnerMember);
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
        setIsPartnerMember(false);
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
        setIsPartnerMember(snapshot.isPartnerMember);
      });
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [hasHydrated, postSubEmail, authEmail, hasTestAccess]);

  // Restore the user's saved tone/style presets once we know who they are
  useEffect(() => {
    if (!userId || isTestAccountAuthenticated) return;
    let active = true;
    void (async () => {
      const prefs = await loadGenerationPrefs(userId);
      if (!active) return;
      if (prefs.contentTone) setContentTone(prefs.contentTone);
      if (prefs.emojiUsage) setEmojiUsage(prefs.emojiUsage);
      if (prefs.imageStyle) setImageStyle(prefs.imageStyle);
    })();
    return () => {
      active = false;
    };
  }, [userId, isTestAccountAuthenticated]);

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
    if (!hasHydrated || !isAuthenticated || !userId || isTestAccountAuthenticated) return;

    let active = true;

    void fetchAccountProfile({ userId }).then(({ profile }) => {
      if (!active || !profile) return;

      const handle = (profile.brandName || profile.companyName).trim();
      if (handle) setContextInstagramHandle(handle);
      if (profile.marketingChannel === "instagram" || profile.marketingChannel === "youtube") {
        setContextMarketingChannel(profile.marketingChannel);
      }
      if (profile.industry) setContextIndustry(profile.industry);
      if (profile.productService) setContextProductService(profile.productService);
      if (profile.companyName) setContextCompanyName(profile.companyName);

      const needsOnboarding =
        !profile.accountOnboardedAt ||
        (!profile.companyName && !profile.industry && !profile.productService);

      if (!needsOnboarding) return;

      const prefillIndustry = profile.industry || profile.prefillIndustry;
      const prefillProduct = profile.productService || profile.prefillProductService;

      setOnboardingInstagramUrl(profile.instagramUrl || profile.prefillInstagramUrl);
      setOnboardingYoutubeUrl(profile.youtubeUrl || profile.prefillYoutubeUrl);
      setOnboardingBrandName(profile.brandName);
      setOnboardingCompanyName(profile.companyName);
      setOnboardingIndustry(prefillIndustry);
      setOnboardingIndustrySelection(
        prefillIndustry
          ? (ONBOARDING_INDUSTRY_OPTIONS as readonly string[]).includes(prefillIndustry)
            ? prefillIndustry
            : ONBOARDING_CUSTOM_INDUSTRY
          : ""
      );
      setOnboardingProductService(prefillProduct);
      setShowOnboardingModal(true);
    });

    return () => { active = false; };
  }, [hasHydrated, isAuthenticated, userId, isTestAccountAuthenticated]);

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

  function openPaymentRequiredModal() {
    setShowPaymentRequiredModal(true);
  }

  function getPostEditState(postKey: string, originalUrl: string): PostEditState {
    return postEditStates[postKey] ?? {
      imageHistory: [originalUrl],
      historyIndex: 0,
      rerollCount: 0,
      editCount: 0,
      editPrompt: "",
      rerollSuffix: "",
      rerollLoading: false,
      editLoading: false,
    };
  }

  function getCurrentImageUrl(postKey: string, originalUrl: string): string {
    const s = getPostEditState(postKey, originalUrl);
    return s.imageHistory[s.historyIndex] ?? originalUrl;
  }

  async function loadImageAsDataUrl(imageUrl: string) {
    if (imageUrl.startsWith("data:")) {
      return compressImageToDataUrl(imageUrl);
    }

    const proxyRes = await fetch(`/api/image-proxy?url=${encodeURIComponent(imageUrl)}`);
    if (!proxyRes.ok) throw new Error("이미지를 불러오지 못했습니다.");
    const blob = await proxyRes.blob();

    return compressImageToDataUrl(blob);
  }

  function updatePostEditState(postKey: string, originalUrl: string, patch: Partial<PostEditState>) {
    setPostEditStates((prev) => ({
      ...prev,
      [postKey]: { ...getPostEditState(postKey, originalUrl), ...patch },
    }));
  }

  function pushImageToHistory(postKey: string, originalUrl: string, newUrl: string) {
    setPostEditStates((prev) => {
      const s = prev[postKey] ?? getPostEditState(postKey, originalUrl);
      const truncated = s.imageHistory.slice(0, s.historyIndex + 1);
      return {
        ...prev,
        [postKey]: {
          ...s,
          imageHistory: [...truncated, newUrl],
          historyIndex: truncated.length,
        },
      };
    });
  }

  async function downloadPostImage(imageUrl: string, filename: string) {
    try {
      let blob: Blob;
      if (imageUrl.startsWith("data:")) {
        const commaIdx = imageUrl.indexOf(",");
        const header = commaIdx !== -1 ? imageUrl.slice(5, commaIdx) : "";
        const mimeMatch = header.match(/^(image\/[\w.+-]+);base64$/);
        if (!mimeMatch) { showValidationToast("이미지 다운로드에 실패했습니다."); return; }
        const binary = atob(imageUrl.slice(commaIdx + 1));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        blob = new Blob([bytes], { type: mimeMatch[1] });
      } else {
        const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(imageUrl)}`);
        if (!res.ok) { showValidationToast("이미지 다운로드에 실패했습니다."); return; }
        blob = await res.blob();
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      showValidationToast("이미지 다운로드에 실패했습니다.");
    }
  }

  async function handleReroll(postKey: string, post: GeneratedPost) {
    const s = getPostEditState(postKey, post.imagePreview);
    if (s.rerollLoading) return;
    if (!canUseSubscriptionPostGeneration) {
      openPaymentRequiredModal();
      return;
    }
    if (!post.visualPrompt?.trim()) {
      showValidationToast("이 게시물은 재생성 정보가 없습니다.");
      return;
    }

    const suffix = s.rerollSuffix;
    const currentUrl = getCurrentImageUrl(postKey, post.imagePreview);
    updatePostEditState(postKey, post.imagePreview, { rerollLoading: true });

    let accessToken = "";
    if (!isTestAccountAuthenticated) {
      const supabase = getSupabaseBrowserClientOrNull();
      if (!supabase) {
        updatePostEditState(postKey, post.imagePreview, { rerollLoading: false });
        showValidationToast("로그인 정보를 확인할 수 없습니다. 다시 로그인해주세요.");
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      accessToken = session?.access_token ?? "";
      if (!accessToken) {
        updatePostEditState(postKey, post.imagePreview, { rerollLoading: false });
        showValidationToast("로그인 정보가 만료되었습니다. 다시 로그인해주세요.");
        return;
      }
    }

    try {
      const base64 = await loadImageAsDataUrl(currentUrl);
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "image_only",
          accessToken: accessToken || null,
          isInternalTestAccount: isTestAccountAuthenticated,
          imageEditBase64: base64,
          visualPrompt: post.visualPrompt,
          rerollSuffix: suffix,
          instagramHandle: contextInstagramHandle,
          industry: contextIndustry,
          productService: contextProductService,
          marketingChannel: contextMarketingChannel,
        }),
      });
      const data = (await readAiJsonResponse(res)) as { generatedImageUrl?: string; error?: string };
      if (!res.ok) throw new Error(getAiErrorMessage(res, data, "재생성에 실패했습니다."));
      if (!data.generatedImageUrl) throw new Error("이미지 결과 없음");

      // Credit consumed server-side — sync local count
      if (isTestAccountAuthenticated) {
        const today = getKoreaDateString();
        setPostGeneratorSubscription((current) => {
          const base = current ?? buildTestAccountSubscription(POST_GENERATOR_MONTHLY_CREDITS);
          const dailyUsageCount = base.lastUsageDate === today ? base.dailyUsageCount : 0;
          return { ...base, remainingCredits: Math.max(base.remainingCredits - 1, 0), dailyUsageCount: dailyUsageCount + 1, lastUsageDate: today };
        });
      } else if (userId) {
        const subscriptionResult = await fetchPostGeneratorSubscription({ userId });
        if (!subscriptionResult.error) setPostGeneratorSubscription(subscriptionResult.subscription);
      }

      pushImageToHistory(postKey, post.imagePreview, data.generatedImageUrl);
      setPostEditStates((prev) => ({
        ...prev,
        [postKey]: {
          ...(prev[postKey] ?? getPostEditState(postKey, post.imagePreview)),
          rerollCount: (prev[postKey]?.rerollCount ?? 0) + 1,
          rerollLoading: false,
        },
      }));
    } catch (err) {
      const msg =
        err instanceof TypeError
          ? "생성이 오래 걸려 실패했어요. 다시 시도해 주세요."
          : err instanceof Error
          ? err.message
          : "재생성에 실패했습니다.";
      showValidationToast(msg);
      updatePostEditState(postKey, post.imagePreview, { rerollLoading: false });
    }
  }

  async function handleAiEdit(postKey: string, post: GeneratedPost) {
    const s = getPostEditState(postKey, post.imagePreview);
    if (s.editLoading || !s.editPrompt.trim()) return;
    if (!canUseSubscriptionPostGeneration) {
      openPaymentRequiredModal();
      return;
    }

    const currentUrl = getCurrentImageUrl(postKey, post.imagePreview);
    updatePostEditState(postKey, post.imagePreview, { editLoading: true });

    let accessToken = "";
    if (!isTestAccountAuthenticated) {
      const supabase = getSupabaseBrowserClientOrNull();
      if (!supabase) {
        updatePostEditState(postKey, post.imagePreview, { editLoading: false });
        showValidationToast("로그인 정보를 확인할 수 없습니다. 다시 로그인해주세요.");
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      accessToken = session?.access_token ?? "";
      if (!accessToken) {
        updatePostEditState(postKey, post.imagePreview, { editLoading: false });
        showValidationToast("로그인 정보가 만료되었습니다. 다시 로그인해주세요.");
        return;
      }
    }

    try {
      const base64 = await loadImageAsDataUrl(currentUrl);

      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "image_edit",
          accessToken: accessToken || null,
          isInternalTestAccount: isTestAccountAuthenticated,
          imageEditBase64: base64,
          editPrompt: s.editPrompt,
          industry: contextIndustry,
          productService: contextProductService,
        }),
      });
      const data = (await readAiJsonResponse(res)) as { generatedImageUrl?: string; error?: string };
      if (!res.ok) throw new Error(getAiErrorMessage(res, data, "수정에 실패했습니다."));
      if (!data.generatedImageUrl) throw new Error("이미지 결과 없음");

      // Credit consumed server-side — sync local count
      if (isTestAccountAuthenticated) {
        const today = getKoreaDateString();
        setPostGeneratorSubscription((current) => {
          const base = current ?? buildTestAccountSubscription(POST_GENERATOR_MONTHLY_CREDITS);
          const dailyUsageCount = base.lastUsageDate === today ? base.dailyUsageCount : 0;
          return { ...base, remainingCredits: Math.max(base.remainingCredits - 1, 0), dailyUsageCount: dailyUsageCount + 1, lastUsageDate: today };
        });
      } else if (userId) {
        const subscriptionResult = await fetchPostGeneratorSubscription({ userId });
        if (!subscriptionResult.error) setPostGeneratorSubscription(subscriptionResult.subscription);
      }

      pushImageToHistory(postKey, post.imagePreview, data.generatedImageUrl);
      setPostEditStates((prev) => ({
        ...prev,
        [postKey]: {
          ...(prev[postKey] ?? getPostEditState(postKey, post.imagePreview)),
          editCount: (prev[postKey]?.editCount ?? 0) + 1,
          editPrompt: "",
          editLoading: false,
        },
      }));
    } catch (err) {
      const msg =
        err instanceof TypeError
          ? "생성이 오래 걸려 실패했어요. 다시 시도해 주세요."
          : err instanceof Error
          ? err.message
          : "수정에 실패했어요. 다시 시도해주세요.";
      showValidationToast(msg);
      updatePostEditState(postKey, post.imagePreview, { editLoading: false });
    }
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
      clearSignedInCookie();
      await supabase.auth.signOut();
    }

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
      window.localStorage.removeItem(APP_STORAGE_KEY);
    }

    setIsAuthenticated(false);
    setAuthEmail("");
    setAuthName("");
    setUserId("");
    setIsRequestLinked(false);
    setIsPartnerMember(false);
    setHasTestAccess(false);
    setPostGeneratorSubscription(null);
  }

  // Step 1: validate the inputs and move to the review screen.
  function handleOnboardingProceedToReview() {
    if (savingOnboarding || !userId) return;

    let hasUrlError = false;
    const instagramCheck = checkSocialUrl(onboardingInstagramUrl, "instagram");
    const youtubeCheck = checkSocialUrl(onboardingYoutubeUrl, "youtube");

    if (instagramCheck?.status === "invalid") {
      setOnboardingInstagramUrlError(instagramCheck.message);
      hasUrlError = true;
    } else {
      setOnboardingInstagramUrlError("");
    }

    if (youtubeCheck?.status === "invalid") {
      setOnboardingYoutubeUrlError(youtubeCheck.message);
      hasUrlError = true;
    } else {
      setOnboardingYoutubeUrlError("");
    }

    if (hasUrlError) return;

    if (isBlank(onboardingCompanyName) || isBlank(onboardingIndustry) || isBlank(onboardingProductService)) {
      showValidationToast("회사명, 업종, 판매 상품·서비스는 필수 항목입니다.");
      return;
    }

    setOnboardingConfirmChecked(false);
    setOnboardingReview(true);
  }

  // Step 2: final submit from the review screen.
  async function handleOnboardingSave() {
    if (savingOnboarding || !userId) return;

    // Persist the normalized URL (scheme/host fixed) when available
    const instagramCheck = checkSocialUrl(onboardingInstagramUrl, "instagram");
    const youtubeCheck = checkSocialUrl(onboardingYoutubeUrl, "youtube");

    setSavingOnboarding(true);
    try {
      const result = await persistAccountProfile({
        userId,
        companyName: onboardingCompanyName,
        brandName: onboardingBrandName,
        instagramUrl: instagramCheck?.normalized ?? onboardingInstagramUrl,
        youtubeUrl: youtubeCheck?.normalized ?? onboardingYoutubeUrl,
        industry: onboardingIndustry,
        productService: onboardingProductService,
      });

      if (result.error) {
        showValidationToast("저장에 실패했습니다. 다시 시도해주세요.");
        return;
      }

      const derivedChannel = onboardingInstagramUrl.trim()
        ? "instagram"
        : onboardingYoutubeUrl.trim()
          ? "youtube"
          : "";

      setContextInstagramHandle((onboardingBrandName || onboardingCompanyName).trim());
      setContextMarketingChannel(derivedChannel);
      setContextCompanyName(onboardingCompanyName.trim());
      setContextIndustry(onboardingIndustry.trim());
      setContextProductService(onboardingProductService.trim());
      setOnboardingReview(false);
      setShowOnboardingModal(false);
    } finally {
      setSavingOnboarding(false);
    }
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
      if (needsAccountInfo) {
        setShowOnboardingModal(true);
      }
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
      const requestBody = JSON.stringify({
        type: "post_image",
        usageMode: isFreeTrialGeneration ? "free_trial" : "premium",
        accessToken: accessToken || null,
        isInternalTestAccount: isTestAccountAuthenticated,
        images: uploadedImages,
        userPrompt: postPrompt,
        instagramHandle: contextInstagramHandle.trim(),
        industry: contextIndustry,
        productService: contextProductService,
        accountDirection: contextAccountDirection,
        accountBio: contextAccountBio,
        accountConcept: contextAccountConcept,
        marketingChannel: contextMarketingChannel,
        contentTone,
        emojiUsage,
        imageStyle,
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
        throw new Error("실제 OpenRouter API 응답이 아닙니다.");
      }

      let nextPost: GeneratedPost = {
        id: crypto.randomUUID(),
        title: data.title,
        content: data.content,
        hashtags: data.hashtags,
        imagePreview: data.generatedImageUrl,
        imageModelText: data.imageModelText,
        visualPrompt: typeof data.visualPrompt === "string" ? data.visualPrompt : undefined,
        createdAt: new Date().toISOString(),
        isPersisted: false,
        isFreeTrial: isFreeTrialGeneration,
      };

      // Remember the tone/style that produced this result for next time
      if (userId && !isTestAccountAuthenticated) {
        saveGenerationPrefs(userId, { contentTone, emojiUsage, imageStyle });
      }

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
          visualPrompt: nextPost.visualPrompt ?? null,
        });

        if (
          persistenceResult.error &&
          !persistenceResult.saved &&
          !persistenceResult.queued
        ) {
          throw new Error(persistenceResult.error);
        }

        if (persistenceResult.generatedPostId) {
          nextPost = {
            ...nextPost,
            id: persistenceResult.generatedPostId,
            isPersisted: true,
          };
        }
      }

      setGeneratedPosts((prev) => [nextPost, ...prev]);

      if (isFreeTrialGeneration) {
        setFreeTrialUsed(true);
      }
    } catch (err) {
      const message =
        err instanceof TypeError
          ? "생성이 오래 걸려 실패했어요. 다시 시도해 주세요."
          : err instanceof Error
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

  const { theme, toggleTheme } = useAppTheme();
  const wrapper =
    "relative min-h-screen flex items-start justify-center px-4 py-12";
  const progress = getToolsProgress(step);

  if (step === "postsub-payment") {
    return (
      <>
        <AppSurface>
        <main className={wrapper}>
          <div className="max-w-2xl w-full space-y-6">
            <WorkspaceHeader
              tone={theme}
              onToggleTone={toggleTheme}
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
                {isPartnerMember && (
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
                )}
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
        </AppSurface>
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
        <AppSurface>
        <main className={wrapper}>
          <div className="max-w-2xl w-full space-y-6">
            <WorkspaceHeader
              tone={theme}
              onToggleTone={toggleTheme}
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
                onClick={() => setStep("postgen")}
                className="w-full py-4 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                게시물 AI 생성 화면으로 돌아가기
              </button>
            </div>
          </div>
        </main>
        </AppSurface>
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
      <AppSurface>
        <main className={wrapper}>
        <div className="max-w-2xl w-full space-y-6">
          <WorkspaceHeader
            tone={theme}
            onToggleTone={toggleTheme}
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
            <Card className="border-gray-200 p-5 space-y-4">
              <div>
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
                      <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z" />
                    </svg>
                  </span>
                  <div>
                    <p className="text-base font-semibold text-gray-900">
                      게시물 AI 생성 구독
                    </p>
                    <p className="text-sm text-gray-500">
                      이미지 생성·재생성·AI 수정을 한 번에
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
                      <rect x="2" y="5" width="20" height="14" rx="2" />
                      <line x1="2" y1="10" x2="22" y2="10" />
                    </svg>
                    <p className="text-sm leading-relaxed text-gray-800">
                      게시물 AI 생성은 구독형으로 운영됩니다.{" "}
                      <span className="font-semibold">
                        월 {POST_GENERATOR_MONTHLY_PRICE.toLocaleString()}원
                      </span>{" "}
                      구독으로
                      이미지 생성, 재생성, AI 수정 기능을 이용하실 수 있습니다.
                    </p>
                  </div>
                </div>
                {isPartnerMember && (
                <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-[18px] w-[18px] shrink-0 text-emerald-600"
                    >
                      <polyline points="20 12 20 22 4 22 4 12" />
                      <rect x="2" y="7" width="20" height="5" />
                      <line x1="12" y1="22" x2="12" y2="7" />
                      <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
                      <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
                    </svg>
                    <p className="text-sm font-semibold text-emerald-800">
                      모두의창업 이용자 전용 혜택
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-white/70 px-3 py-2.5">
                      <p className="text-xs text-emerald-700">기본 제공</p>
                      <p className="text-lg font-semibold text-emerald-900">30회</p>
                    </div>
                    <div className="rounded-lg bg-white/70 px-3 py-2.5">
                      <p className="text-xs text-emerald-700">추가 제공</p>
                      <p className="text-lg font-semibold text-emerald-900">+10회</p>
                    </div>
                  </div>
                </div>
                )}
              </div>
              {hasHydrated && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              )}
            </Card>

            {/* AI-generator input info (view + edit) — moved here from My Page */}
            {userId && !isTestAccountAuthenticated && (
              <BrandProfileEditor userId={userId} />
            )}

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
                          : () => openAuthPage("login")
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
                      ? `이번 달 남은 횟수 ${remainingSubscriptionCredits}/${POST_GENERATOR_MONTHLY_CREDITS}`
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

                <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-900">
                      톤 & 스타일
                    </p>
                    <p className="text-[11px] text-gray-400">
                      선택은 자동 저장되어 다음 생성에도 적용됩니다
                    </p>
                  </div>
                  <PrefChipRow
                    label="말투"
                    options={CONTENT_TONE_OPTIONS}
                    value={contentTone}
                    onChange={setContentTone}
                  />
                  <PrefChipRow
                    label="이모지"
                    options={EMOJI_USAGE_OPTIONS}
                    value={emojiUsage}
                    onChange={setEmojiUsage}
                  />
                  <PrefChipRow
                    label="이미지"
                    options={IMAGE_STYLE_OPTIONS}
                    value={imageStyle}
                    onChange={setImageStyle}
                  />
                </div>

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
                  {(() => {
                    const s = getPostEditState(postKey, post.imagePreview);
                    const currentImg = getCurrentImageUrl(postKey, post.imagePreview);
                    const canUndo = s.historyIndex > 0;
                    const canRedo = s.historyIndex < s.imageHistory.length - 1;
                    const isMonthlyCreditEmpty =
                      hasActivePostGeneratorSubscription &&
                      remainingSubscriptionCredits <= 0;
                    return (
                  <div className="grid grid-cols-1 md:grid-cols-[260px,1fr] gap-4 items-start">
                    <div className="space-y-3">
                      {/* header row */}
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-900">피드 이미지</p>
                        <button
                          onClick={() => downloadPostImage(
                            currentImg,
                            `인스타그램-게시물-${mergedGeneratedPosts.length - i}.png`
                          )}
                          className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-semibold rounded-lg bg-violet-50 text-violet-600 hover:bg-violet-100 transition-colors"
                        >
                          다운로드
                        </button>
                      </div>

                      {/* image */}
                      <div className="relative max-w-[260px] w-full rounded-xl overflow-hidden border border-gray-100 aspect-square bg-gray-50 mx-auto md:mx-0 shadow-sm">
                        <Image
                          src={currentImg}
                          alt="게시물 이미지"
                          fill
                          unoptimized
                          sizes="260px"
                          className="object-cover"
                        />
                      </div>

                      {/* history nav */}
                      {s.imageHistory.length > 1 && (
                        <div className="flex items-center gap-2 justify-center">
                          <button
                            disabled={!canUndo}
                            onClick={() => updatePostEditState(postKey, post.imagePreview, { historyIndex: s.historyIndex - 1 })}
                            className="px-2 py-1 text-xs rounded-md bg-gray-100 text-gray-600 disabled:opacity-30 hover:bg-gray-200 transition-colors"
                          >
                            ← 이전
                          </button>
                          <span className="text-xs text-gray-400">{s.historyIndex + 1} / {s.imageHistory.length}</span>
                          <button
                            disabled={!canRedo}
                            onClick={() => updatePostEditState(postKey, post.imagePreview, { historyIndex: s.historyIndex + 1 })}
                            className="px-2 py-1 text-xs rounded-md bg-gray-100 text-gray-600 disabled:opacity-30 hover:bg-gray-200 transition-colors"
                          >
                            다음 →
                          </button>
                        </div>
                      )}

                      {isMonthlyCreditEmpty && (
                        <p className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-600">
                          이번 달 이미지 횟수를 모두 사용했어요.
                        </p>
                      )}

                      {/* re-roll */}
                      <div className="space-y-2 border border-gray-100 rounded-xl p-3 bg-gray-50">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-700">이미지 재생성</span>
                          <span className="text-xs text-gray-400">공유 횟수 차감</span>
                        </div>
                        <select
                          value={s.rerollSuffix}
                          onChange={(e) => updatePostEditState(postKey, post.imagePreview, { rerollSuffix: e.target.value })}
                          className="w-full text-xs rounded-lg border border-gray-200 px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-violet-400"
                        >
                          {REROLL_SUFFIX_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                        <button
                          disabled={s.rerollLoading || isMonthlyCreditEmpty}
                          onClick={() => handleReroll(postKey, post)}
                          className="w-full text-xs py-1.5 rounded-lg font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-colors"
                        >
                          {isMonthlyCreditEmpty
                            ? "이번 달 횟수 없음"
                            : s.rerollLoading
                              ? "생성 중…"
                              : "다시 생성"}
                        </button>
                      </div>

                      {/* AI edit */}
                      <div className="space-y-2 border border-gray-100 rounded-xl p-3 bg-gray-50">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-gray-700">AI로 이미지 수정</span>
                          <span className="text-xs text-gray-400">공유 횟수 차감</span>
                        </div>
                        <textarea
                          value={s.editPrompt}
                          onChange={(e) => updatePostEditState(postKey, post.imagePreview, { editPrompt: e.target.value })}
                          placeholder="예: 배경을 하늘색으로, 더 밝게 수정해줘"
                          rows={2}
                          className="w-full text-xs rounded-lg border border-gray-200 px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-violet-400"
                        />
                        <button
                          disabled={s.editLoading || isMonthlyCreditEmpty || !s.editPrompt.trim()}
                          onClick={() => handleAiEdit(postKey, post)}
                          className="w-full text-xs py-1.5 rounded-lg font-semibold bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-colors"
                        >
                          {isMonthlyCreditEmpty
                            ? "이번 달 횟수 없음"
                            : s.editLoading
                              ? "수정 중…"
                              : "AI 수정 적용"}
                        </button>
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
                    );
                  })()}
                </Card>
              );
            })}

            {mergedGeneratedPosts.length > 0 && !canUseSubscriptionPostGeneration && (
              <Card className="border-gray-200 bg-white p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-5 w-5"
                    >
                      <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z" />
                    </svg>
                  </span>
                  <div className="space-y-1">
                    <p className="text-base font-semibold text-gray-900">
                      {hasActivePostGeneratorSubscription
                        ? "이번 달 이미지 횟수를 모두 사용했어요."
                        : "무료 체험이 완료되었습니다."}
                    </p>
                    <p className="text-sm leading-relaxed text-gray-500">
                      {hasActivePostGeneratorSubscription
                        ? "다음 결제 주기에 맞춰 다시 이용하실 수 있습니다."
                        : (
                            <>
                              회원가입 또는 로그인하여
                              <br />
                              AI 이미지 생성을 계속 이용해보세요.
                            </>
                          )}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={
                      isAuthenticated
                        ? handleMoveToPostSubscriptionPayment
                        : () => openAuthPage("login")
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
        </AppSurface>
      {showPaymentRequiredModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 space-y-5 shadow-xl">
            <div className="space-y-2">
              <h2 className="text-lg font-bold text-gray-900">결제가 필요해요</h2>
              <p className="text-sm leading-relaxed text-gray-500">
                다시 생성과 AI 수정은 결제 후 이용할 수 있어요.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={() => {
                  setShowPaymentRequiredModal(false);
                  if (isAuthenticated) {
                    handleMoveToPostSubscriptionPayment();
                    return;
                  }
                  openAuthPage("login");
                }}
                className={`${getPrimaryActionButtonClass({ theme: "violet" })} py-3`}
              >
                {isAuthenticated ? "결제하러 가기" : "로그인하고 결제하기"}
              </button>
              <button
                onClick={() => setShowPaymentRequiredModal(false)}
                className="w-full py-3 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
      {showOnboardingModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90dvh] overflow-y-auto p-6 space-y-5 shadow-xl">
            <div className="flex items-start justify-between">
              <div className="space-y-0.5">
                <h2 className="text-lg font-bold text-gray-900">
                  {onboardingReview ? "입력 정보 확인" : "계정 정보를 알려주세요"}
                </h2>
                <p className="text-sm text-gray-500">
                  {onboardingReview
                    ? "입력하신 정보가 맞는지 다시 확인해주세요."
                    : "입력하신 정보로 더 딱 맞는 게시물을 만들어드려요."}
                </p>
              </div>
              <button
                onClick={() => {
                  setOnboardingReview(false);
                  setShowOnboardingModal(false);
                }}
                className="text-gray-400 hover:text-gray-600 transition-colors text-xl leading-none ml-3 mt-0.5"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            {onboardingReview ? (
              <>
                <div className="space-y-3 bg-gray-50 rounded-xl p-4">
                  {(
                    [
                      ["회사명", onboardingCompanyName],
                      ["브랜드 / 아이템명", onboardingBrandName || "입력 안 함"],
                      ["업종", onboardingIndustry],
                      ["판매 상품 · 서비스", onboardingProductService],
                    ] as Array<[string, string]>
                  ).map(([label, value]) => (
                    <div key={label}>
                      <p className="text-xs text-gray-400">{label}</p>
                      <p className="text-sm text-gray-900">{value}</p>
                    </div>
                  ))}
                  <ReviewUrlRow
                    label="인스타그램 URL"
                    value={onboardingInstagramUrl}
                    platform="instagram"
                  />
                  <ReviewUrlRow
                    label="유튜브 URL"
                    value={onboardingYoutubeUrl}
                    platform="youtube"
                  />
                </div>

                <p className="text-xs text-gray-500 leading-relaxed">
                  인스타그램 및 유튜브 링크는 직접 눌러 정상적으로 열리는지
                  확인해주세요. 입력 정보는 AI 게시물 생성 품질에 그대로
                  반영됩니다.
                </p>

                <label className="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={onboardingConfirmChecked}
                    onChange={(e) => setOnboardingConfirmChecked(e.target.checked)}
                    className="mt-0.5 accent-violet-600"
                  />
                  <span className="text-sm text-gray-700">
                    입력한 정보를 모두 확인했습니다.
                  </span>
                </label>

                <div className="flex gap-2">
                  <button
                    onClick={() => setOnboardingReview(false)}
                    className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    수정하기
                  </button>
                  <button
                    onClick={() => void handleOnboardingSave()}
                    disabled={savingOnboarding || !onboardingConfirmChecked}
                    className={`${getPrimaryActionButtonClass({
                      theme: "violet",
                      isInactive: savingOnboarding || !onboardingConfirmChecked,
                    })} flex-1 py-3`}
                  >
                    {savingOnboarding ? "저장 중..." : "최종 제출"}
                  </button>
                </div>
              </>
            ) : (
              <>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">
                인스타그램 URL
                <span className="ml-1.5 text-xs font-normal text-gray-400">선택</span>
              </label>
              <input
                type="url"
                value={onboardingInstagramUrl}
                onChange={(e) => {
                  setOnboardingInstagramUrl(e.target.value);
                  if (onboardingInstagramUrlError) setOnboardingInstagramUrlError("");
                }}
                placeholder="https://instagram.com/..."
                className={getTextFieldClass({ theme: "violet", hasError: !!onboardingInstagramUrlError })}
              />
              {onboardingInstagramUrlError && (
                <p className={getHelperTextClass("violet")}>
                  {onboardingInstagramUrlError}
                </p>
              )}
              {!onboardingInstagramUrlError && (
                <OnboardingUrlStatus
                  value={onboardingInstagramUrl}
                  platform="instagram"
                />
              )}
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">
                유튜브 URL
                <span className="ml-1.5 text-xs font-normal text-gray-400">선택</span>
              </label>
              <input
                type="url"
                value={onboardingYoutubeUrl}
                onChange={(e) => {
                  setOnboardingYoutubeUrl(e.target.value);
                  if (onboardingYoutubeUrlError) setOnboardingYoutubeUrlError("");
                }}
                placeholder="https://youtube.com/@..."
                className={getTextFieldClass({ theme: "violet", hasError: !!onboardingYoutubeUrlError })}
              />
              {onboardingYoutubeUrlError && (
                <p className={getHelperTextClass("violet")}>
                  {onboardingYoutubeUrlError}
                </p>
              )}
              {!onboardingYoutubeUrlError && (
                <OnboardingUrlStatus
                  value={onboardingYoutubeUrl}
                  platform="youtube"
                />
              )}
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">
                브랜드 / 아이템명
                <span className="ml-1.5 text-xs font-normal text-gray-400">선택</span>
              </label>
              <input
                type="text"
                value={onboardingBrandName}
                onChange={(e) => setOnboardingBrandName(e.target.value)}
                placeholder="예: AI 게시물 생성기, 뷰티구독"
                className={getTextFieldClass({ theme: "violet", hasError: false })}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">
                회사명 <span className="text-rose-500 ml-0.5">*</span>
              </label>
              <input
                type="text"
                value={onboardingCompanyName}
                onChange={(e) => setOnboardingCompanyName(e.target.value)}
                placeholder="예: 큐밋, 뷰티캐슬"
                className={getTextFieldClass({ theme: "violet", hasError: false })}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">
                업종 <span className="text-rose-500 ml-0.5">*</span>
              </label>
              <select
                value={onboardingIndustrySelection}
                onChange={(e) => {
                  const next = e.target.value;
                  setOnboardingIndustrySelection(next);
                  if (next !== ONBOARDING_CUSTOM_INDUSTRY) {
                    setOnboardingIndustry(next);
                  } else {
                    setOnboardingIndustry("");
                  }
                }}
                className={getTextFieldClass({ theme: "violet", hasError: false })}
              >
                <option value="">업종을 선택해주세요</option>
                {ONBOARDING_INDUSTRY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
                <option value={ONBOARDING_CUSTOM_INDUSTRY}>기타(직접 입력)</option>
              </select>
              {onboardingIndustrySelection === ONBOARDING_CUSTOM_INDUSTRY && (
                <input
                  type="text"
                  value={onboardingIndustry}
                  onChange={(e) => setOnboardingIndustry(e.target.value)}
                  placeholder="예: 반려동물 용품"
                  className={getTextFieldClass({ theme: "violet", hasError: false })}
                />
              )}
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">
                판매 상품 · 서비스 한줄 소개 <span className="text-rose-500 ml-0.5">*</span>
              </label>
              <input
                type="text"
                value={onboardingProductService}
                onChange={(e) => setOnboardingProductService(e.target.value)}
                placeholder="예: 소상공인을 위한 SNS 게시물 자동 생성 서비스"
                className={getTextFieldClass({ theme: "violet", hasError: false })}
              />
            </div>

            <button
              onClick={handleOnboardingProceedToReview}
              disabled={
                savingOnboarding ||
                isBlank(onboardingCompanyName) ||
                isBlank(onboardingIndustry) ||
                isBlank(onboardingProductService)
              }
              className={`${getPrimaryActionButtonClass({
                theme: "violet",
                isInactive:
                  savingOnboarding ||
                  isBlank(onboardingCompanyName) ||
                  isBlank(onboardingIndustry) ||
                  isBlank(onboardingProductService),
              })} py-3`}
            >
              다음 — 입력 정보 확인
            </button>
              </>
            )}
          </div>
        </div>
      )}

      <ValidationToast
        message={validationToast}
        onClose={() => setValidationToast(null)}
        theme="violet"
      />
    </>
  );
}
