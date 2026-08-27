"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";
import {
  getKoreaDateString,
  POST_GENERATOR_MONTHLY_CREDITS,
  POST_GENERATOR_MONTHLY_PRICE,
} from "@/lib/post-generator/subscription";
import {
  fetchMyPageSnapshot,
  syncProfileAndLinkData,
  type MonthlyPerformance,
  type MyPageSnapshot,
  type PrepaidEntry,
  type UserNotice,
  type SavedGeneratedPost,
} from "@/lib/supabase/persistence";
import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { Megaphone } from "@phosphor-icons/react/dist/csr/Megaphone";
import { MagicWand } from "@phosphor-icons/react/dist/csr/MagicWand";
import { clearSignedInCookie } from "@/lib/ui/auth-cookie-sync";
import { AppSurface, ThemeToggle } from "@/lib/ui/theme";
import { trackLoginEventOnce } from "@/lib/client/track-login";
import { CreditGrantPopup } from "@/lib/ui/credit-grant-popup";
import { AugustMarketingPopup } from "@/lib/ui/august-marketing-popup";
import {
  clearTestAccountAccess,
  fetchTestAccountAccess,
  isTestAccountUser,
  TEST_ACCOUNT_AUTH_ID,
  TEST_ACCOUNT_DEFAULT_REMAINING_POSTS,
  TEST_ACCOUNT_NAME,
  TEST_ACCOUNT_USER_ID,
} from "@/lib/mock-account";

const AUTH_STORAGE_KEY = "qmeet-auth-state";
const APP_STORAGE_KEY = "qmeet-app-state";
const APPLICATION_STAGES = ["접수됨", "입금 확인중", "진행중", "완료"] as const;
const EMPTY_SNAPSHOT: MyPageSnapshot = {
  application: null,
  payment: null,
  subscription: null,
  posts: [],
  usage: {
    freeTrialUsed: false,
    hasActiveSubscription: false,
    remainingPostCount: 0,
    totalPostLimit: 0,
    usedPaidPostCount: 0,
    dailyLimit: 0,
    dailyRemainingCount: 0,
    dailyUsageCount: 0,
  },
  performances: [],
  notices: [],
  prepaidBalance: null,
  prepaidEntries: [],
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

function getPrice(plan: number, duration: number): number {
  if (plan === 1 && duration === 1) return 330000;
  if (plan === 1 && duration === 2) return 660000;
  if (plan === 2 && duration === 1) return 610000;
  if (plan === 2 && duration === 2) return 1220000;
  return 330000;
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
  actions,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center">
      <p className="text-sm font-semibold text-gray-700">{title}</p>
      <p className="mt-2 text-sm text-gray-500 leading-relaxed">{description}</p>
      {actions ? <div className="mt-4">{actions}</div> : null}
    </div>
  );
}

type ServiceGrantData = {
  ai_marketer: boolean;
  ai_generator: boolean;
  marketer_months: string | null;
  generator_months: string | null;
  // 기관이 부여한 마케터 수량. 성과 목표치의 기준이 된다
  // (미결제 신청서의 selected_plan보다 이 값이 우선).
  marketer_quantity: number | null;
};

function parseMonthsList(months: string | null | undefined): number[] {
  if (!months) return [];
  return months
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 12);
}

function getEarliestFutureMonth(months: number[], currentMonth: number) {
  return months
    .filter((month) => month > currentMonth)
    .sort((a, b) => a - b)[0];
}

// ── 마케터 카드 헬퍼 ──────────────────────────────────────────────────────────

// 마케터 1명 · 1개월 기준 목표치. 이용 개월 수는 곱하지 않는다.
// 한 채널에 마케터가 여러 명 붙으면 그 수만큼 목표가 올라간다
// (인스타 1계정에 2명 → 팔로워 1,000).
//   인스타그램 팔로워 500 · 좋아요 100 · 댓글 30
//   유튜브     구독자 200 · 조회수 1,000 · 댓글 10
const MONTHLY_GOAL_BASE = {
  instagram: { followers: 500, engagement: 100, comments: 30 },
  youtube: { followers: 200, engagement: 1000, comments: 10 },
} as const;

// 해당 월 예상 성과. 목표는 '채널 1개당 고정'이다 — 인스타 팔로워 500,
// 유튜브 구독자 200. 신청 수량이나 이용 개월 수를 곱하지 않는다.
// (수량이 2면 채널이 2개인 것이고, 각 채널이 이 기준을 따른다.)
function getMonthlyOutcome(
  platform: "instagram" | "youtube",
  marketerCount = 1
): Array<{ label: string; text: string }> {
  const base = MONTHLY_GOAL_BASE[platform];
  const n = marketerCount > 0 ? marketerCount : 1;
  const isYoutube = platform === "youtube";
  return [
    {
      label: isYoutube ? "구독자" : "팔로워",
      text: `${(base.followers * n).toLocaleString()}명`,
    },
    {
      label: isYoutube ? "조회수" : "좋아요",
      text: `${(base.engagement * n).toLocaleString()}${isYoutube ? "회" : "개"} 이상`,
    },
    { label: "댓글", text: `${(base.comments * n).toLocaleString()}개 이상` },
  ];
}

function buildAccountUrl(
  channel: string | null,
  channelUrl: string | null,
  instagramId: string | null
): string | null {
  if (channelUrl?.trim()) return channelUrl.trim();
  if (channel !== "youtube" && instagramId?.trim()) {
    return `https://www.instagram.com/${instagramId.trim().replace(/^@/, "")}`;
  }
  return null;
}

function buildDisplayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

// 월(m)이 현재월 기준으로 진행중/예정/종료인지.
function monthStatusBadge(m: number, currentMonth: number) {
  if (m === currentMonth)
    return { label: "진행중", cls: "bg-emerald-50 text-emerald-700" };
  if (m > currentMonth)
    return { label: "진행 예정", cls: "bg-amber-50 text-amber-700" };
  return { label: "종료", cls: "bg-gray-100 text-gray-500" };
}

// 월별 마케팅 정보(채널·메인 게시물) 한 블록. 마이페이지 마케터 카드에서
// 7월·8월을 각각 표기하기 위해 재사용한다.
type PlatformInfo = {
  platform: "youtube" | "instagram";
  accountUrl: string | null;
  contentUrl: string | null;
};

