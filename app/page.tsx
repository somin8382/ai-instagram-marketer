"use client";

import { useState, useRef } from "react";

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
  topic: string;
  content: string;
  hashtags: string;
  imagePreview: string;
};

/* ─── Helpers ─── */

function getPrice(plan: number, duration: number): number {
  if (plan === 1 && duration === 1) return 300000;
  if (plan === 1 && duration === 2) return 500000;
  if (plan === 2 && duration === 1) return 500000;
  if (plan === 2 && duration === 2) return 800000;
  return 300000;
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
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [generatingPost, setGeneratingPost] = useState(false);
  const [generatedPosts, setGeneratedPosts] = useState<GeneratedPost[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The effective Instagram ID used for payment (differs by flow)
  const effectiveInstagramId = hasAccount ? instagramId : finalInstagramId;

  /* ─── Handlers ─── */

  async function handleGenerate(targetStep: Step = step) {
    setLoading(true);
    setAiError(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industry,
          productService,
          requestId: crypto.randomUUID(),
          previousResult: aiResult,
        }),
      });
      const data = await res.json();

      if (data?.source === "fallback") {
        console.log("[AI Generate] Response from: FALLBACK");
      }

      if (!res.ok) {
        throw new Error(data?.error ?? "AI 생성에 실패했습니다.");
      }

      if (data.source !== "api") {
        console.warn("[AI Generate] Non-API response detected:", data.source);
        throw new Error("실제 Gemini API 응답이 아닙니다.");
      }

      console.log("[AI Generate] Response from: GEMINI API");
      setAiSource("api");
      setAiResult(data);
      setStep(targetStep);
    } catch (err) {
      console.error("[AI Generate] Network error:", err);
      const message =
        err instanceof Error
          ? err.message
          : "AI 생성에 실패했습니다. 잠시 후 다시 시도해주세요.";
      setAiError(message);
      setAiSource(null);
      setStep(targetStep);
    } finally {
      setLoading(false);
    }
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setUploadedImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  }

  async function handleGeneratePost() {
    if (!uploadedImage || remainingPosts <= 0) return;
    setGeneratingPost(true);
    setPostError(null);
    try {
      const res = await fetch("/api/generate-post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: uploadedImage,
          industry,
          productService,
          requestId: crypto.randomUUID(),
          previousPost: generatedPosts[0]
            ? {
                topic: generatedPosts[0].topic,
                content: generatedPosts[0].content,
                hashtags: generatedPosts[0].hashtags,
              }
            : null,
        }),
      });
      const data = await res.json();

      if (data?.source === "fallback") {
        console.log("[Post Generate] Response from: FALLBACK");
      }

      if (!res.ok) {
        throw new Error(data?.error ?? "게시물 생성에 실패했습니다.");
      }

      if (data.source !== "api") {
        console.warn("[Post Generate] Non-API response detected:", data.source);
        throw new Error("실제 Gemini API 응답이 아닙니다.");
      }

      console.log("[Post Generate] Response from: GEMINI API");
      setGeneratedPosts((prev) => [
        { ...data, imagePreview: uploadedImage },
        ...prev,
      ]);
      setRemainingPosts((prev) => prev - 1);
      setUploadedImage(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
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

  const wrapper =
    "min-h-screen bg-[#f8f9fb] flex items-start justify-center px-4 py-12";

  /* ═══════════════ LANDING ═══════════════ */

  if (step === "landing") {
    return (
      <main className="min-h-screen bg-[#f8f9fb] flex items-center justify-center px-4">
        <div className="max-w-xl w-full text-center space-y-10">
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
                onClick={() => setStep("account-check")}
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
                onClick={() => setStep("postgen")}
                className={`group text-left p-6 rounded-2xl border-2 transition-all ${
                  isPaid
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
                      {!isPaid && (
                        <span className="text-[10px] font-semibold bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">
                          결제 후 이용
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">
                      이미지를 업로드하면 AI가 게시물을 완성해드립니다
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

  if (step === "account-check") {
    return (
      <main className="min-h-screen bg-[#f8f9fb] flex items-center justify-center px-4">
        <div className="max-w-xl w-full text-center space-y-8">
          <button
            onClick={() => setStep("landing")}
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
                setStep("input");
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
                setStep("input");
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

  if (step === "input") {
    return (
      <main className={wrapper}>
        <div className="max-w-xl w-full space-y-6">
          <button
            onClick={() => setStep("account-check")}
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
                placeholder="@username"
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

  if (step === "result") {
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
            onClick={() => setStep("input")}
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
                {aiSource === "api" ? "API 결과" : "fallback"}
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
              onClick={() => setStep("input")}
              className="py-4 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              다시 기획하기
            </button>
            <button
              onClick={() => {
                if (hasAccount) {
                  // Has account → go straight to payment
                  setFinalInstagramId(instagramId);
                  setCompletionDate(getDefaultCompletionDate(selectedDuration));
                  setStep("payment");
                } else {
                  // No account → show username recommendations
                  setStep("names");
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

  if (step === "names") {
    return (
      <main className={wrapper}>
        <div className="max-w-2xl w-full space-y-6">
          <button
            onClick={() => setStep("result")}
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
                {aiSource === "api" ? "API 결과" : "fallback"}
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
              onClick={() => setStep("result")}
              className="py-4 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              이전으로
            </button>
            <button
              onClick={() => setStep("confirm")}
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

  if (step === "confirm") {
    return (
      <main className={wrapper}>
        <div className="max-w-xl w-full space-y-6">
          <button
            onClick={() => setStep("names")}
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
            <div className="flex flex-wrap gap-2">
              {aiResult?.accountNames.map((item, i) => (
                <span
                  key={i}
                  className="text-sm bg-gray-50 text-gray-700 px-3 py-1.5 rounded-lg font-medium"
                >
                  @{item.name}
                </span>
              ))}
            </div>
          </Card>

          <Card className="space-y-4">
            <InputField
              label="최종 인스타그램 아이디"
              value={finalInstagramId}
              onChange={setFinalInstagramId}
              placeholder="@your_account"
              required
            />
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setStep("names")}
              className="py-4 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              이전으로
            </button>
            <button
              onClick={() => {
                setCompletionDate(getDefaultCompletionDate(selectedDuration));
                setStep("payment");
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

  if (step === "payment") {
    const price = getPrice(selectedPlan, selectedDuration);

    return (
      <main className={wrapper}>
        <div className="max-w-2xl w-full space-y-6">
          <button
            onClick={() => {
              if (hasAccount) setStep("result");
              else setStep("confirm");
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
              플랜을 선택하고 결제를 진행해주세요
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
                <p className="font-bold text-gray-900 text-lg">
                  AI 마케터 1명
                </p>
                <p className="text-sm text-gray-500 mt-1">기본 플랜</p>
                <div className="mt-3 space-y-1 text-sm text-gray-600">
                  <p>한달 결제: 30만원</p>
                  <p>두달 결제: 50만원</p>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-400 mb-1">
                    예상 성과 (±30%)
                  </p>
                  <div className="space-y-0.5 text-xs text-gray-500">
                    <p>댓글 약 30개</p>
                    <p>국내 팔로우 약 500명</p>
                    <p>좋아요 약 300건</p>
                  </div>
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
                <p className="font-bold text-gray-900 text-lg">
                  AI 마케터 2명
                </p>
                <p className="text-sm text-rose-500 font-medium mt-1">
                  파워 플랜
                </p>
                <div className="mt-3 space-y-1 text-sm text-gray-600">
                  <p>한달 결제: 50만원</p>
                  <p>두달 결제: 80만원</p>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs font-semibold text-rose-400 mb-1">
                    2배 빠른 성장
                  </p>
                  <div className="space-y-0.5 text-xs text-gray-500">
                    <p>작업량 2배</p>
                    <p>더 빠른 팔로워 성장</p>
                    <p>더 많은 노출과 댓글</p>
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Duration selection */}
          <div>
            <SectionLabel>이용 기간</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              {[1, 2].map((d) => (
                <button
                  key={d}
                  onClick={() => {
                    setSelectedDuration(d);
                    setCompletionDate(getDefaultCompletionDate(d));
                  }}
                  className={`p-4 rounded-xl border-2 font-medium transition-all ${
                    selectedDuration === d
                      ? "border-rose-500 bg-rose-50/50 text-rose-600"
                      : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                  }`}
                >
                  {d}달권
                </button>
              ))}
            </div>
          </div>

          {/* Completion date picker */}
          <Card className="space-y-3">
            <SectionLabel>완료 예정일</SectionLabel>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">
                마케팅 완료 예정일
              </label>
              <input
                type="date"
                value={completionDate}
                onChange={(e) => setCompletionDate(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-300 transition-colors bg-white"
              />
              <p className="text-xs text-gray-400">
                기본값: 결제일로부터 {selectedDuration}개월 후 · 필요시 변경
                가능
              </p>
            </div>
          </Card>

          {/* Summary */}
          <Card className="bg-gradient-to-br from-gray-900 to-gray-800 border-none text-white space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              결제 요약
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">선택 플랜</span>
                <span className="font-medium">
                  AI 마케터 {selectedPlan}명 · {selectedDuration}달
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">진행 계정</span>
                <span className="font-medium">@{effectiveInstagramId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">완료 예정</span>
                <span className="font-medium">
                  {completionDate ? formatDateKorean(completionDate) : "-"}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-gray-700">
                <span className="text-gray-400">결제 금액</span>
                <span className="text-xl font-bold text-rose-400">
                  {price.toLocaleString()}원
                </span>
              </div>
            </div>
          </Card>

          {/* Bank info */}
          <Card className="space-y-2">
            <SectionLabel>입금 정보</SectionLabel>
            <div className="text-sm space-y-1 text-gray-700">
              <p>
                <span className="text-gray-400">은행:</span> 국민은행
              </p>
              <p>
                <span className="text-gray-400">계좌번호:</span>{" "}
                123-456-789012
              </p>
              <p>
                <span className="text-gray-400">예금주:</span> 회사명
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
              placeholder="hello@example.com"
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
                  placeholder="tax@example.com"
                  type="email"
                />
              </div>
            )}
          </Card>

          <button
            onClick={() => {
              setIsPaid(true);
              setRemainingPosts(getPostLimit(selectedDuration));
              setStep("status");
            }}
            className="w-full py-4 bg-gradient-to-r from-rose-500 to-pink-500 text-white font-semibold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all"
          >
            신청 완료 ({price.toLocaleString()}원 입금 진행하기)
          </button>
        </div>
      </main>
    );
  }

  /* ═══════════════ STATUS ═══════════════ */

  if (step === "status") {
    const statusStages = ["접수됨", "입금 확인중", "진행중", "완료"];
    const currentStage = 0;

    return (
      <main className={wrapper}>
        <div className="max-w-2xl w-full space-y-6">
          {/* Hero */}
          <Card className="text-center space-y-3 py-8">
            <div className="w-16 h-16 bg-gradient-to-br from-rose-400 to-pink-500 rounded-full flex items-center justify-center mx-auto shadow-lg">
              <span className="text-white text-2xl">✓</span>
            </div>
            <h2 className="text-2xl font-bold text-gray-900">
              마케팅 요청이 접수되었습니다
            </h2>
            <p className="text-gray-500 text-sm">
              입금 확인 후 마케팅이 시작됩니다
            </p>
            <div className="inline-block bg-gray-50 rounded-xl px-4 py-2 mt-2">
              <p className="text-sm font-semibold text-gray-900">
                완료 예정: {formatDateKorean(completionDate)}까지
              </p>
            </div>
          </Card>

          {/* Completion note */}
          <Card>
            <p className="text-sm text-gray-600 leading-relaxed">
              해당 기간 동안 마케팅이 진행되며, 결과는 완료일 이전에 제공됩니다.
            </p>
          </Card>

          {/* Progress */}
          <Card>
            <SectionLabel>진행 상태</SectionLabel>
            <div className="flex items-center gap-0 mt-2">
              {statusStages.map((label, i) => (
                <div key={i} className="flex items-center flex-1">
                  <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
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
                  {i < statusStages.length - 1 && (
                    <div
                      className={`flex-1 h-px mx-1 mb-5 ${
                        i < currentStage ? "bg-rose-500" : "bg-gray-200"
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>
          </Card>

          <button
            onClick={() => setStep("landing")}
            className="w-full py-4 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            처음으로 돌아가기
          </button>
        </div>
      </main>
    );
  }

  /* ═══════════════ POST GENERATION (SEPARATE) ═══════════════ */

  if (step === "postgen") {
    return (
      <main className={wrapper}>
        <div className="max-w-2xl w-full space-y-6">
          <button
            onClick={() => setStep("landing")}
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

          {!isPaid ? (
            <Card className="text-center space-y-4 py-10">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
                <span className="text-2xl">🔒</span>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-gray-700 text-lg">
                  결제 후 이용 가능합니다
                </p>
                <p className="text-sm text-gray-500 max-w-sm mx-auto">
                  AI 인스타그램 마케터 서비스 결제 시 게시물 AI 생성 기능이
                  활성화됩니다
                </p>
              </div>
              <button
                onClick={() => setStep("landing")}
                className="mt-2 px-6 py-2.5 bg-gradient-to-r from-rose-500 to-pink-500 text-white font-semibold rounded-xl text-sm shadow-md hover:shadow-lg active:scale-[0.98] transition-all"
              >
                마케팅 서비스 신청하기
              </button>
            </Card>
          ) : (
            <div className="space-y-4">
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <SectionLabel>이미지 업로드</SectionLabel>
                  <span className="text-xs font-semibold text-violet-600 bg-violet-50 px-3 py-1 rounded-full">
                    남은 횟수: {remainingPosts}개
                  </span>
                </div>

                {!uploadedImage ? (
                  <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-2xl py-10 px-4 cursor-pointer hover:border-violet-300 hover:bg-violet-50/30 transition-colors">
                    <div className="text-3xl text-gray-300 mb-2">📷</div>
                    <p className="text-sm font-medium text-gray-500">
                      이미지를 선택하세요
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      JPG, PNG 형식 지원
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </label>
                ) : (
                  <div className="space-y-3">
                    <div className="relative rounded-2xl overflow-hidden border border-gray-100">
                      <img
                        src={uploadedImage}
                        alt="업로드된 이미지"
                        className="w-full max-h-64 object-cover"
                      />
                      <button
                        onClick={() => {
                          setUploadedImage(null);
                          if (fileInputRef.current)
                            fileInputRef.current.value = "";
                        }}
                        className="absolute top-2 right-2 w-8 h-8 bg-black/50 text-white rounded-full flex items-center justify-center text-sm hover:bg-black/70 transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                    <button
                      onClick={handleGeneratePost}
                      disabled={generatingPost || remainingPosts <= 0}
                      className="w-full py-3 bg-gradient-to-r from-violet-500 to-purple-500 text-white font-semibold rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] transition-all disabled:opacity-50"
                    >
                      {generatingPost ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          생성 중...
                        </span>
                      ) : remainingPosts <= 0 ? (
                        "생성 횟수를 모두 사용했습니다"
                      ) : (
                        "게시물 생성하기"
                      )}
                    </button>
                  </div>
                )}
              </Card>

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

              {generatedPosts.map((post, i) => (
                <Card key={i} className="space-y-3">
                  <SectionLabel>
                    생성된 게시물 #{generatedPosts.length - i}
                  </SectionLabel>
                  <div className="rounded-xl overflow-hidden border border-gray-100">
                    <img
                      src={post.imagePreview}
                      alt="게시물 이미지"
                      className="w-full max-h-48 object-cover"
                    />
                  </div>
                  <div className="p-3 bg-gray-50 rounded-xl space-y-2">
                    <div>
                      <span className="text-xs text-gray-400">주제</span>
                      <p className="text-sm font-medium text-gray-800">
                        {post.topic}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400">내용</span>
                      <p className="text-sm text-gray-700 leading-relaxed">
                        {post.content}
                      </p>
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
                </Card>
              ))}
            </div>
          )}
        </div>
      </main>
    );
  }

  return null;
}
