"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getSupabaseBrowserClientOrNull,
} from "@/lib/supabase/client";
import {
  fetchSavedGeneratedPosts,
  persistApplicationSubmission,
  persistGeneratedPost,
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
  | "postgen";

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
};

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
  };
}

const BANK_TRANSFER_INFO = {
  bankName: "하나은행",
  accountNumber: "588-910292-72307",
  accountHolder: "큐밋(Qmeet)",
};

const APP_STORAGE_KEY = "qmeet-app-state";
const AUTH_STORAGE_KEY = "qmeet-auth-state";

/* ─── Reusable Components ─── */

function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
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
        placeholder={placeholder}
        className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-300 transition-colors bg-white"
      />
    </div>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  rows?: number;
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
        placeholder={placeholder}
        rows={rows}
        className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-300 transition-colors bg-white resize-none"
      />
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

  // Post generation (separate feature)
  const [isPaid, setIsPaid] = useState(false);
  const [remainingPosts, setRemainingPosts] = useState(0);
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [postPrompt, setPostPrompt] = useState("");
  const [generatingPost, setGeneratingPost] = useState(false);
  const [generatedPosts, setGeneratedPosts] = useState<GeneratedPost[]>([]);
  const [savedGeneratedPosts, setSavedGeneratedPosts] = useState<GeneratedPost[]>([]);
  const [loadingSavedPosts, setLoadingSavedPosts] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [freeTrialUsed, setFreeTrialUsed] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authName, setAuthName] = useState("");
  const [userId, setUserId] = useState("");
  const [isRequestLinked, setIsRequestLinked] = useState(false);
  const [applicationId, setApplicationId] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submittingApplication, setSubmittingApplication] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const suggestedPostPrompts = [
    `${industry || "브랜드"}의 첫 인사를 전하면서 ${productService || "서비스"}의 매력을 자연스럽게 소개하는 게시물로 만들어주세요.`,
    `${productService || "서비스"}를 처음 보는 사람이 한눈에 이해하고 관심을 가질 수 있는 홍보 게시물로 만들어주세요.`,
    `${aiResult?.accountPlan.concept || aiResult?.accountPlan.direction || "브랜드 방향"}을 살려 팔로우를 유도할 수 있는 분위기의 게시물로 만들어주세요.`,
  ].map((item) => item.replace(/\s+/g, " ").trim());

  const canUsePaidPostGeneration =
    isPaid && isAuthenticated && remainingPosts > 0;
  const canUseFreeTrial = !freeTrialUsed;
  const canGeneratePost = canUsePaidPostGeneration || canUseFreeTrial;
  const shouldShowPostLock = !canGeneratePost;
  const effectiveInstagramId = hasAccount ? instagramId : finalInstagramId;
  const mergedGeneratedPosts = mergeGeneratedPostHistory(
    generatedPosts,
    savedGeneratedPosts
  );
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
      isPaid &&
      !!managerName.trim() &&
      !!phone.trim() &&
      !!email.trim() &&
      !!depositorName.trim()
    );
  }

  function getSafeStep(nextStep: Step): Step {
    switch (nextStep) {
      case "landing":
      case "postgen":
        return nextStep;
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
    if (typeof nextInstagramId === "string") {
      setFinalInstagramId(nextInstagramId);
    }

    if (isExpress && !completionDate) {
      setCompletionDate(getDefaultCompletionDate(selectedDuration));
    }

    goToStep("payment");
  }

  const activeStep = hasHydrated ? getSafeStep(step) : step;

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
          isPaid?: boolean;
          remainingPosts?: number;
          freeTrialUsed?: boolean;
          applicationId?: string;
          paymentId?: string;
          generatedPosts?: GeneratedPost[];
        };

        if ("hasAccount" in parsed) setHasAccount(parsed.hasAccount ?? null);
        if (parsed.step) setStep(parsed.step);
        setInstagramId(parsed.instagramId ?? "");
        setIndustry(parsed.industry ?? "");
        setProductService(parsed.productService ?? "");
        setAiResult(parsed.aiResult ?? null);
        setFinalInstagramId(parsed.finalInstagramId ?? "");
        if (typeof parsed.selectedPlan === "number") setSelectedPlan(parsed.selectedPlan);
        if (typeof parsed.selectedDuration === "number") setSelectedDuration(parsed.selectedDuration);
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
        setIsPaid(Boolean(parsed.isPaid));
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
        taxInvoiceRequested,
        businessNumber,
        companyName,
        ceoName,
        businessAddress,
        businessType,
        invoiceEmail,
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
    taxInvoiceRequested,
    businessNumber,
    companyName,
    ceoName,
    businessAddress,
    businessType,
    invoiceEmail,
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
  }, [hasHydrated, email]);

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
      isPaid &&
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

    if (screen === "postgen") {
      resolvedStep = "postgen";
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
    aiResult,
    finalInstagramId,
    isPaid,
    managerName,
    phone,
    email,
    depositorName,
    loading,
    aiError,
  ]);

  async function handleGenerate(targetStep: Step = step) {
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
    if (
      (uploadedImages.length === 0 && !postPrompt.trim()) ||
      (!canUsePaidPostGeneration && !canUseFreeTrial)
    ) {
      return;
    }
    setGeneratingPost(true);
    setPostError(null);
    const latestPostContext = mergedGeneratedPosts[0];
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "post_image",
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
      };

      setGeneratedPosts((prev) => [nextPost, ...prev]);

      const persistenceResult = await persistGeneratedPost({
        userId: userId || null,
        email: authEmail || email || null,
        applicationId: applicationId || null,
        title: nextPost.title,
        content: nextPost.content,
        hashtags: nextPost.hashtags,
        imageUrl: nextPost.imagePreview,
        isFreeTrial: !canUsePaidPostGeneration,
      });

      if (persistenceResult.error) {
        console.warn("[Generated Post] Persistence warning:", persistenceResult.error);
      }

      if (canUsePaidPostGeneration) {
        setRemainingPosts((prev) => prev - 1);
      } else {
        setFreeTrialUsed(true);
      }
    } catch (err) {
      console.error("[Post Generate] Network error:", err);
      const message =
        err instanceof Error
          ? err.message
          : "AI 생성에 실패했습니다. 잠시 후 다시 시도해주세요.";
      setPostError(message);
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
  }, [isAuthenticated, authEmail, authName, email, managerName]);

  useEffect(() => {
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
  }, [isAuthenticated, userId, authEmail, email]);

  function handleSignupCta() {
    openAuthPage("status");
  }

  async function handleApplicationSubmit() {
    if (!email.trim() || !managerName.trim() || !phone.trim() || !depositorName.trim()) {
      setSubmissionError("신청자 정보를 모두 입력해주세요.");
      return;
    }

    setSubmissionError(null);
    setSubmittingApplication(true);

    const totalPrice =
      getPrice(selectedPlan, selectedDuration) + getExpressFee(isExpress);

    try {
      const result = await persistApplicationSubmission({
        userId: userId || null,
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
      setIsPaid(true);
      setRemainingPosts(getPostLimit(selectedDuration));
      goToStep("status");
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

  async function handleLogout() {
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
    }));
  }

  /* ═══════════════ LANDING ═══════════════ */

  if (activeStep === "landing") {
    return (
      <main className="min-h-screen bg-[#f8f9fb] flex items-center justify-center px-4">
        <div className="max-w-xl w-full text-center space-y-10">
          <div className="flex items-center justify-end gap-2">
            {hasHydrated ? (
              isAuthenticated ? (
                <>
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
                onClick={() => goToStep("postgen")}
                className={`group text-left p-6 rounded-2xl border-2 transition-all ${
                  canGeneratePost || isPaid || isAuthenticated
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
                      {!freeTrialUsed ? (
                        <span className="text-[10px] font-semibold bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full">
                          1회 무료 체험
                        </span>
                      ) : (!isPaid || !isAuthenticated) && (
                        <span className="text-[10px] font-semibold bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">
                          결제 후 이용
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">
                      무료로 한 번 체험한 뒤 회원가입과 결제로 이어갈 수 있습니다
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
          <button
            onClick={() => navigateBack("account-check")}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-1"
          >
            ← 뒤로
          </button>

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
      <main className={wrapper}>
        <div className="max-w-xl w-full space-y-6">
          <button
            onClick={() => navigateBack("input")}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-1"
          >
            ← 뒤로
          </button>

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
                placeholder="예: our_brand"
                required
              />
            )}
            <InputField
              label="업종"
              value={industry}
              onChange={setIndustry}
              placeholder="예: 정보통신업"
              required
            />
            <TextareaField
              label="판매하는 상품 / 서비스"
              value={productService}
              onChange={setProductService}
              placeholder="기획부터 완결까지 한 번에 끝내는 웹소설 올인원 창작 웹. 세계관 구축, 집필, AI 검증, 카드 뽑기를 통한 영감까지 모두 지원합니다."
              required
              rows={4}
            />
          </Card>

          <button
            onClick={() => handleGenerate("result")}
            disabled={loading || !industry || !productService}
            className="w-full py-4 bg-gradient-to-r from-rose-500 to-pink-500 text-white font-semibold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
    );
  }

  /* ═══════════════ RESULT (account planning only) ═══════════════ */

  if (activeStep === "result") {
    if (loading) {
      return (
        <main className="min-h-screen bg-[#f8f9fb] flex items-center justify-center px-4">
          <div className="text-center space-y-4">
            <div className="w-10 h-10 border-4 border-rose-200 border-t-rose-500 rounded-full animate-spin mx-auto" />
            <p className="text-gray-500 text-sm">
              AI가 기획안을 생성 중입니다...
            </p>
          </div>
        </main>
      );
    }

    return (
      <main className={wrapper}>
        <div className="max-w-2xl w-full space-y-6">
          <button
            onClick={() => navigateBack("result")}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-1"
          >
            ← 뒤로
          </button>

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
              onClick={() => {
                if (hasAccount) {
                  // Has account → go straight to payment
                  moveToPayment(instagramId);
                } else {
                  // No account → show username recommendations
                  goToStep("names");
                }
              }}
              className="py-4 bg-gradient-to-r from-rose-500 to-pink-500 text-white font-semibold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all"
            >
              다음
            </button>
          </div>
        </div>
      </main>
    );
  }

  /* ═══════════════ NAMES (no-account flow only) ═══════════════ */

  if (activeStep === "names") {
    return (
      <main className={wrapper}>
        <div className="max-w-2xl w-full space-y-6">
          <button
            onClick={() => navigateBack("names")}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-1"
          >
            ← 뒤로
          </button>

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
              onClick={() => goToStep("confirm")}
              className="py-4 bg-gradient-to-r from-rose-500 to-pink-500 text-white font-semibold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all"
            >
              다음 단계로
            </button>
          </div>
        </div>
      </main>
    );
  }

  /* ═══════════════ CONFIRM (no-account flow only) ═══════════════ */

  if (activeStep === "confirm") {
    return (
      <main className={wrapper}>
        <div className="max-w-xl w-full space-y-6">
          <button
            onClick={() => navigateBack("confirm")}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-1"
          >
            ← 이전으로
          </button>

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
              placeholder="예: our_brand"
              required
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
              disabled={!finalInstagramId.trim()}
              className="py-4 bg-gradient-to-r from-rose-500 to-pink-500 text-white font-semibold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              확인하고 다음으로
            </button>
          </div>
        </div>
      </main>
    );
  }

  /* ═══════════════ PAYMENT ═══════════════ */

  if (activeStep === "payment") {
    const basePrice = getPrice(selectedPlan, selectedDuration);
    const expressFee = getExpressFee(isExpress);
    const totalPrice = basePrice + expressFee;

    return (
      <main className={wrapper}>
        <div className="max-w-2xl w-full space-y-6">
          <button
            onClick={() => {
              navigateBack("payment");
            }}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-1"
          >
            ← 이전으로
          </button>

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
                className={`text-left p-5 rounded-2xl border-2 transition-all ${
                  selectedPlan === 1
                    ? "border-rose-500 bg-rose-50/50 shadow-md"
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
                className={`text-left p-5 rounded-2xl border-2 transition-all relative overflow-hidden ${
                  selectedPlan === 2
                    ? "border-rose-500 bg-rose-50/50 shadow-md"
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
                  className={`p-4 rounded-xl border-2 font-medium transition-all ${
                    selectedDuration === d
                      ? "border-rose-500 bg-rose-50/50 text-rose-600"
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
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-300 transition-colors bg-white"
                />
                <p className="text-xs text-gray-500">
                  원하시는 날짜에 맞춰 우선적으로 작업을 진행합니다
                </p>
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
          </Card>

          {/* Form */}
          <Card className="space-y-5">
            <SectionLabel>신청자 정보</SectionLabel>
            <InputField
              label="담당자명"
              value={managerName}
              onChange={setManagerName}
              placeholder="홍길동"
              required
            />
            <InputField
              label="연락처"
              value={phone}
              onChange={setPhone}
              placeholder="010-0000-0000"
              type="tel"
              required
            />
            <InputField
              label="이메일"
              value={email}
              onChange={setEmail}
              placeholder="예: brand@company.com"
              type="email"
              required
            />
            <InputField
              label="입금자명"
              value={depositorName}
              onChange={setDepositorName}
              placeholder="홍길동"
              required
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
                  label="세금계산서 이메일"
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
            disabled={submittingApplication || (isExpress && !completionDate)}
            className="w-full py-4 bg-gradient-to-r from-rose-500 to-pink-500 text-white font-semibold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all"
          >
            {submittingApplication
              ? "신청 정보를 저장하고 있습니다..."
              : `신청 완료 (${totalPrice.toLocaleString()}원 입금 진행하기)`}
          </button>
        </div>
      </main>
    );
  }

  /* ═══════════════ STATUS ═══════════════ */

  if (activeStep === "status") {
    const statusStages = ["접수됨", "입금 확인중", "진행중", "완료"];
    const currentStage = 1;
    const totalPrice =
      getPrice(selectedPlan, selectedDuration) + getExpressFee(isExpress);

    return (
      <main className={wrapper}>
        <div className="max-w-2xl w-full space-y-6">
          {/* Hero */}
          <Card className="text-center space-y-3 py-8">
            <div className="w-16 h-16 bg-gradient-to-br from-rose-400 to-pink-500 rounded-full flex items-center justify-center mx-auto shadow-lg">
              <span className="text-white text-2xl">✓</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900">
              신청이 접수되었습니다
            </h2>
            <p className="text-gray-500 text-sm">
              입금 확인 후 마케팅이 시작됩니다
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
                  ? "신청 시 입력한 이메일과 연결되어 진행 정보가 자동으로 준비되었습니다"
                  : "신청 시 입력한 이메일로 가입하시면 진행 정보가 더 자연스럽게 연결됩니다"}
              </p>
            </div>
          </Card>

          <div className="space-y-3">
            <button
              onClick={() => {
                if (isAuthenticated) {
                  goToStep("postgen");
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
    );
  }

  /* ═══════════════ POST GENERATION (SEPARATE) ═══════════════ */

  if (activeStep === "postgen") {
    return (
      <main className={wrapper}>
        <div className="max-w-2xl w-full space-y-6">
          <button
            onClick={() => navigateBack("postgen")}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-1"
          >
            ← 뒤로
          </button>

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
            <Card className="bg-violet-50/60 border-violet-100 space-y-2">
              <p className="text-sm font-semibold text-violet-700">
                게시물 AI 생성은 1회 무료로 체험할 수 있습니다
              </p>
              <p className="text-xs text-violet-600">
                무료 체험 후 계속 이용하려면 결제와 회원가입이 필요합니다
              </p>
            </Card>

            {shouldShowPostLock ? (
              <Card className="text-center space-y-4 py-10">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                  <span className="text-2xl">🔒</span>
                </div>
                <div className="space-y-1">
                  <p className="font-semibold text-gray-700 text-lg">
                    무료 체험 1회를 모두 사용하셨습니다
                  </p>
                  <p className="text-sm text-gray-500 max-w-sm mx-auto">
                    새 게시물 생성은 잠겨 있지만, 이전에 생성한 게시물은 계속 확인할 수 있습니다
                  </p>
                  <p className="text-sm text-gray-500 max-w-sm mx-auto">
                    계속 이용하려면 결제 후 회원가입을 진행해주세요
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => openAuthPage("postgen")}
                    className="w-full py-3 bg-gradient-to-r from-violet-500 to-purple-500 text-white font-semibold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all"
                  >
                    회원가입 또는 로그인
                  </button>
                  <button
                    onClick={() => goToStep("account-check")}
                    className="w-full py-3 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    마케팅 서비스 신청하기
                  </button>
                </div>
              </Card>
            ) : (
              <Card className="space-y-5">
                <div className="flex items-center justify-between mb-4">
                  <SectionLabel>게시물 제작</SectionLabel>
                  <span className="text-xs font-semibold text-violet-600 bg-violet-50 px-3 py-1 rounded-full">
                    {canUsePaidPostGeneration
                      ? `남은 횟수: ${remainingPosts}개`
                      : freeTrialUsed
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
                  disabled={
                    generatingPost ||
                    (!canUsePaidPostGeneration && !canUseFreeTrial) ||
                    (uploadedImages.length === 0 && !postPrompt.trim())
                  }
                  className="w-full py-3 bg-gradient-to-r from-violet-500 to-purple-500 text-white font-semibold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {generatingPost ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      게시물을 만들고 있습니다...
                    </span>
                  ) : canUsePaidPostGeneration ? (
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

            {mergedGeneratedPosts.length > 0 && !canUsePaidPostGeneration && (
              <Card className="space-y-4 border-violet-100 bg-violet-50/50">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-violet-700">
                    무료 체험이 완료되었습니다
                  </p>
                  <p className="text-sm text-violet-600">
                    회원가입 후 진행 상태를 확인하고, 결제 후 계속 이용해보세요
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => openAuthPage("status")}
                    className="w-full py-3 bg-gradient-to-r from-violet-500 to-purple-500 text-white font-semibold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all"
                  >
                    회원가입 또는 로그인
                  </button>
                  <button
                    onClick={() => goToStep("account-check")}
                    className="w-full py-3 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    마케팅 서비스 신청하기
                  </button>
                </div>
              </Card>
            )}
          </div>
        </div>
      </main>
    );
  }

  return null;
}