// 한 달의 마케팅 정보. 유튜브·인스타그램을 함께 운영하면 두 묶음이 나란히 뜬다.
// 신청은 했지만 아직 주소가 없는 플랫폼은 "준비 중"으로 표시한다.
function MonthMarketingBlock({
  title,
  badge,
  platforms,
  emptyNote,
}: {
  title: string;
  badge: { label: string; cls: string } | null;
  platforms: PlatformInfo[];
  emptyNote: string;
}) {
  const shown = platforms.filter((p) => p.accountUrl || p.contentUrl);
  const pending = platforms.filter((p) => !p.accountUrl && !p.contentUrl);
  const row = (label: string, url: string | null) => (
    <div key={label} className="flex items-center gap-3 px-4 py-3">
      <span className="w-24 shrink-0 text-sm text-gray-500">{label}</span>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={url}
          className="min-w-0 flex-1 truncate text-right text-sm font-medium text-blue-600 hover:underline"
        >
          {buildDisplayUrl(url)}
        </a>
      ) : (
        <span className="ml-auto text-sm text-gray-400">-</span>
      )}
    </div>
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100">
      <div className="flex items-center justify-between bg-gray-50 px-4 py-2.5">
        <span className="text-sm font-semibold text-gray-700">{title}</span>
        {badge && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.cls}`}>
            {badge.label}
          </span>
        )}
      </div>
      {shown.length ? (
        <div className="divide-y divide-gray-100">
          {shown.map((p) => {
            const isYoutube = p.platform === "youtube";
            return (
              <div key={p.platform}>
                {platforms.length > 1 && (
                  <p className="bg-gray-50/60 px-4 py-1.5 text-[11px] font-semibold text-gray-500">
                    {isYoutube ? "유튜브" : "인스타그램"}
                  </p>
                )}
                {row(isYoutube ? "채널 주소" : "계정 주소", p.accountUrl)}
                {row(isYoutube ? "메인 영상" : "메인 게시물", p.contentUrl)}
              </div>
            );
          })}
          {pending.map((p) => (
            <div
              key={p.platform}
              className="flex items-center gap-3 px-4 py-3"
            >
              <span className="w-24 shrink-0 text-sm text-gray-500">
                {p.platform === "youtube" ? "유튜브" : "인스타그램"}
              </span>
              <span className="ml-auto text-sm text-amber-600">준비 중</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="px-4 py-3 text-sm text-gray-400">{emptyNote}</p>
      )}
    </div>
  );
}

function formatPerformanceMonth(month: string): string {
  const [year, rawMonth] = month.split("-");
  const monthNumber = Number(rawMonth);
  if (!year || !Number.isFinite(monthNumber) || monthNumber < 1) return month;
  const thisYear = Number(getKoreaDateString().split("-")[0]);
  return Number(year) === thisYear
    ? `${monthNumber}월`
    : `${year}년 ${monthNumber}월`;
}

type PerformanceRow = {
  label: string;
  value: number | null;
  goal: number;
  unit: string;
};

// 월별 달성 성과 카드. 목표 대비 실적을 나란히 보여준다.
// 인스타는 팔로워/좋아요/댓글, 유튜브는 구독자/조회수/댓글.
function MonthlyPerformanceCard({
  performances,
}: {
  performances: MonthlyPerformance[];
}) {
  if (!performances.length) return null;

  return (
    <Card className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          마케팅 성과
        </p>
        <p className="mt-1 text-sm text-gray-500">
          운영이 완료된 달의 목표 대비 결과입니다.
        </p>
      </div>

      <div className="space-y-3">
        {performances.map((performance) => {
          const isYoutube = performance.platform === "youtube";
          const base = isYoutube
            ? MONTHLY_GOAL_BASE.youtube
            : MONTHLY_GOAL_BASE.instagram;
          const monthLabel = formatPerformanceMonth(performance.month);

          const rows: PerformanceRow[] = [
            {
              label: isYoutube ? "구독자" : "팔로워",
              value: performance.followers,
              goal: base.followers,
              unit: "명",
            },
            {
              label: isYoutube ? "조회수" : "좋아요",
              value: isYoutube ? performance.views : performance.likes,
              goal: base.engagement,
              unit: isYoutube ? "회" : "개",
            },
            {
              label: "댓글",
              value: performance.comments,
              goal: base.comments,
              unit: "개",
            },
          ];

          const recorded = rows.filter((row) => row.value !== null);
          const achievedAll =
            recorded.length > 0 &&
            recorded.every((row) => (row.value as number) >= row.goal);
          const exceededCount = recorded.filter(
            (row) => (row.value as number) > row.goal
          ).length;

          const headline = achievedAll
            ? exceededCount > 0
              ? "목표를 초과 달성했어요"
              : "목표를 모두 달성했어요"
            : `${monthLabel} 운영 결과입니다`;

          return (
            <div
              key={`${performance.month}-${performance.platform}`}
              className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                  {monthLabel} 성과
                </span>
                <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-gray-600">
                  {isYoutube ? "유튜브" : "인스타그램"}
                </span>
                {achievedAll && (
                  <span className="ml-auto rounded-full bg-emerald-600/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                    {exceededCount > 0 ? "초과 달성" : "목표 달성"}
                  </span>
                )}
              </div>

              <p className="mt-3 text-[15px] font-bold text-gray-900">
                {headline}
              </p>

              <div className="mt-3 space-y-2.5">
                {rows.map((row) => {
                  const value = row.value;
                  const over = value !== null && value > row.goal;
                  const met = value !== null && value >= row.goal;
                  // 막대 전체 길이는 '목표'와 '실적' 중 큰 값을 기준으로 잡는다.
                  // 목표를 넘겼으면 목표 지점에 눈금이 서고, 그 오른쪽이 초과분이 된다.
                  const scale = Math.max(value ?? 0, row.goal);
                  const goalPct = (row.goal / scale) * 100;
                  const valuePct = ((value ?? 0) / scale) * 100;
                  const percent =
                    value === null ? null : Math.round((value / row.goal) * 100);

                  return (
                    <div key={row.label}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs text-gray-500">{row.label}</span>
                        <span className="text-xs tabular-nums text-gray-500">
                          <b className="text-sm font-bold text-emerald-900">
                            {value === null
                              ? "-"
                              : value.toLocaleString("ko-KR")}
                          </b>
                          <span className="mx-0.5">/</span>
                          {row.goal.toLocaleString("ko-KR")}
                          {row.unit}
                        </span>
                      </div>

                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="relative h-2.5 flex-1 rounded-full bg-white">
                          {/* 목표까지의 구간 */}
                          <div
                            className={`absolute inset-y-0 left-0 rounded-full ${met ? "bg-emerald-500" : "bg-emerald-300"}`}
                            style={{ width: `${Math.min(valuePct, goalPct)}%` }}
                          />
                          {/* 목표를 넘어선 구간 — 더 진하게 */}
                          {over && (
                            <div
                              className="absolute inset-y-0 rounded-r-full bg-emerald-700"
                              style={{
                                left: `${goalPct}%`,
                                width: `${valuePct - goalPct}%`,
                              }}
                            />
                          )}
                          {/* 목표 지점 눈금 */}
                          {over && (
                            <span
                              className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white"
                              style={{ left: `${goalPct}%` }}
                              aria-hidden="true"
                            />
                          )}
                        </div>
                        {percent !== null && (
                          <span
                            className={`shrink-0 text-[11px] font-bold tabular-nums ${over ? "text-emerald-700" : "text-gray-400"}`}
                          >
                            {percent}%
                          </span>
                        )}
                      </div>

                      {over && (
                        <p className="mt-1 text-[11px] font-semibold tabular-nums text-emerald-700">
                          목표 대비 +{(value - row.goal).toLocaleString("ko-KR")}
                          {row.unit} 초과 달성
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {performance.note && (
                <p className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs leading-relaxed text-gray-600">
                  {performance.note}
                </p>
              )}

              {(performance.channelUrl || performance.postUrl) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {performance.channelUrl && (
                    <a
                      href={performance.channelUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50"
                    >
                      채널 보기
                    </a>
                  )}
                  {performance.postUrl && (
                    <a
                      href={performance.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50"
                    >
                      게시물 보기
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[11px] leading-relaxed text-gray-400">
        ※ 성과는 기록 시점을 기준으로 보수적으로 집계되어, 실제 수치는 기재된
        것보다 높을 수 있습니다. 팔로워·좋아요 등은 실시간으로 변동되므로
        접속하신 시점에 보이는 수치와 다르더라도 양해 부탁드립니다.
      </p>
    </Card>
  );
}

const NOTICE_TONE: Record<
  UserNotice["tone"],
  { card: string; badge: string }
> = {
  success: {
    card: "border-emerald-100 bg-emerald-50/40",
    badge: "bg-emerald-600 text-white",
  },
  warn: {
    card: "border-amber-100 bg-amber-50/50",
    badge: "bg-amber-500 text-white",
  },
  info: {
    card: "border-blue-100 bg-blue-50/40",
    badge: "bg-blue-600 text-white",
  },
};

// 선결제 크레딧 잔액 카드. 1원 = 1크레딧 충전 잔액이며,
// AI 생성기의 '생성 횟수'와는 다른 개념이라 문구로 구분해 준다.
// '결제 이력 보기'로 충전·차감 내역을 펼쳐 볼 수 있다.
const PREPAID_METHOD_LABEL: Record<string, string> = {
  bank_transfer: "계좌이체",
  card: "카드결제",
  other: "기타",
};

function PrepaidBalanceCard({
  balance,
  entries,
}: {
  balance: number | null;
  entries: PrepaidEntry[];
}) {
  const [open, setOpen] = useState(false);
  if (balance === null) return null;

  return (
    <Card className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            선결제 크레딧
          </p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-violet-700">
            {balance.toLocaleString("ko-KR")}
            <span className="ml-1 text-sm font-semibold text-violet-500">
              크레딧
            </span>
          </p>
        </div>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="shrink-0 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-50"
          >
            결제 이력 {open ? "닫기" : `보기 (${entries.length})`}
          </button>
        )}
      </div>

      <p className="text-sm leading-relaxed text-gray-500">
        충전해 두신 잔액입니다. 1원 = 1크레딧이며, 서비스 이용 시 여기서
        차감됩니다. AI 생성기의 생성 횟수와는 별개예요.
      </p>

      {open && (
        <div className="overflow-hidden rounded-xl border border-gray-100">
          {entries.map((entry, index) => (
            <div
              key={`${entry.occurredOn}-${index}`}
              className="flex items-start justify-between gap-3 border-t border-gray-100 px-3.5 py-2.5 first:border-t-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800">
                  {entry.kind === "charge"
                    ? "충전"
                    : entry.kind === "deduct"
                      ? "차감"
                      : "조정"}
                  {entry.method && (
                    <span className="ml-1.5 text-xs font-normal text-gray-400">
                      {PREPAID_METHOD_LABEL[entry.method] ?? entry.method}
                    </span>
                  )}
                </p>
                {entry.memo && (
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {entry.memo}
                  </p>
                )}
                <p className="mt-0.5 text-[11px] text-gray-400">
                  {entry.occurredOn}
                </p>
              </div>
              <span
                className={`shrink-0 text-sm font-bold tabular-nums ${entry.amount >= 0 ? "text-violet-700" : "text-red-600"}`}
              >
                {entry.amount >= 0 ? "+" : ""}
                {entry.amount.toLocaleString("ko-KR")}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// 관리자가 넣은 상시 안내 카드 (결제 확인, 진행 보류 등).
function UserNoticeCards({ notices }: { notices: UserNotice[] }) {
  if (!notices.length) return null;
  return (
    <div className="space-y-3">
      {notices.map((notice, index) => {
        const tone = NOTICE_TONE[notice.tone];
        return (
          <div
            key={`${notice.title}-${index}`}
            className={`rounded-2xl border p-4 ${tone.card}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone.badge}`}
              >
                {notice.title}
              </span>
              {notice.month && (
                <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-medium text-gray-600">
                  {formatPerformanceMonth(notice.month)}
                </span>
              )}
            </div>
            {notice.body && (
              <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                {notice.body}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function getCompletionDateText(
  completionDate: string | null | undefined,
  currentMonth: number,
  lastDay: number
): string {
  if (completionDate) {
    const d = new Date(completionDate);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getMonth() + 1}월 ${d.getDate()}일 완료된 성과를 공유드립니다.`;
    }
  }
  if (currentMonth && lastDay) {
    return `${currentMonth}월 ${lastDay}일 완료된 성과를 공유드립니다.`;
  }
  return "운영 완료 후 성과를 공유드립니다.";
}

