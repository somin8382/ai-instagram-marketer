"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";
import {
  fetchMyPageSnapshot,
  syncProfileAndLinkData,
  type MyPageSnapshot,
  type SavedGeneratedPost,
} from "@/lib/supabase/persistence";

const AUTH_STORAGE_KEY = "qmeet-auth-state";
const APPLICATION_STAGES = ["접수됨", "입금 확인중", "진행중", "완료"] as const;

const EMPTY_SNAPSHOT: MyPageSnapshot = {
  application: null,
  payment: null,
  posts: [],
  usage: {
    freeTrialUsed: false,
    remainingPostCount: 0,
    totalPostLimit: 0,
    usedPaidPostCount: 0,
  },
};

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

function formatDateKorean(dateStr?: string | null) {
  if (!dateStr) return "미정";

  const date = new Date(dateStr);

  if (Number.isNaN(date.getTime())) {
    return dateStr;
  }

  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function formatPrice(amount?: number | null) {
  if (typeof amount !== "number") return "미정";
  return `${amount.toLocaleString()}원`;
}

function getPlanLabel(plan?: number | null) {
  if (plan === 2) return "AI 마케터 2명";
  if (plan === 1) return "AI 마케터 1명";
  return "선택 정보 없음";
}

function getDurationLabel(duration?: number | null) {
  if (duration === 2) return "2개월 운영";
  if (duration === 1) return "1개월 운영";
  return "선택 정보 없음";
}

function getExpressLabel(isExpress?: boolean) {
  return isExpress ? "급행 진행" : "일반 진행";
}

function getApplicationStageIndex(status?: string | null) {
  switch (status) {
    case "waiting_for_payment":
    case "payment_pending":
      return 1;
    case "in_progress":
    case "processing":
    case "active":
      return 2;
    case "completed":
    case "done":
      return 3;
    case "received":
    case "submitted":
    case "pending":
    default:
      return 0;
  }
}

function getPaymentStatusLabel(status?: string | null) {
  return status === "confirmed" ? "입금 확인 완료" : "입금 확인중";
}

function buildGeneratedPostSignature(post: SavedGeneratedPost) {
  return [
    post.id.trim(),
    post.title.trim(),
    post.content.trim(),
    post.imageUrl.trim(),
    post.hashtags.trim(),
  ].join("::");
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center">
      <p className="text-sm font-semibold text-gray-700">{title}</p>
      <p className="mt-2 text-sm text-gray-500 leading-relaxed">{description}</p>
    </div>
  );
}