export default function MyPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshSeed] = useState(0);
  const [startingSubscription] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authUserId, setAuthUserId] = useState("");
  const [hasTestAccess, setHasTestAccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<MyPageSnapshot>(EMPTY_SNAPSHOT);
  const [serviceGrantState, setServiceGrantState] = useState<
    | { status: "idle" }
    | { status: "none" }
    | {
        status: "ready";
        grant: ServiceGrantData;
        mainContentUrl: string | null;
        marketingChannel: string | null;
        channelUrl: string | null;
        instagramId: string | null;
        currentMonth: number;
        // 8월 마케팅 변경 폼(monthly_channel_info)으로 따로 입력한 8월 정보.
        // 없으면(그대로 진행/신규 8월 신청자) 신청서(applications) 정보로 대체한다.
        august: {
          channel: string | null;
          channelUrl: string | null;
          mainContentUrl: string | null;
          // 한 달에 두 플랫폼을 함께 운영하는 경우를 위해 플랫폼별로 따로 둔다.
          youtubeChannelUrl: string | null;
          youtubeContentUrl: string | null;
          instagramChannelUrl: string | null;
          instagramContentUrl: string | null;
          youtubeMarketerCount: number | null;
          instagramMarketerCount: number | null;
        } | null;
      }
  >({ status: "idle" });
  const isTestAccountAuthenticated =
    hasTestAccess && isTestAccountUser(authUserId, authEmail);

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
    await clearTestAccountAccess();

    const supabase = getSupabaseBrowserClientOrNull();

    if (supabase) {
      clearSignedInCookie();
      await supabase.auth.signOut();
    }

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    }

    setAuthUserId("");
    setHasTestAccess(false);
    router.replace("/");
  }

  async function handleStartSubscription() {
    if (!authUserId || startingSubscription) {
      return;
    }

    if (snapshot.usage.hasActiveSubscription) {
      router.push("/tools");
      return;
    }

    router.push("/tools?screen=postsub-payment");
  }

  function handleStartMarketerSetup() {
    if (typeof window !== "undefined") {
      try {
        const rawAppState = window.localStorage.getItem(APP_STORAGE_KEY);
        const parsedAppState = rawAppState
          ? (JSON.parse(rawAppState) as Record<string, unknown>)
          : {};

        window.localStorage.setItem(
          APP_STORAGE_KEY,
          JSON.stringify({
            ...parsedAppState,
            step: "channel",
          })
        );
      } catch {
        window.localStorage.setItem(
          APP_STORAGE_KEY,
          JSON.stringify({ step: "channel" })
        );
      }
    }

    router.push("/");
  }

  useEffect(() => {
    let active = true;
    let authSubscription: { unsubscribe: () => void } | null = null;

    const loadSnapshot = async () => {
      const testAccessEnabled = await fetchTestAccountAccess();

      if (!active) return;

      setHasTestAccess(testAccessEnabled);

      if (typeof window !== "undefined") {
        try {
          const rawAuthState = window.localStorage.getItem(AUTH_STORAGE_KEY);
          const rawAppState = window.localStorage.getItem(APP_STORAGE_KEY);
          const parsedAuth = rawAuthState
            ? (JSON.parse(rawAuthState) as {
                isAuthenticated?: boolean;
                authEmail?: string;
                authName?: string;
                userId?: string;
              })
            : null;

          const parsedIsTestAccount = isTestAccountUser(
            parsedAuth?.userId,
            parsedAuth?.authEmail
          );

          if (
            testAccessEnabled &&
            (parsedIsTestAccount || !parsedAuth?.isAuthenticated)
          ) {
            const parsedApp = rawAppState
              ? (JSON.parse(rawAppState) as {
                  selectedPlan?: number;
                  selectedDuration?: number;
                  isExpress?: boolean;
                  completionDate?: string;
                  freeTrialUsed?: boolean;
                  remainingPosts?: number;
                })
              : null;
            const remainingCredits =
              typeof parsedApp?.remainingPosts === "number" &&
              parsedApp.remainingPosts >= 0
                ? parsedApp.remainingPosts
                : TEST_ACCOUNT_DEFAULT_REMAINING_POSTS;

            setAuthName(
              parsedIsTestAccount && parsedAuth?.authName
                ? parsedAuth.authName
                : TEST_ACCOUNT_NAME
            );
            setAuthEmail(
              parsedIsTestAccount && parsedAuth?.authEmail
                ? parsedAuth.authEmail
                : TEST_ACCOUNT_AUTH_ID
            );
            setAuthUserId(
              parsedIsTestAccount && parsedAuth?.userId
                ? parsedAuth.userId
                : TEST_ACCOUNT_USER_ID
            );
            setSnapshot({
              // AI 마케터는 신규 유저와 동일하게 "아직 신청 내역이 없습니다"로
              // 시작한다. 심사위원이 채널 선택부터 결제 화면까지 직접
              // 입력해볼 수 있어야 하므로 신청·결제를 미리 완료된 것처럼
              // 꾸미지 않는다. 게시물 AI 생성기만 구독 활성 상태로 미리 열어
              // 둔다(아래 usage).
              application: null,
              payment: null,
              subscription: null,
              posts: [],
              usage: {
                freeTrialUsed: Boolean(parsedApp?.freeTrialUsed),
                hasActiveSubscription: true,
                remainingPostCount: remainingCredits,
                totalPostLimit: POST_GENERATOR_MONTHLY_CREDITS,
                usedPaidPostCount: Math.max(
                  POST_GENERATOR_MONTHLY_CREDITS - remainingCredits,
                  0
                ),
                dailyLimit: 0,
                dailyRemainingCount: 0,
                dailyUsageCount: 0,
              },
              performances: [],
              notices: [],
              prepaidBalance: null,
              prepaidEntries: [],
            });
            setErrorMessage(null);
            setLoading(false);
            return;
          }
        } catch {
          // Ignore parse errors and continue with default auth flow.
        }
      }

      const supabase = getSupabaseBrowserClientOrNull();

      if (!supabase) {
        router.replace("/auth?redirect=landing&tab=login");
        return;
      }

      const runSnapshotLoad = async (userOverride?: User) => {
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

          // Returning persisted session that skipped /auth — deduped per browser session
          trackLoginEventOnce(user.id, user.email, "visit");

          const authResult = await syncProfileAndLinkData({ user });

          if (!active) return;

          setAuthName(authResult.snapshot.authName);
          setAuthEmail(authResult.snapshot.authEmail);
          setAuthUserId(authResult.snapshot.userId);

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
          setAuthUserId("");
        } finally {
          if (active) {
            setLoading(false);
          }
        }
      };

      await runSnapshotLoad();

      if (!active) {
        return;
      }

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!active) return;

        if (!session?.user) {
          router.replace("/auth?redirect=landing&tab=login");
          return;
        }

        void runSnapshotLoad(session.user);
      });

      authSubscription = subscription;
    };

    void loadSnapshot();

    return () => {
      active = false;
      authSubscription?.unsubscribe();
    };
  }, [router, refreshSeed]);

  useEffect(() => {
    if (!authEmail) return;

    const supabase = getSupabaseBrowserClientOrNull();
    if (!supabase) return;

    let active = true;

    const fetchGrant = async () => {
      // RLS restricts to own row: lower(email) = lower(auth.email())
      const { data: rawGrant } = await supabase
        .from("service_grants")
        .select(
          "ai_marketer, ai_generator, marketer_months, generator_months, marketer_quantity"
        )
        .maybeSingle();
      // Supabase Insert/Update typed as Record<string,Json> causes select inference
      // to collapse to never — cast explicitly to the fields we need.
      const grant = rawGrant as ServiceGrantData | null;

      if (!active) return;

      if (!grant) {
        setServiceGrantState({ status: "none" });
        return;
      }

      type GrantAppRow = {
        user_id: string | null;
        email: string | null;
        main_content_url: string | null;
        marketing_channel: string | null;
        channel_url: string | null;
        instagram_id: string | null;
        created_at: string | null;
      };

      const normStr = (s?: string | null) => s?.trim().toLowerCase() ?? "";
      const ownEmail = normStr(authEmail);

      // Prefer newest row with main_content_url populated; otherwise newest by created_at.
      const pickGrantRow = (rows: GrantAppRow[]): GrantAppRow | null => {
        if (!rows.length) return null;
        const withContent = rows.filter((r) => !!r.main_content_url?.trim());
        return withContent[0] ?? rows[0];
      };

      // Primary: user_id === authUserId is authoritative — display the row regardless
      // of what the email column contains (email may differ if the form had stale
      // localStorage content at submission time; user_id is the correct ownership signal).
      const { data: rawByUserId } = await supabase
        .from("applications")
        .select("user_id, email, main_content_url, marketing_channel, channel_url, instagram_id, created_at")
        .eq("user_id", authUserId)
        .order("created_at", { ascending: false })
        .limit(5);
      const primaryCandidates = (rawByUserId as GrantAppRow[] ?? []).filter(
        (row) => row.user_id === authUserId
      );
      let appRow: GrantAppRow | null = pickGrantRow(primaryCandidates);

      // Fallback: row was saved with user_id = NULL because the form email differed
      // from the session email at submission time (safeGrantUserId guard in persistence).
      // Safety: ownEmail must be non-empty AND must exactly match the row email after
      // trim+lowercase — this can never surface another user's row.
      if (!appRow && ownEmail) {
        const { data: rawByEmail } = await supabase
          .from("applications")
          .select("user_id, email, main_content_url, marketing_channel, channel_url, instagram_id, created_at")
          .is("user_id", null)
          .ilike("email", ownEmail)
          .order("created_at", { ascending: false })
          .limit(5);
        const emailCandidates = (rawByEmail as GrantAppRow[] ?? []).filter(
          (row) => row.user_id === null && normStr(row.email) === ownEmail
        );
        appRow = pickGrantRow(emailCandidates);
      }

      // 8월 마케팅 변경 폼으로 따로 입력한 8월 채널·게시물 (있을 때만).
      // 컬럼이 아직 없는 환경(마이그레이션 전 배포)에서도 8월 정보가 통째로
      // 사라지지 않도록, 확장 컬럼 조회가 실패하면 기본 컬럼만 다시 읽는다.
      const augSelect = (columns: string) =>
        supabase
          .from("monthly_channel_info")
          .select(columns)
          .eq("user_id", authUserId)
          .eq("month", "2026-08")
          .maybeSingle();

      let augResult = await augSelect(
        "marketing_channel, channel_url, main_content_url, youtube_channel_url, youtube_content_url, instagram_channel_url, instagram_content_url, youtube_marketer_count, instagram_marketer_count"
      );
      if (augResult.error) {
        augResult = await augSelect(
          "marketing_channel, channel_url, main_content_url, youtube_channel_url, youtube_content_url, instagram_channel_url, instagram_content_url"
        );
      }
      if (augResult.error) {
        augResult = await augSelect(
          "marketing_channel, channel_url, main_content_url"
        );
      }
      const rawAug = augResult.data;
      const augRow = rawAug as {
        marketing_channel: string | null;
        channel_url: string | null;
        main_content_url: string | null;
        youtube_channel_url?: string | null;
        youtube_content_url?: string | null;
        instagram_channel_url?: string | null;
        instagram_content_url?: string | null;
        youtube_marketer_count?: number | null;
        instagram_marketer_count?: number | null;
      } | null;

      if (!active) return;

      const koreaDate = getKoreaDateString();
      const [, mo] = koreaDate.split("-").map(Number);
      const currentMonth = mo ?? 7;

      setServiceGrantState({
        status: "ready",
        grant: {
          ai_marketer: grant.ai_marketer,
          ai_generator: grant.ai_generator,
          marketer_months: grant.marketer_months,
          generator_months: grant.generator_months,
          marketer_quantity: grant.marketer_quantity ?? null,
        },
        mainContentUrl: appRow?.main_content_url ?? null,
        marketingChannel: appRow?.marketing_channel ?? null,
        channelUrl: appRow?.channel_url ?? null,
        instagramId: appRow?.instagram_id ?? null,
        currentMonth,
        august: augRow
          ? {
              channel: augRow.marketing_channel,
              channelUrl: augRow.channel_url,
              mainContentUrl: augRow.main_content_url,
              youtubeChannelUrl: augRow.youtube_channel_url ?? null,
              youtubeContentUrl: augRow.youtube_content_url ?? null,
              instagramChannelUrl: augRow.instagram_channel_url ?? null,
              instagramContentUrl: augRow.instagram_content_url ?? null,
              youtubeMarketerCount: augRow.youtube_marketer_count ?? null,
              instagramMarketerCount: augRow.instagram_marketer_count ?? null,
            }
          : null,
      });
    };

    void fetchGrant();

    return () => {
      active = false;
    };
  }, [authEmail, authUserId]);

  const currentStage = getApplicationStageIndex(snapshot.application?.status);

  return (
    <AppSurface accent="rose">
    <main className="relative min-h-screen px-4 py-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/home")}
              className="text-sm font-bold tracking-tight text-gray-900"
            >
              ← 큐밋 홈
            </button>
            {/* /preview/home: the visitors' landing, reachable while signed in
                (a bare `/` document load would bounce back here). */}
            <button
              onClick={() => router.push("/preview/home")}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              서비스 소개
            </button>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle className="text-sm text-gray-500 hover:text-gray-700 transition-colors" />
            {isTestAccountAuthenticated && (
              <span className="text-[10px] font-semibold bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full">
                체험 계정
              </span>
            )}
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
          {isTestAccountAuthenticated && (
            <p className="text-xs text-violet-600">
              현재 체험 계정으로 로그인되어 있으며 일부 기능이 미리 활성화되어 있습니다.
            </p>
          )}
        </div>

        {/* Product rail: the signed-in route into the other products, since
            `/` now sends customers straight here instead of the landing page.
            Cards are status-aware: badge = where I stand, button = what I can
            do next, so they read as part of the dashboard rather than ads. */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            서비스 바로가기
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {(() => {
              const marketerStatus = loading
                ? null
                : snapshot.application
                  ? { label: snapshot.application.status, cls: "bg-rose-50 text-rose-600" }
                  : { label: "미신청", cls: "bg-gray-100 text-gray-500" };
              const generatorStatus = loading
                ? null
                : snapshot.usage.hasActiveSubscription
                  ? {
                      label: `구독중 · ${snapshot.usage.remainingPostCount}회 남음`,
                      cls: "bg-emerald-50 text-emerald-600",
                    }
                  : !snapshot.usage.freeTrialUsed
                    ? { label: "무료 체험 가능", cls: "bg-violet-50 text-violet-600" }
                    : { label: "미구독", cls: "bg-gray-100 text-gray-500" };
              const rail = [
                {
                  Icon: Megaphone,
                  chipCls: "bg-rose-50 text-rose-500",
                  name: "AI 마케터",
                  hoverCls: "hover:border-rose-300",
                  status: marketerStatus,
                  action: snapshot.application ? "연장 · 추가 신청" : "신청하기",
                  onClick: () => router.push("/?screen=apply"),
                },
                {
                  Icon: MagicWand,
                  chipCls: "bg-violet-50 text-violet-500",
                  name: "게시물 AI 생성기",
                  hoverCls: "hover:border-violet-300",
                  status: generatorStatus,
                  action: "게시물 만들기",
                  onClick: () => router.push("/tools"),
                },
              ];
              return rail.map((item) => (
                <button
                  key={item.name}
                  onClick={item.onClick}
                  className={`group text-left p-4 rounded-2xl bg-white border-2 border-gray-100 ${item.hoverCls} hover:shadow-md active:scale-[0.99] transition-all`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`w-8 h-8 rounded-lg ${item.chipCls} flex items-center justify-center`}
                    >
                      <item.Icon size={17} weight="duotone" />
                    </span>
                    {item.status && (
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${item.status.cls}`}
                      >
                        {item.status.label}
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-xs font-semibold text-gray-500">
                    {item.name}
                  </p>
                  <p className="mt-0.5 text-sm font-bold text-gray-900 flex items-center gap-1">
                    {item.action}
                    <ArrowRight
                      size={14}
                      weight="bold"
                      className="text-gray-300 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all"
                    />
                  </p>
                </button>
              ));
            })()}
          </div>
        </div>

        {/* One-time popup for admin-issued bonus credits */}
        {authUserId && !isTestAccountAuthenticated && (
          <CreditGrantPopup userId={authUserId} />
        )}

        {/* Show spinner while the main snapshot OR the grant check is still loading */}
        {loading || serviceGrantState.status === "idle" ? (
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

            {/* AI-generator input info (view/edit) now lives on the generator tab */}
            {authUserId && !isTestAccountAuthenticated && (
              <Card className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    AI 생성기 입력 정보
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    회사·브랜드·URL 등 생성 정보는 게시물 AI 생성기 탭에서 확인·수정할 수 있어요.
                  </p>
                </div>
                <a
                  href="/tools"
                  className="shrink-0 text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  생성기로 이동
                </a>
              </Card>
            )}

            {/* 관리자 안내 (결제 확인 등) — 가장 위에 노출 */}
            <UserNoticeCards notices={snapshot.notices} />

            {/* 선결제 크레딧 잔액 (충전 내역이 있을 때만) */}
            <PrepaidBalanceCard
              balance={snapshot.prepaidBalance}
              entries={snapshot.prepaidEntries}
            />

            {/* 월별 마케팅 성과 (기관 지원/일반 결제 유저 공통).
                목표는 채널 1개당 고정 기준이라 수량을 곱하지 않는다. */}
            <MonthlyPerformanceCard performances={snapshot.performances} />

            {serviceGrantState.status === "ready" ? (
              // ─── GRANTED-USER LAYOUT ───────────────────────────────────────
              (() => {
                const { grant, mainContentUrl, marketingChannel, channelUrl, instagramId, currentMonth, august } = serviceGrantState;

                const marketerMonths = parseMonthsList(grant.marketer_months);
                const generatorMonths = parseMonthsList(grant.generator_months);

                const marketerFutureMonth = getEarliestFutureMonth(marketerMonths, currentMonth);
                const generatorFutureMonth = getEarliestFutureMonth(generatorMonths, currentMonth);

                const marketerActive = grant.ai_marketer && marketerMonths.includes(currentMonth);
                const marketerFuture = grant.ai_marketer && Boolean(marketerFutureMonth);
                // 마케터 이용 종료: 신청했지만 이용 월이 모두 지나감(현재/미래 월 없음).
                // 예) 7월만 이용자는 8월이 되면 종료로 표시.
                const marketerEnded = grant.ai_marketer && !marketerActive && !marketerFuture;

                // Last day of the active service month for the "진행중" message
                const [currentYear] = getKoreaDateString().split("-").map(Number);
                const marketerMonthLastDay = new Date(
                  currentYear ?? new Date().getFullYear(),
                  currentMonth,
                  0
                ).getDate();

                const generatorActive = snapshot.usage.hasActiveSubscription;
                const generatorFuture =
                  !generatorActive && grant.ai_generator && Boolean(generatorFutureMonth);

                const marketerBadge = marketerFuture
                  ? { label: `${marketerFutureMonth}월 예정`, cls: "bg-amber-50 text-amber-700" }
                  : marketerEnded
                    ? { label: "이용 종료", cls: "bg-gray-100 text-gray-500" }
                    : mainContentUrl
                      ? { label: "진행중", cls: "bg-emerald-50 text-emerald-700" }
                      : marketerActive
                        ? { label: "할 일", cls: "bg-orange-50 text-orange-700" }
                        : { label: "신청하지 않음", cls: "bg-gray-100 text-gray-500" };

                const generatorBadge = generatorActive
                  ? { label: "이용 가능", cls: "bg-emerald-50 text-emerald-700" }
                  : generatorFuture
                    ? { label: `${generatorFutureMonth}월 예정`, cls: "bg-amber-50 text-amber-700" }
                    : { label: "신청하지 않음", cls: "bg-gray-100 text-gray-500" };

                const creditsTotal = snapshot.usage.totalPostLimit || POST_GENERATOR_MONTHLY_CREDITS;

                // 월별 마케팅 정보(채널·메인 게시물). 이용 월(marketer_months)에 든
                // 달만 표기 — 8월만 이용하는 고객은 8월만 뜬다.
                // · 7월: 신청서(applications) 정보.
                // · 8월: 8월 변경 폼(monthly_channel_info)이 있으면 그것을, 없으면
                //   (그대로 진행/신규 8월 신청자) 신청서 정보로 대체.
                const showJuly = grant.ai_marketer && marketerMonths.includes(7);
                const showAugust = grant.ai_marketer && marketerMonths.includes(8);
                const julyIsYoutube = marketingChannel === "youtube";
                const julyAccountUrl = buildAccountUrl(
                  marketingChannel,
                  channelUrl,
                  instagramId
                );
                // 7월은 신청서 기준이라 한 플랫폼만 존재한다.
                const julyPlatforms: PlatformInfo[] = [
                  {
                    platform: julyIsYoutube ? "youtube" : "instagram",
                    accountUrl: julyAccountUrl,
                    contentUrl: mainContentUrl,
                  },
                ];

                // 8월은 플랫폼별 칸이 따로 있어 두 개를 함께 표시할 수 있다.
                // 값이 없으면(마이그레이션 전 데이터 등) 기존 단일 칸으로 대체한다.
                const augChannel = august?.channel ?? marketingChannel;
                const augIsYoutube = augChannel === "youtube";
                // 8월 정보를 따로 제출한 경우(monthly_channel_info 행 존재)에는
                // 그 값만 쓴다. 7월 값으로 대체하면 8월 칸에 지난달 게시물이
                // 잘못 표시된다. 행이 없을 때(=7월 정보 그대로 진행)만 대체한다.
                const augFallbackAccount = august
                  ? august.channelUrl
                  : julyAccountUrl;
                const augFallbackContent = august
                  ? august.mainContentUrl
                  : mainContentUrl;
                const augYoutube: PlatformInfo = {
                  platform: "youtube",
                  accountUrl:
                    august?.youtubeChannelUrl ??
                    (augIsYoutube ? augFallbackAccount : null),
                  contentUrl:
                    august?.youtubeContentUrl ??
                    (augIsYoutube ? augFallbackContent : null),
                };
                const augInstagram: PlatformInfo = {
                  platform: "instagram",
                  accountUrl:
                    august?.instagramChannelUrl ??
                    (augIsYoutube ? null : augFallbackAccount),
                  contentUrl:
                    august?.instagramContentUrl ??
                    (augIsYoutube ? null : augFallbackContent),
                };
                // 두 플랫폼 중 하나라도 값이 있으면 둘 다 보여준다(없는 쪽은 "준비 중").
                const augHasBoth =
                  Boolean(augYoutube.accountUrl || augYoutube.contentUrl) &&
                  Boolean(augInstagram.accountUrl || augInstagram.contentUrl);
                const augPlatforms: PlatformInfo[] = augHasBoth
                  ? [augYoutube, augInstagram]
                  : augIsYoutube
                    ? [augYoutube, augInstagram]
                    : [augInstagram, augYoutube];
                const monthlyInfoSection =
                  showJuly || showAugust ? (
                    <div className="space-y-3">
                      <p className="text-xs font-medium text-gray-400">
                        마케팅 정보 (월별)
                      </p>
                      {showJuly && (
                        <MonthMarketingBlock
                          title="7월 마케팅 정보"
                          badge={monthStatusBadge(7, currentMonth)}
                          platforms={julyPlatforms}
                          emptyNote="아직 7월 정보를 입력하지 않았습니다."
                        />
                      )}
                      {showAugust && (
                        <MonthMarketingBlock
                          title="8월 마케팅 정보"
                          badge={monthStatusBadge(8, currentMonth)}
                          platforms={augPlatforms}
                          emptyNote="아직 8월 정보를 입력하지 않았습니다."
                        />
                      )}
                    </div>
                  ) : null;

                return (
                  <>
                    {/* 8월 마케터 이용자: 진행/변경 선택 팝업 (1회성).
                        7월(8월 이전 달)부터 이어온 기존 이용자만 대상 — 신규 8월
                        구독자는 지난달 정보가 없으므로 신청 폼에서 바로 입력한다. */}
                    {authUserId &&
                      grant.ai_marketer &&
                      marketerMonths.includes(8) &&
                      marketerMonths.some((m) => m < 8) && (
                        <AugustMarketingPopup
                          userId={authUserId}
                          email={authEmail || null}
                          channelUrl={buildAccountUrl(
                            marketingChannel,
                            channelUrl,
                            instagramId
                          )}
                          channelLabel={
                            marketingChannel === "youtube"
                              ? "채널 주소"
                              : "계정 주소"
                          }
                          mainContentUrl={mainContentUrl}
                          onChange={() => router.push("/marketing-august")}
                        />
                      )}

                    {/* 신청 서비스 요약 */}
                    <Card className="py-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                        신청 서비스
                      </p>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm font-semibold ${grant.ai_marketer ? "text-emerald-600" : "text-gray-300"}`}
                          >
                            {grant.ai_marketer ? "✓" : "○"}
                          </span>
                          <span
                            className={`text-sm font-medium ${grant.ai_marketer ? "text-gray-800" : "text-gray-400"}`}
                          >
                            AI 마케터
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm font-semibold ${grant.ai_generator ? "text-emerald-600" : "text-gray-300"}`}
                          >
                            {grant.ai_generator ? "✓" : "○"}
                          </span>
                          <span
                            className={`text-sm font-medium ${grant.ai_generator ? "text-gray-800" : "text-gray-400"}`}
                          >
                            AI 생성기
                          </span>
                        </div>
                      </div>
                    </Card>

                    {/* 결제 상태 shared block */}
                    <Card className="space-y-2">
                      <span className="inline-block text-xs font-semibold bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full">
                        기관 결제 완료
                      </span>
                      <p className="text-sm text-gray-500 leading-relaxed">
                        지원기관을 통해 이용 중입니다. 추가 이용 또는 연장이
                        필요하시면 카카오톡으로 문의해 주세요.
                      </p>
                    </Card>

                    {/* AI 마케터 card */}
                    {grant.ai_marketer && mainContentUrl && !marketerFuture && !marketerEnded ? (
                      // ── 진행중 rich card ──────────────────────────────────
                      (() => {
                        const isYoutube = marketingChannel === "youtube";
                        // 이번 달 운영 중인 채널별 예상 성과.
                        // 채널마다 붙은 마케터 수만큼 목표가 올라간다.
                        const outcomeGroups = augPlatforms
                          .filter((p) => p.accountUrl || p.contentUrl)
                          .map((p) => ({
                            platform: p.platform,
                            label: p.platform === "youtube" ? "유튜브" : "인스타그램",
                            count:
                              (p.platform === "youtube"
                                ? august?.youtubeMarketerCount
                                : august?.instagramMarketerCount) ?? 1,
                            items: getMonthlyOutcome(
                              p.platform,
                              (p.platform === "youtube"
                                ? august?.youtubeMarketerCount
                                : august?.instagramMarketerCount) ?? 1
                            ),
                          }));
                        const outcomes = outcomeGroups.length
                          ? outcomeGroups
                          : [
                              {
                                platform: isYoutube ? "youtube" : "instagram",
                                label: isYoutube ? "유튜브" : "인스타그램",
                                count: 1,
                                items: getMonthlyOutcome(
                                  isYoutube ? "youtube" : "instagram"
                                ),
                              },
                            ];
                        return (
                          <div className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-white p-6">
                            <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-emerald-50" />
                            <div className="pointer-events-none absolute -bottom-24 right-16 h-44 w-44 rounded-full bg-emerald-50/70" />

                            <div className="relative">
                              {/* 헤더 */}
                              <div className="mb-5 flex items-center justify-between">
                                <p className="text-sm font-semibold text-gray-700">AI 마케터</p>
                                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">진행중</span>
                              </div>

                              {/* 헤드라인 + 일러스트 */}
                              <div className="flex items-center gap-4">
                                <div className="min-w-0 flex-1">
                                  <h3 className="text-2xl font-bold leading-snug text-gray-900">
                                    AI 마케터가<br />
                                    <span className="text-emerald-500">마케팅 진행중</span>입니다.
                                  </h3>
                                  <p className="mt-3 text-sm text-gray-600">
                                    {getCompletionDateText(
                                      snapshot.application?.completionDate,
                                      currentMonth,
                                      marketerMonthLastDay
                                    )}
                                  </p>
                                </div>
                                <div className="hidden shrink-0 sm:block">
                                  <svg width="150" height="128" viewBox="0 0 150 128" fill="none" aria-hidden="true">
                                    <rect x="40" y="16" width="100" height="74" rx="10" fill="#EEF2FF" stroke="#C7D2FE" strokeWidth="2" />
                                    <rect x="81" y="90" width="18" height="11" fill="#C7D2FE" />
                                    <rect x="66" y="101" width="48" height="6" rx="3" fill="#C7D2FE" />
                                    <rect x="52" y="60" width="11" height="20" rx="2" fill="#A78BFA" />
                                    <rect x="67" y="50" width="11" height="30" rx="2" fill="#C4B5FD" />
                                    <rect x="82" y="42" width="11" height="38" rx="2" fill="#A78BFA" />
                                    <polyline points="50,76 70,58 88,66 118,34" stroke="#34D399" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                                    <polyline points="108,34 118,34 118,44" stroke="#34D399" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                                    <circle cx="120" cy="74" r="12" fill="#FDBA74" />
                                    <path d="M120 74 L120 62 A12 12 0 0 1 132 74 Z" fill="#FB923C" />
                                    <path d="M28 38 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 z" fill="#FCD34D" />
                                    <path d="M132 18 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6 z" fill="#FCD34D" />
                                    <circle cx="33" cy="72" r="3" fill="#FBBF24" />
                                  </svg>
                                </div>
                              </div>

                              {/* 예상 성과 */}
                              <div className="mt-6">
                                <p className="mb-2 text-xs font-medium text-gray-400">
                                  {currentMonth}월 예상 성과
                                </p>
                                <div className="space-y-3">
                                  {outcomes.map((group) => (
                                    <div key={group.platform}>
                                      {outcomes.length > 1 && (
                                        <p className="mb-1.5 text-[11px] font-semibold text-gray-500">
                                          {group.label}
                                          {group.count > 1 && (
                                            <span className="ml-1 font-normal text-gray-400">
                                              · 마케터 {group.count}명
                                            </span>
                                          )}
                                        </p>
                                      )}
                                      <div className="grid grid-cols-3 gap-2">
                                        {group.items.map((item) => (
                                          <div
                                            key={item.label}
                                            className="rounded-xl bg-emerald-50/70 px-3 py-2.5 text-center"
                                          >
                                            <p className="text-[11px] text-emerald-700">
                                              예상 {item.label}
                                            </p>
                                            <p className="text-base font-bold text-emerald-900">
                                              {item.text}
                                            </p>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                {!isYoutube && (
                                  <p className="mt-2.5 text-[11px] leading-relaxed text-gray-400">
                                    ※ 좋아요와 댓글은 플랫폼 특성상 보장되지 않습니다. 목표에 도달하지 못할 경우, 대신 팔로워를 약 50명
                                    추가 확보하여 총 팔로워 550명 이상 달성을 목표로 운영합니다.
                                  </p>
                                )}
                              </div>

                              {/* 진행 스텝퍼 */}
                              <div className="mt-7 flex items-center">
                                {APPLICATION_STAGES.flatMap((stageLabel, index) => {
                                  const isDone = index < currentStage;
                                  const isCurrent = index === currentStage;
                                  const checkIcon = (
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  );
                                  const stepEl = (
                                    <div key={`step-${index}`} className="flex flex-col items-center gap-1.5">
                                      <span className={`flex h-7 w-7 items-center justify-center rounded-full ${
                                        isCurrent
                                          ? "bg-emerald-500 text-white ring-4 ring-emerald-100"
                                          : isDone
                                            ? "bg-emerald-400 text-white"
                                            : "bg-gray-100"
                                      }`}>
                                        {isDone || isCurrent
                                          ? checkIcon
                                          : <span className="text-xs font-semibold text-gray-400">{index + 1}</span>
                                        }
                                      </span>
                                      <span className={`text-[11px] ${
                                        isCurrent
                                          ? "font-semibold text-emerald-600"
                                          : isDone
                                            ? "text-gray-500"
                                            : "text-gray-400"
                                      }`}>
                                        {stageLabel}
                                      </span>
                                    </div>
                                  );
                                  return index < APPLICATION_STAGES.length - 1
                                    ? [stepEl, <div key={`line-${index}`} className={`mb-5 h-0.5 flex-1 ${isDone ? "bg-emerald-200" : "bg-gray-200"}`} />]
                                    : [stepEl];
                                })}
                              </div>

                              {/* 제출 정보 (월별: 7월·8월) */}
                              <div className="mt-7">{monthlyInfoSection}</div>

                              {/* 변경 불가 안내 */}
                              <div className="mt-4 flex gap-3 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3.5">
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                                    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                  </svg>
                                </span>
                                <div className="space-y-1">
                                  <p className="text-sm font-semibold text-amber-900">제출한 정보는 직접 변경할 수 없습니다.</p>
                                  <p className="text-sm leading-relaxed text-amber-700">변경이 필요하신 경우 1:1 문의로 요청해 주세요. 신청 후 24시간이 지나면 변경이 어렵습니다.</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      // ── 기타 상태 card (기존 유지) ────────────────────────
                      <Card className="overflow-hidden space-y-4">
                        {/* Gradient banner with illustration */}
                        <div className="-mx-6 -mt-6 mb-0 bg-gradient-to-br from-emerald-50 via-sky-50 to-blue-50 px-6 pt-5 pb-5 flex items-center justify-between gap-4">
                          <div className="space-y-0.5">
                            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">
                              AI 마케터
                            </p>
                            <h2 className="text-xl font-bold text-gray-900">
                              AI 마케터
                            </h2>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span
                              className={`text-xs font-semibold px-3 py-1.5 rounded-full ${marketerBadge.cls}`}
                            >
                              {marketerBadge.label}
                            </span>
                            <svg width="44" height="36" viewBox="0 0 44 36" fill="none" aria-hidden="true">
                              <rect x="1" y="24" width="7" height="11" rx="2" fill="#a7f3d0" />
                              <rect x="12" y="16" width="7" height="19" rx="2" fill="#6ee7b7" />
                              <rect x="23" y="9" width="7" height="26" rx="2" fill="#34d399" />
                              <rect x="34" y="3" width="7" height="32" rx="2" fill="#10b981" />
                              <polyline points="4.5,24 15.5,16 26.5,9 37.5,3" stroke="#059669" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                              <circle cx="37.5" cy="3" r="2.5" fill="#059669" />
                            </svg>
                          </div>
                        </div>

                        {grant.ai_marketer && snapshot.application && (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                              현재 진행 단계
                            </p>
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
                                        index <= currentStage ? "text-gray-800 font-medium" : "text-gray-400"
                                      }`}
                                    >
                                      {label}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {monthlyInfoSection}

                        {grant.ai_marketer && marketerActive && !mainContentUrl && (
                          <div className="rounded-xl bg-orange-50 border border-orange-100 px-4 py-4 space-y-3">
                            <p className="text-sm text-orange-700 leading-relaxed">
                              AI 마케터를 시작하려면 먼저 기본 정보를 설정해 주세요.
                            </p>
                            <button
                              onClick={handleStartMarketerSetup}
                              className="py-2.5 px-5 bg-gradient-to-r from-rose-500 to-pink-500 text-white text-sm font-semibold rounded-xl shadow-sm hover:shadow-md active:scale-[0.98] transition-all"
                            >
                              세팅하러 가기
                            </button>
                          </div>
                        )}

                        {grant.ai_marketer && marketerFuture && (
                          <p className="text-sm text-gray-500 leading-relaxed">
                            서비스 시작 전입니다. 시작 월이 되면 진행됩니다.
                          </p>
                        )}

                        {grant.ai_marketer && marketerEnded && (
                          <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-4 space-y-1.5">
                            <p className="text-sm font-semibold text-gray-700">
                              AI 마케터 이용이 종료되었습니다.
                            </p>
                            <p className="text-sm text-gray-500 leading-relaxed">
                              그동안 이용해 주셔서 감사합니다. 추가 이용 또는 연장을
                              원하시면 1:1 문의로 요청해 주세요.
                            </p>
                          </div>
                        )}
                      </Card>
                    )}

                    {/* AI 생성기 card */}
                    <div className="relative overflow-hidden rounded-2xl border border-violet-100 bg-white p-6">
                      <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-violet-50" />
                      <div className="pointer-events-none absolute -bottom-24 right-16 h-44 w-44 rounded-full bg-violet-50/70" />

                      <div className="relative">
                        {/* 헤더 */}
                        <div className="mb-5 flex items-center justify-between">
                          <p className="text-sm font-semibold text-gray-700">AI 생성기</p>
                          <span className={`rounded-full px-3 py-1 text-xs font-medium ${generatorBadge.cls}`}>
                            {generatorBadge.label}
                          </span>
                        </div>

                        {/* 헤드라인 + 일러스트 */}
                        <div className="flex items-center gap-4">
                          <div className="min-w-0 flex-1">
                            <h3 className="text-2xl font-bold leading-snug text-gray-900">
                              지금 바로<br />
                              <span className="text-violet-500">게시물을 생성</span>해보세요.
                            </h3>
                            <p className="mt-3 text-sm text-gray-600">
                              이미지 생성·재생성·AI 수정을 자유롭게 이용할 수 있어요.
                            </p>
                          </div>
                          <div className="hidden shrink-0 sm:block">
                            <svg width="150" height="128" viewBox="0 0 150 128" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                              <rect x="34" y="30" width="70" height="70" rx="12" fill="#F5F3FF" stroke="#DDD6FE" strokeWidth="2" />
                              <circle cx="54" cy="52" r="6" fill="#C4B5FD" />
                              <path d="M39 90 L58 66 L70 80 L85 60 L99 90 Z" fill="#A78BFA" />
                              <line x1="95" y1="42" x2="120" y2="20" stroke="#7C3AED" strokeWidth="5" strokeLinecap="round" />
                              <path d="M123 15 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5 z" fill="#8B5CF6" />
                              <path d="M108 56 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6 z" fill="#C4B5FD" />
                              <circle cx="120" cy="72" r="3" fill="#DDD6FE" />
                              <path d="M30 22 l1.4 3.6 3.6 1.4 -3.6 1.4 -1.4 3.6 -1.4 -3.6 -3.6 -1.4 3.6 -1.4 z" fill="#DDD6FE" />
                            </svg>
                          </div>
                        </div>

                        {/* Active: 이용 현황 + 바로가기 */}
                        {grant.ai_generator && generatorActive && (
                          <>
                            <div className="mt-6">
                              <p className="mb-2 text-xs font-medium text-gray-400">이용 현황</p>
                              <div className="grid grid-cols-3 gap-2">
                                <div className="rounded-xl bg-violet-50/70 px-3 py-2.5 text-center">
                                  <p className="text-[11px] text-violet-700">남은 횟수</p>
                                  <p className="text-base font-bold text-violet-900">
                                    {snapshot.usage.remainingPostCount}/{creditsTotal}
                                  </p>
                                </div>
                                <div className="rounded-xl bg-violet-50/70 px-3 py-2.5 text-center">
                                  <p className="text-[11px] text-violet-700">구독 요금</p>
                                  <p className="text-base font-bold text-violet-900">
                                    월 {POST_GENERATOR_MONTHLY_PRICE.toLocaleString()}원
                                  </p>
                                </div>
                                <div className="rounded-xl bg-violet-50/70 px-3 py-2.5 text-center">
                                  <p className="text-[11px] text-violet-700">갱신</p>
                                  <p className="text-base font-bold text-violet-900">
                                    매월 {POST_GENERATOR_MONTHLY_CREDITS}회
                                  </p>
                                </div>
                              </div>
                            </div>
                            <p className="mt-5 text-sm text-gray-500">
                              생성한 게시물은 AI 생성기에서 확인·복사·다운로드할 수 있어요.
                            </p>
                            <button
                              type="button"
                              onClick={() => router.push("/tools")}
                              className="mt-3 w-full rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-violet-700 active:scale-[0.99]"
                            >
                              AI 생성기 바로가기
                            </button>
                          </>
                        )}

                        {/* Future: 시작 예정 안내 */}
                        {grant.ai_generator && generatorFuture && (
                          <p className="mt-5 text-sm text-gray-500 leading-relaxed">
                            서비스 시작 전입니다. {generatorFutureMonth}월이 되면 이용할 수 있습니다.
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()
            ) : (
              // ─── NON-GRANT LEGACY LAYOUT (unchanged) ──────────────────────
              <>
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
                      actions={
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <button
                            onClick={() => router.push("/?screen=apply")}
                            className="w-full py-2.5 bg-gradient-to-r from-rose-500 to-pink-500 text-white text-sm font-semibold rounded-xl shadow-sm hover:shadow-md active:scale-[0.98] transition-all"
                          >
                            AI 마케터 신청하기
                          </button>
                          <button
                            onClick={() => router.push("/tools")}
                            className="w-full py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-white transition-colors"
                          >
                            게시물 AI 생성하기
                          </button>
                        </div>
                      }
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

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
                      무료 체험, 구독 상태, 남은 생성 횟수를 바로 확인할 수 있습니다.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
                        월 구독 상태
                      </p>
                      <p className="mt-2 text-lg font-bold text-gray-900">
                        {snapshot.usage.hasActiveSubscription
                          ? "구독 이용중"
                          : "미구독"}
                      </p>
                      <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                        월 {POST_GENERATOR_MONTHLY_PRICE.toLocaleString()}원, 매월{" "}
                        {POST_GENERATOR_MONTHLY_CREDITS}회 기준입니다.
                      </p>
                    </div>
                    <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
                      <p className="text-xs font-semibold text-gray-400">
                        이번 달 남은 횟수
                      </p>
                      <p className="mt-2 text-lg font-bold text-gray-900">
                        {snapshot.usage.remainingPostCount}/
                        {snapshot.usage.totalPostLimit || POST_GENERATOR_MONTHLY_CREDITS}
                      </p>
                      <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                        사용 {snapshot.usage.usedPaidPostCount}회 / 전체{" "}
                        {snapshot.usage.totalPostLimit || POST_GENERATOR_MONTHLY_CREDITS}회
                        기준입니다.
                      </p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-violet-100 bg-violet-50/60 px-5 py-5 space-y-3">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-violet-700">
                        게시물 AI 생성 구독형
                      </p>
                      <p className="text-sm text-violet-600 leading-relaxed">
                        무료 체험 뒤 바로 시작할 수 있는 경량 구독형 도구이며, 이후
                        AI 인스타그램 마케터 서비스로 자연스럽게 확장할 수 있습니다.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <div className="rounded-2xl bg-white/80 border border-violet-100 px-4 py-4">
                        <p className="text-xs font-semibold text-violet-500">구독 요금</p>
                        <p className="mt-2 font-bold text-gray-900">
                          월 {POST_GENERATOR_MONTHLY_PRICE.toLocaleString()}원
                        </p>
                      </div>
                      <div className="rounded-2xl bg-white/80 border border-violet-100 px-4 py-4">
                        <p className="text-xs font-semibold text-violet-500">제공량</p>
                        <p className="mt-2 font-bold text-gray-900">
                          매월 40회
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <button
                        onClick={
                          snapshot.usage.hasActiveSubscription
                            ? () => router.push("/tools")
                            : handleStartSubscription
                        }
                        disabled={startingSubscription}
                        className={`w-full py-3 bg-gradient-to-r from-violet-500 to-purple-500 text-white font-semibold rounded-xl shadow-md transition-all ${
                          startingSubscription
                            ? "opacity-50 cursor-not-allowed"
                            : "hover:shadow-lg active:scale-[0.98]"
                        }`}
                      >
                        {startingSubscription
                          ? "구독을 준비하고 있습니다..."
                          : snapshot.usage.hasActiveSubscription
                            ? "게시물 AI 생성으로 이동"
                            : `월 구독 시작하기 (${POST_GENERATOR_MONTHLY_PRICE.toLocaleString()}원)`}
                      </button>
                      <button
                        onClick={() => router.push("/?screen=apply")}
                        className="w-full py-3 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        AI 마케터 신청하기
                      </button>
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
                      actions={
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <button
                            onClick={() => router.push("/tools")}
                            className="w-full py-2.5 bg-gradient-to-r from-violet-500 to-purple-500 text-white text-sm font-semibold rounded-xl shadow-sm hover:shadow-md active:scale-[0.98] transition-all"
                          >
                            게시물 AI 생성하기
                          </button>
                          <button
                            onClick={() => router.push("/?screen=apply")}
                            className="w-full py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-white transition-colors"
                          >
                            AI 마케터 신청하기
                          </button>
                        </div>
                      }
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
          </>
        )}
      </div>
    </main>
    </AppSurface>
  );
}