export default function MyPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<MyPageSnapshot>(EMPTY_SNAPSHOT);

  async function handleCopy(fieldKey: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(fieldKey);
      window.setTimeout(() => {
        setCopiedField((current) => (current === fieldKey ? null : current));
      }, 1800);
    } catch {
      setErrorMessage("복사에 실패했습니다. 다시 시도해주세요.");
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

    router.replace("/");
  }

  useEffect(() => {
    const supabase = getSupabaseBrowserClientOrNull();

    if (!supabase) {
      router.replace("/auth?redirect=landing&tab=login");
      return;
    }

    let active = true;

    const loadSnapshot = async (userOverride?: User) => {
      if (!active) return;

      setLoading(true);

      try {
        let user = userOverride;

        if (!user) {
          const {
            data: { user: currentUser },
          } = await supabase.auth.getUser();
          user = currentUser ?? undefined;
        }

        if (!active) return;

        if (!user) {
          router.replace("/auth?redirect=landing&tab=login");
          return;
        }

        const authResult = await syncProfileAndLinkData({ user });

        if (!active) return;

        setAuthName(authResult.snapshot.authName);
        setAuthEmail(authResult.snapshot.authEmail);

        const dashboardResult = await fetchMyPageSnapshot({
          userId: authResult.snapshot.userId,
          email: authResult.snapshot.authEmail,
        });

        if (!active) return;

        setSnapshot(dashboardResult.snapshot);
        setErrorMessage(dashboardResult.error);
      } catch (error) {
        if (!active) return;

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "마이페이지 정보를 불러오지 못했습니다."
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadSnapshot();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;

      if (!session?.user) {
        router.replace("/auth?redirect=landing&tab=login");
        return;
      }

      void loadSnapshot(session.user);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  const currentStage = getApplicationStageIndex(snapshot.application?.status);

  return (
    <main className="min-h-screen bg-[#f8f9fb] px-4 py-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => router.push("/")}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-1"
          >
            ← 홈으로
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500 bg-white border border-gray-200 px-3 py-1.5 rounded-full">
              {authName
                ? `${authName}님`
                : authEmail
                  ? authEmail
                  : "내 계정"}
            </span>
            <button
              onClick={handleLogout}
              className="text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
            >
              로그아웃
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 bg-rose-50 text-rose-600 text-xs font-semibold px-4 py-1.5 rounded-full border border-rose-100">
            마이페이지
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-900">
            내 상태와 결과를 한눈에 확인하세요
          </h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            진행 상태, 결제 상태, 생성 결과, 현재 이용 현황을 바로 볼 수
            있습니다.
          </p>
        </div>

        {loading ? (
          <Card className="text-center py-12">
            <div className="w-10 h-10 border-4 border-rose-200 border-t-rose-500 rounded-full animate-spin mx-auto" />
            <p className="mt-4 text-sm text-gray-500">
              마이페이지 정보를 불러오는 중입니다...
            </p>
          </Card>
        ) : (
          <>
            {errorMessage && (
              <Card className="bg-red-50 border-red-100">
                <p className="text-sm font-medium text-red-600">{errorMessage}</p>
              </Card>
            )}

            <Card className="space-y-5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <SectionLabel>진행 상태</SectionLabel>
                  <h2 className="text-xl font-bold text-gray-900">
                    현재 진행 흐름
                  </h2>
                  <p className="text-sm text-gray-500">
                    신청 이후 어디까지 진행됐는지 바로 확인할 수 있습니다.
                  </p>
                </div>
                {snapshot.application && (
                  <span className="text-xs font-semibold bg-rose-50 text-rose-600 px-3 py-1.5 rounded-full border border-rose-100">
                    {APPLICATION_STAGES[currentStage]}
                  </span>
                )}
              </div>

              {snapshot.application ? (
                <>
                  <div className="grid grid-cols-4 gap-3 items-start">
                    {APPLICATION_STAGES.map((label, index) => (
                      <div
                        key={label}
                        className="relative flex flex-col items-center gap-1.5"
                      >
                        {index < APPLICATION_STAGES.length - 1 && (
                          <div
                            className={`absolute top-4 left-1/2 w-full h-px ${
                              index < currentStage ? "bg-rose-500" : "bg-gray-200"
                            }`}
                          />
                        )}
                        <div className="relative z-10 flex flex-col items-center gap-1.5 bg-white px-1">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                              index === currentStage
                                ? "bg-gradient-to-r from-rose-500 to-pink-500 text-white ring-4 ring-rose-100"
                                : index < currentStage
                                  ? "bg-rose-500 text-white"
                                  : "bg-gray-100 text-gray-400"
                            }`}
                          >
                            {index < currentStage ? "✓" : index + 1}
                          </div>
                          <span
                            className={`text-[10px] text-center leading-tight ${
                              index <= currentStage
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

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    {[
                      {
                        label: "선택 플랜",
                        value: getPlanLabel(snapshot.application.selectedPlan),
                      },
                      {
                        label: "운영 기간",
                        value: getDurationLabel(snapshot.application.selectedDuration),
                      },
                      {
                        label: "급행 여부",
                        value: getExpressLabel(snapshot.application.isExpress),
                      },
                      {
                        label: "신청일",
                        value: formatDateKorean(snapshot.application.createdAt),
                      },
                      {
                        label: "완료 예정일",
                        value: formatDateKorean(snapshot.application.completionDate),
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4"
                      >
                        <p className="text-xs font-semibold text-gray-400">
                          {item.label}
                        </p>
                        <p className="mt-2 text-sm font-semibold text-gray-900 leading-relaxed">
                          {item.value}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState
                  title="아직 신청 내역이 없습니다"
                  description="서비스를 신청하면 이곳에서 진행 상태와 운영 정보를 확인할 수 있습니다."
                />
              )}
            </Card>

            <Card className="space-y-5">
              <div className="space-y-1">
                <SectionLabel>결제 상태</SectionLabel>
                <h2 className="text-xl font-bold text-gray-900">
                  입금 확인 현황
                </h2>
                <p className="text-sm text-gray-500">
                  결제 금액과 입금 확인 상태를 확인할 수 있습니다.
                </p>
              </div>

              {snapshot.payment ? (
                <>
                  <div className="rounded-2xl bg-gradient-to-r from-rose-500 to-pink-500 text-white px-5 py-5">
                    <p className="text-xs font-semibold text-white/80">결제 금액</p>
                    <p className="mt-2 text-3xl font-extrabold tracking-tight">
                      {formatPrice(snapshot.payment.expectedAmount)}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      {
                        label: "입금자명",
                        value: snapshot.payment.depositorName || "미입력",
                      },
                      {
                        label: "현재 상태",
                        value: getPaymentStatusLabel(snapshot.payment.paymentStatus),
                      },
                      {
                        label: "확인 시점",
                        value: snapshot.payment.confirmedAt
                          ? formatDateKorean(snapshot.payment.confirmedAt)
                          : "확인 대기중",
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4"
                      >
                        <p className="text-xs font-semibold text-gray-400">
                          {item.label}
                        </p>
                        <p className="mt-2 text-sm font-semibold text-gray-900 leading-relaxed">
                          {item.value}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <EmptyState
                  title="아직 결제 정보가 없습니다"
                  description="신청이 접수되면 결제 금액과 입금 확인 상태가 이곳에 표시됩니다."
                />
              )}
            </Card>

            <Card className="space-y-5">
              <div className="space-y-1">
                <SectionLabel>이용 현황</SectionLabel>
                <h2 className="text-xl font-bold text-gray-900">
                  현재 사용 가능 상태
                </h2>
                <p className="text-sm text-gray-500">
                  무료 체험 사용 여부와 남은 생성 횟수를 확인할 수 있습니다.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
                  <p className="text-xs font-semibold text-gray-400">
                    무료 체험
                  </p>
                  <p className="mt-2 text-lg font-bold text-gray-900">
                    {snapshot.usage.freeTrialUsed
                      ? "무료 체험 사용 완료"
                      : "무료 체험 미사용"}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                    무료 체험 게시물 생성 여부를 기준으로 표시됩니다.
                  </p>
                </div>
                <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
                  <p className="text-xs font-semibold text-gray-400">
                    남은 생성 횟수
                  </p>
                  <p className="mt-2 text-lg font-bold text-gray-900">
                    {snapshot.usage.remainingPostCount}회
                  </p>
                  <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                    사용 {snapshot.usage.usedPaidPostCount}회 / 전체{" "}
                    {snapshot.usage.totalPostLimit}회 기준입니다.
                  </p>
                </div>
              </div>
            </Card>

            <Card className="space-y-5">
              <div className="space-y-1">
                <SectionLabel>생성된 게시물</SectionLabel>
                <h2 className="text-xl font-bold text-gray-900">
                  내가 만든 결과
                </h2>
                <p className="text-sm text-gray-500">
                  생성한 게시물을 다시 확인하고 복사하거나 다운로드할 수 있습니다.
                </p>
              </div>

              {snapshot.posts.length === 0 ? (
                <EmptyState
                  title="아직 생성된 게시물이 없습니다"
                  description="게시물을 생성하면 이미지, 제목, 내용, 해시태그가 이곳에 저장됩니다."
                />
              ) : (
                <div className="space-y-4">
                  {snapshot.posts.map((post, index) => {
                    const postKey = buildGeneratedPostSignature(post);

                    return (
                      <Card key={postKey} className="space-y-3 border-gray-100">
                        <SectionLabel>
                          생성된 게시물 #{snapshot.posts.length - index}
                        </SectionLabel>
                        <div className="grid grid-cols-1 md:grid-cols-[260px,1fr] gap-4 items-start">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-gray-900">
                                  정사각형 피드 이미지
                                </p>
                                <p className="text-xs text-gray-500">
                                  저장된 게시물 이미지 미리보기
                                </p>
                              </div>
                              <a
                                href={post.imageUrl}
                                download={`인스타그램-게시물-${snapshot.posts.length - index}.png`}
                                className="inline-flex items-center justify-center px-3 py-2 text-xs font-semibold rounded-lg bg-violet-50 text-violet-600 hover:bg-violet-100 transition-colors"
                              >
                                이미지 다운로드
                              </a>
                            </div>
                            <div className="relative max-w-[260px] w-full rounded-xl overflow-hidden border border-gray-100 aspect-square bg-gray-50 mx-auto md:mx-0 shadow-sm">
                              <Image
                                src={post.imageUrl}
                                alt="생성된 게시물 이미지"
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
                                  {copiedField === `title-${postKey}`
                                    ? "복사됨"
                                    : "제목 복사"}
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
                                <span className="text-xs text-gray-400">
                                  해시태그
                                </span>
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
                                {post.hashtags.split(" ").map((tag) => (
                                  <span
                                    key={`${postKey}-${tag}`}
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
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
