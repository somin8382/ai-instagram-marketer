"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";
import { AdminNav } from "@/lib/ui/admin-nav";

// ─── Types ────────────────────────────────────────────────────────────────────

type PageState = "loading" | "no_session" | "forbidden" | "error" | "ready";

type UserRow = {
  id: string;
  signedUp: boolean;
  email: string | null;
  name: string | null;
  companyName: string | null;
  brandName: string | null;
  industry: string | null;
  phone: string | null;
  hostOrg: string | null;
  mentorOrg: string | null;
  aiMarketer: boolean;
  aiGenerator: boolean;
  marketerQuantity: number | null;
  marketerMonths: string | null; // 마케터 이용 월 목록 ("7,8")
  generatorMonths: string | null; // 생성기 이용 월 목록 ("7,8")
  field: string; // "local" | "tech"
  note: string; // 관리자 메모(특이사항)
  tossStatus: string; // (레거시) 월 구분 없는 토스 상태 — 표시는 julyToss/augustToss 사용
  augustMarketing: string | null; // 8월 마케팅: "keep"|"change"|"pending"|null(미해당)
  julyMarketing: string | null; // 7월 마케팅 실행: "done"|"pending"|null(7월 대상 아님)
  // 8월 마케터 정보 제출: "changed"(정보 변경 제출) | "kept"(7월 정보 유지)
  //                      | "new"(8월 신규 신청) | "pending"(미제출) | null(대상 아님)
  augustSubmission: string | null;
  augustChannelUrl: string | null; // 8월 기준 채널 주소
  augustPostUrl: string | null; // 8월 기준 게시물 주소
  augustSubmittedAt: string | null; // 8월 정보 제출 시각(ISO)
  // 8월 댓글 이벤트 포함 여부. true=포함, false=미포함, null=미지정
  augustCommentsIncluded: boolean | null;
  prepaidBalance: number; // 선결제 크레딧 잔액 (1원=1크레딧)
  julyChannelUrl: string | null; // 7월 제출 채널 주소
  julyPostUrl: string | null; // 7월 제출 게시물 주소
  marketingChannel: string | null; // "instagram" | "youtube" | null
  julyToss: string; // 7월 토스: "wait"|"in_progress"|"done"
  augustToss: string; // 8월 토스: "wait"|"in_progress"|"done"
  instagramUrl: string | null; // 마케터 제출 채널(인스타그램) 주소
  postUrl: string | null; // 마케터 제출 대표 게시물 주소
  instaFollowerCount: number | null; // 최근 기록된 인스타 팔로워 수
  instaFollowerDate: string | null; // 그 기록 날짜(YYYY-MM-DD)
  youtubeSubCount: number | null; // 최근 기록된 유튜브 구독자 수
  youtubeSubDate: string | null;
  youtubeViewCount: number | null; // 유튜브 조회수
  youtubeViewDate: string | null;
  postLikesCount: number | null; // 메인 게시물 좋아요 수
  postLikesDate: string | null;
  postCommentsCount: number | null; // 메인 게시물 댓글 수
  postCommentsDate: string | null;
  aiMarketerSub: boolean;
  aiGeneratorSub: boolean;
  freeUser: boolean;
  createdAt: string | null;
  onboardedAt: string | null;
  subscriptionActive: boolean;
  subscriptionEndDate: string | null;
  remainingCredits: number | null;
  grantGeneratorCredits: number | null;
  aiGenerationCount: number;
  freeTrialCount: number;
  lastGeneratedAt: string | null;
  loginCount: number;
  firstLoginAt: string | null;
  firstAccessAt: string | null;
  accessCount: number | null;
  lastLoginAt: string | null;
  lastActivityAt: string | null;
  marketerSubmitted: boolean;
  marketerSubmittedAt: string | null;
  inquiryCount: number;
  openInquiryCount: number;
};

type ApplicationRecord = Record<string, unknown>;

type UserDetail = {
  note: string;
  user: {
    id: string | null;
    email: string | null;
    name: string | null;
    createdAt: string | null;
    companyName: string | null;
    instagramUrl: string | null;
    youtubeUrl: string | null;
    accountOnboardedAt: string | null;
  };
  subscription: {
    startDate: string;
    endDate: string;
    remainingCredits: number;
    isActive: boolean;
  } | null;
  applications: ApplicationRecord[];
  grant: Record<string, unknown> | null;
  creditGrants: Array<Record<string, unknown>>;
  generationLogs: Array<Record<string, unknown>>;
  loginStats: {
    count: number;
    firstLoginAt: string | null;
    lastLoginAt: string | null;
    authLastSignInAt: string | null;
    authCreatedAt: string | null;
  };
  accessStats: {
    firstAccessAt: string | null;
    accessCount: number | null;
  };
  loginHistory: Array<{ occurredAt: string; eventType: string }>;
  aiUsage: {
    totalGenerations: number;
    freeTrialGenerations: number;
    paidGenerations: number;
    latestGeneratedAt: string | null;
    latestTitle: string | null;
  };
  posts: Array<{
    id: string;
    title: string;
    createdAt: string;
    isFreeTrial: boolean;
  }>;
};

type SortField =
  | "createdAt"
  | "firstAccessAt"
  | "accessCount"
  | "lastActivityAt"
  | "loginCount"
  | "aiGenerationCount"
  | "remainingCredits"
  | "name";

type MarketerEditForm = {
  id: string;
  marketing_channel: string;
  channel_url: string;
  main_content_url: string;
  instagram_id: string;
  industry: string;
  product_service: string;
  account_direction: string;
  account_bio: string;
  account_concept: string;
  manager_name: string;
  phone: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function adminFetch(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers as Record<string, string> | undefined),
    },
  });
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ko-KR");
}

// 분야: local(로컬) | tech(기술). 기본 tech.
function fieldLabel(field: string | null | undefined): string {
  return field === "local" ? "로컬" : "기술";
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function daysAgo(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  return Math.floor((nowMs - new Date(value).getTime()) / 86400000);
}

function activityLabel(
  value: string | null,
  nowMs: number
): { label: string; cls: string } {
  const days = daysAgo(value, nowMs);
  if (days === null) return { label: "활동 없음", cls: "text-gray-400" };
  if (days <= 0) return { label: "오늘", cls: "text-green-600 font-medium" };
  if (days <= 7) return { label: `${days}일 전`, cls: "text-green-600" };
  if (days <= 30) return { label: `${days}일 전`, cls: "text-amber-600" };
  return { label: `${days}일 전`, cls: "text-red-500" };
}

// "7,8" → [7, 8] (상품별 이용 개월 목록 파싱). 공백·빈값 안전.
function parseMonths(list: string | null | undefined): number[] {
  if (!list) return [];
  return String(list)
    .split(/[,\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12)
    .sort((a, b) => a - b);
}

type ViewMode = "normal" | "capture" | "marketer" | "userdb";
// 넓은 표를 그리는 세 모드. "userdb" 는 열 구성이 전혀 달라 전용 표로 그린다.
const WIDE_MODES: ViewMode[] = ["normal", "capture", "marketer"];

type MetricKey =
  | "instagram"
  | "youtube"
  | "youtube_views"
  | "post_likes"
  | "post_comments";

// 각 열이 어느 보기 모드에서 내보내지는지(modes)를 화면 표의 열 노출과 일치시킨다.
// 엑셀 내려받기는 "지금 보는 표"의 열만 나가도록 현재 모드로 필터링한다.
// 월별 토스 상태 표시값. 저장값은 wait | in_progress | done.
const TOSS_LABEL: Record<string, string> = {
  wait: "대기",
  in_progress: "진행중",
  done: "완료",
};
const TOSS_CLS: Record<string, string> = {
  wait: "bg-gray-100 text-gray-500",
  in_progress: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
};
// ISO 문자열 → KST 기준 YYYY-MM-DD. applications 등 일부 컬럼은 타임존 없이
// UTC로 저장돼 있어, 오프셋이 없으면 UTC로 간주한다.
function kstDate(iso: string): string {
  const normalized = /[Zz]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  const d = new Date(normalized);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

const AUG_SUB_LABEL: Record<string, string> = {
  changed: "정보 변경",
  kept: "7월 정보 유지",
  new: "8월 신규 신청",
  pending: "미제출",
};
const AUG_SUB_CLS: Record<string, string> = {
  changed: "bg-blue-100 text-blue-700",
  kept: "bg-emerald-100 text-emerald-700",
  new: "bg-violet-100 text-violet-700",
  pending: "bg-red-100 text-red-700",
};

const JULY_MONTH = "2026-07";
const AUGUST_MONTH = "2026-08";

/** 마케팅 중인 채널·게시물 주소를 한 칸에 라벨과 함께 쌓아 보여준다. */
function UrlPair({
  channel,
  post,
}: {
  channel: string | null;
  post: string | null;
}) {
  if (!channel && !post) {
    return <span className="text-gray-300">—</span>;
  }

  const linkCls =
    "block max-w-[18rem] truncate text-blue-600 underline underline-offset-2 hover:text-blue-800";

  return (
    <div className="space-y-0.5">
      {[
        { label: "채널", url: channel },
        { label: "게시물", url: post },
      ].map(({ label, url }) => (
        <div key={label} className="flex items-baseline gap-1.5">
          <span className="text-[10px] text-gray-400 shrink-0">{label}</span>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              title={url}
              className={linkCls}
            >
              {url}
            </a>
          ) : (
            <span className="text-gray-300">—</span>
          )}
        </div>
      ))}
    </div>
  );
}

/** 구독 중인 서비스 이름들. 없으면 빈 배열. */
function subscribedServices(u: UserRow): string[] {
  const names: string[] = [];
  if (u.aiMarketerSub) names.push("AI 마케터");
  if (u.aiGeneratorSub) names.push("AI 생성기");
  return names;
}

/** 마케팅이 진행 중인 채널·게시물 주소. 8월이 현재 월 기준이고 7월 값이
 *  유지될 수 있어, 8월이 비면 7월로 내려간다. */
function submittedUrls(u: UserRow): { channel: string | null; post: string | null } {
  return {
    channel: u.augustChannelUrl ?? u.julyChannelUrl ?? null,
    post: u.augustPostUrl ?? u.julyPostUrl ?? null,
  };
}

const EXPORT_COLUMNS: Array<{
  header: string;
  modes: ViewMode[];
  get: (u: UserRow) => string | number;
}> = [
  { header: "이름", modes: [...WIDE_MODES, "userdb"], get: (u) => u.name ?? "" },
  { header: "이메일", modes: [...WIDE_MODES, "userdb"], get: (u) => u.email ?? "" },
  { header: "구분", modes: ["normal", "marketer"], get: (u) => (u.signedUp ? "가입" : "미가입") },
  { header: "분야", modes: WIDE_MODES, get: (u) => fieldLabel(u.field) },
  { header: "메모", modes: ["normal", "marketer"], get: (u) => u.note ?? "" },
  {
    header: "플랫폼",
    modes: ["normal", "marketer", "userdb"],
    get: (u) =>
      u.marketingChannel === "youtube"
        ? "유튜브"
        : u.marketingChannel === "instagram"
          ? "인스타그램"
          : "",
  },
  {
    header: "8월 제출",
    modes: ["normal", "marketer"],
    get: (u) => (u.augustSubmission ? AUG_SUB_LABEL[u.augustSubmission] ?? "" : ""),
  },
  {
    header: "8월 제출일",
    modes: ["normal", "marketer"],
    get: (u) => (u.augustSubmittedAt ? kstDate(u.augustSubmittedAt) : ""),
  },
  {
    header: "8월 댓글 이벤트",
    modes: ["normal", "marketer"],
    get: (u) =>
      u.augustSubmission === null
        ? ""
        : u.augustCommentsIncluded === true
          ? "포함"
          : u.augustCommentsIncluded === false
            ? "미포함"
            : "미지정",
  },
  { header: "7월 채널 주소", modes: ["marketer"], get: (u) => u.julyChannelUrl ?? "" },
  { header: "7월 게시물 주소", modes: ["marketer"], get: (u) => u.julyPostUrl ?? "" },
  { header: "8월 채널 주소", modes: ["marketer"], get: (u) => u.augustChannelUrl ?? "" },
  { header: "8월 게시물 주소", modes: ["marketer"], get: (u) => u.augustPostUrl ?? "" },
  {
    header: "7월 토스",
    modes: ["normal", "marketer"],
    get: (u) => TOSS_LABEL[u.julyToss] ?? "대기",
  },
  {
    header: "8월 토스",
    modes: ["normal", "marketer"],
    get: (u) => TOSS_LABEL[u.augustToss] ?? "대기",
  },
  {
    header: "7월 마케팅",
    modes: ["normal", "marketer"],
    get: (u) =>
      u.julyMarketing === null
        ? ""
        : u.julyMarketing === "done"
          ? "완료"
          : "미완료",
  },
  {
    header: "8월 마케팅",
    modes: ["normal"],
    get: (u) =>
      u.augustMarketing === null
        ? ""
        : u.augustMarketing === "keep"
          ? "유지"
          : u.augustMarketing === "change"
            ? "변경"
            : "미정",
  },
  { header: "회사", modes: WIDE_MODES, get: (u) => u.companyName ?? "" },
  { header: "브랜드", modes: ["normal"], get: (u) => u.brandName ?? "" },
  { header: "주관기관", modes: ["normal", "capture"], get: (u) => u.hostOrg ?? "" },
  { header: "멘토기관", modes: WIDE_MODES, get: (u) => u.mentorOrg ?? "" },
  { header: "전화", modes: ["normal", "userdb"], get: (u) => u.phone ?? "" },
  { header: "무료 유저", modes: ["normal"], get: (u) => (u.freeUser ? "O" : "") },
  { header: "AI 마케터 구독", modes: ["normal", "capture"], get: (u) => (u.aiMarketerSub ? "O" : "") },
  { header: "AI 생성기 구독", modes: ["normal", "capture"], get: (u) => (u.aiGeneratorSub ? "O" : "") },
  {
    header: "마케터 개월",
    modes: ["normal", "capture"],
    get: (u) => (u.aiMarketer ? parseMonths(u.marketerMonths).join(",") : ""),
  },
  {
    header: "생성기 개월",
    modes: ["normal", "capture"],
    get: (u) => (u.aiGenerator ? parseMonths(u.generatorMonths).join(",") : ""),
  },
  { header: "가입/등록일", modes: ["normal"], get: (u) => u.createdAt?.slice(0, 10) ?? "" },
  { header: "최초 접속일", modes: ["normal", "capture"], get: (u) => (u.firstAccessAt ?? u.createdAt)?.slice(0, 10) ?? "-" },
  { header: "접속 횟수", modes: ["normal"], get: (u) => (u.accessCount === null ? "-" : u.accessCount) },
  { header: "최근 로그인", modes: ["normal"], get: (u) => u.lastLoginAt?.slice(0, 10) ?? "" },
  {
    header: "마지막 접속일",
    modes: ["normal", "userdb"],
    get: (u) => u.lastActivityAt?.slice(0, 10) ?? "",
  },
  {
    header: "구독 중인 서비스",
    modes: ["userdb"],
    get: (u) => subscribedServices(u).join(", "),
  },
  {
    header: "마케팅 채널 주소",
    modes: ["userdb"],
    // 마케터 구독자만 제출 대상이라 그 외에는 비워 둔다.
    get: (u) => (u.aiMarketerSub ? (submittedUrls(u).channel ?? "") : ""),
  },
  {
    header: "마케팅 게시물 주소",
    modes: ["userdb"],
    get: (u) => (u.aiMarketerSub ? (submittedUrls(u).post ?? "") : ""),
  },
  { header: "로그인 수", modes: ["normal"], get: (u) => u.loginCount },
  { header: "AI 생성 수", modes: ["normal"], get: (u) => u.aiGenerationCount },
  {
    header: "마케터 수량",
    modes: ["normal", "capture"],
    get: (u) => (u.marketerQuantity === null ? "" : u.marketerQuantity),
  },
  {
    header: "선결제 크레딧",
    modes: ["normal", "capture"],
    get: (u) => (u.prepaidBalance ? u.prepaidBalance : ""),
  },
  {
    header: "생성기 잔여 횟수",
    modes: WIDE_MODES,
    get: (u) =>
      u.remainingCredits !== null
        ? u.remainingCredits
        : u.grantGeneratorCredits !== null
          ? `${u.grantGeneratorCredits} (부여)`
          : "",
  },
  {
    header: "AI 마케터 제출 내역",
    modes: ["normal", "marketer"],
    get: (u) =>
      u.aiMarketer ? (u.marketerSubmitted ? "제출완료" : "미제출") : "",
  },
  {
    header: "인스타 팔로워",
    modes: ["marketer"],
    get: (u) => (u.instaFollowerCount === null ? "" : u.instaFollowerCount),
  },
  {
    header: "유튜브 구독자",
    modes: ["marketer"],
    get: (u) => (u.youtubeSubCount === null ? "" : u.youtubeSubCount),
  },
  {
    header: "유튜브 조회수",
    modes: ["marketer"],
    get: (u) => (u.youtubeViewCount === null ? "" : u.youtubeViewCount),
  },
  {
    header: "게시물 좋아요",
    modes: ["marketer"],
    get: (u) => (u.postLikesCount === null ? "" : u.postLikesCount),
  },
  {
    header: "게시물 댓글",
    modes: ["marketer"],
    get: (u) => (u.postCommentsCount === null ? "" : u.postCommentsCount),
  },
  { header: "문의 수", modes: ["normal", "capture"], get: (u) => u.inquiryCount },
];

async function exportXlsx(rows: UserRow[], viewMode: ViewMode = "normal") {
  // Security note (xlsx@0.18.5): the advisories scanners flag against this
  // package (prototype pollution CVE-2023-30533, ReDoS CVE-2024-22363) are in
  // the PARSE path (read / sheet_to_json of untrusted files). This code is
  // write-only — json_to_sheet + writeFile of admin-owned data — so those CVEs
  // are not reachable here. Accepted low risk: staying on the npm build avoids
  // a CDN-tarball dependency that would complicate CI/Vercel installs. Revisit
  // if any read/parse usage is ever added.
  const XLSX = await import("xlsx");
  // "지금 보는 표"와 동일하게 — 현재 보기 모드에서 노출되는 열만 내보낸다.
  const columns = EXPORT_COLUMNS.filter((c) => c.modes.includes(viewMode));
  // 플랫폼이 섞여 있으면 보기 어려워, 인스타그램 → 유튜브 → 미확인 순으로 묶는다.
  // 같은 플랫폼 안에서는 화면에 보이던 정렬 순서를 그대로 유지한다.
  const platformRank = (u: UserRow) =>
    u.marketingChannel === "instagram" ? 0 : u.marketingChannel === "youtube" ? 1 : 2;
  const ordered = rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        platformRank(a.row) - platformRank(b.row) || a.index - b.index
    )
    .map((entry) => entry.row);
  const data = ordered.map((row) => {
    const record: Record<string, string | number> = {};
    for (const column of columns) {
      record[column.header] = column.get(row);
    }
    return record;
  });
  const sheet = XLSX.utils.json_to_sheet(data, {
    header: columns.map((c) => c.header),
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "사용자");
  const modeTag =
    viewMode === "capture"
      ? "_캡쳐용"
      : viewMode === "marketer"
        ? "_마케터"
        : viewMode === "userdb"
          ? "_유저DB"
          : "";
  XLSX.writeFile(
    workbook,
    `users${modeTag}_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
}

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

function applicationToEditForm(app: ApplicationRecord): MarketerEditForm {
  return {
    id: str(app.id),
    marketing_channel: str(app.marketing_channel),
    channel_url: str(app.channel_url),
    main_content_url: str(app.main_content_url),
    instagram_id: str(app.instagram_id),
    industry: str(app.industry),
    product_service: str(app.product_service),
    account_direction: str(app.account_direction),
    account_bio: str(app.account_bio),
    account_concept: str(app.account_concept),
    manager_name: str(app.manager_name),
    phone: str(app.phone),
  };
}

const inputCls =
  "w-full px-3 py-2 bg-white text-gray-900 border border-gray-200 rounded-xl text-sm placeholder:text-gray-400 focus:outline-none focus:border-gray-400";
const selectCls =
  "px-3 py-2 bg-white text-gray-900 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400";

// 필터가 걸려 있으면(=기본값 "all"이 아니면) 파란 테두리로 표시해,
// 지금 무엇이 걸러진 상태인지 한눈에 보이게 한다.
const filterCls = (value: string) =>
  value === "all"
    ? selectCls
    : `${selectCls} border-blue-400 bg-blue-50 text-blue-800 font-medium`;

function Dot({ on }: { on: boolean }) {
  return on ? (
    <span className="text-green-600 font-semibold">O</span>
  ) : (
    <span className="text-gray-300">—</span>
  );
}

// 상품별 이용 개월 목록. 해당 상품 미이용이면 "—", 기준 월(highlight)이
// 목록에 있으면 그 월만 강조해 "8월 이용 여부"를 한눈에 보이게 한다.
function MonthsCell({
  months,
  on,
  highlight,
}: {
  months: string | null;
  on: boolean;
  highlight: string;
}) {
  const ms = parseMonths(months);
  if (!on || ms.length === 0) return <span className="text-gray-300">—</span>;
  const hl = highlight !== "all" ? Number(highlight) : null;
  return (
    <span className="inline-flex flex-wrap justify-center gap-0.5">
      {ms.map((m) => (
        <span
          key={m}
          className={
            hl === m
              ? "rounded bg-violet-100 text-violet-700 font-semibold px-1"
              : "text-gray-600 px-0.5"
          }
        >
          {m}
        </span>
      ))}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const [pageState, setPageState] = useState<PageState>("loading");
  const [accessToken, setAccessToken] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  // Reference time for relative filters, captured at data-load time so the
  // filter pass stays pure across re-renders.
  const [loadedAtMs, setLoadedAtMs] = useState(0);

  // Filters
  const [query, setQuery] = useState("");
  const [hostOrgFilter, setHostOrgFilter] = useState("all");
  const [fieldFilter, setFieldFilter] = useState("all"); // all | local | tech
  const [signupStateFilter, setSignupStateFilter] = useState("all"); // all | signed | pre
  const [serviceFilter, setServiceFilter] = useState("all"); // all | free | marketer | generator
  const [signupFilter, setSignupFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState("all");
  const [subscriptionFilter, setSubscriptionFilter] = useState("all");
  const [marketerFilter, setMarketerFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all"); // 기준 월: all | "1".."12"
  const [creditFilter, setCreditFilter] = useState("all"); // all | low | zero
  const [inquiryFilter, setInquiryFilter] = useState("all"); // all | any | open
  const [platformFilter, setPlatformFilter] = useState("all");
  const [augSubFilter, setAugSubFilter] = useState("all");
  const [tossFilter, setTossFilter] = useState("all");
  const [minLogins, setMinLogins] = useState("");
  const [minGenerations, setMinGenerations] = useState("");

  // Sort
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDesc, setSortDesc] = useState(true);
  // 표 보기 모드 (상호 배타):
  //  - "capture" (캡쳐용): 구분·메모·가입등록일·최근활동·접속·로그인·AI생성·무료·마케터제출 숨김
  //  - "marketer" (마케터 검토용): 사용자·구분·분야·회사·메모·멘토기관·생성기횟수·마케터제출만
  const [viewMode, setViewMode] = useState<ViewMode>(
    "normal"
  );
  const cap = viewMode === "capture";
  const mkt = viewMode === "marketer";
  const udb = viewMode === "userdb";
  // 유저DB캡쳐 화면에서 플랫폼 칸을 "인스타그램, 유튜브" 둘 다로 보여주는
  // 화면용 토글. 실제 marketingChannel 값은 그대로 두고 표시만 바꾼다.
  const [showTwoPlatforms, setShowTwoPlatforms] = useState(false);

  // 마케터 검토용: 팔로워/구독자/좋아요/댓글 인라인 입력 (draft = 편집 중 값)
  //   metricDraft[userId][metricKey] = 편집 중 문자열
  const [metricDraft, setMetricDraft] = useState<
    Record<string, Record<string, string>>
  >({});
  const [metricError, setMetricError] = useState<string | null>(null);

  // Detail
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<
    | "summary" | "memo" | "logins" | "posts" | "genlogs" | "marketer"
    | "credits" | "prepaid"
  >("summary");

  // 선결제 크레딧 (1원=1크레딧 충전 잔액)
  type PrepaidEntry = {
    id: string;
    amount: number;
    kind: string;
    method: string | null;
    memo: string | null;
    occurred_on: string;
    created_by: string | null;
  };
  const [prepaid, setPrepaid] = useState<{
    balance: number;
    entries: PrepaidEntry[];
    available: boolean;
  } | null>(null);
  const [prepaidAmount, setPrepaidAmount] = useState("");
  const [prepaidKind, setPrepaidKind] = useState("charge");
  const [prepaidMethod, setPrepaidMethod] = useState("bank_transfer");
  const [prepaidMemo, setPrepaidMemo] = useState("");
  const [prepaidSaving, setPrepaidSaving] = useState(false);
  const [prepaidResult, setPrepaidResult] = useState<string | null>(null);

  // Email edit (detail view)
  const [emailEditing, setEmailEditing] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailResult, setEmailResult] = useState<string | null>(null);

  // 분야(로컬/기술) edit (detail view)
  const [fieldSaving, setFieldSaving] = useState(false);
  const [fieldResult, setFieldResult] = useState<string | null>(null);

  // 메모(특이사항) edit (detail view)
  const [noteInput, setNoteInput] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteResult, setNoteResult] = useState<string | null>(null);

  // Marketer edit
  const [marketerForm, setMarketerForm] = useState<MarketerEditForm | null>(
    null
  );
  const [marketerSaving, setMarketerSaving] = useState(false);
  const [marketerResult, setMarketerResult] = useState<string | null>(null);

  // Credit grant
  const [grantAmount, setGrantAmount] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [grantMessage, setGrantMessage] = useState("");
  const [grantSaving, setGrantSaving] = useState(false);
  const [grantResult, setGrantResult] = useState<string | null>(null);

  async function loadUsers(token: string) {
    const res = await adminFetch("/api/admin/users/list", token);
    if (res.status === 401 || res.status === 403) {
      setPageState("forbidden");
      return;
    }
    if (!res.ok) {
      setPageState("error");
      return;
    }
    const data = (await res.json()) as {
      users: UserRow[];
      generatedAt: string;
    };
    setUsers(data.users ?? []);
    setGeneratedAt(data.generatedAt ?? null);
    setLoadedAtMs(Date.now());
    setPageState("ready");
  }

  useEffect(() => {
    void (async () => {
      const supabase = getSupabaseBrowserClientOrNull();
      if (!supabase) {
        setPageState("no_session");
        return;
      }
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      if (!token) {
        setPageState("no_session");
        return;
      }
      setAccessToken(token);
      await loadUsers(token);
    })();
  }, []);

  async function openDetail(user: UserRow) {
    setSelectedUser(user);
    setDetail(null);
    setDetailTab("summary");
    setEmailEditing(false);
    setEmailInput(user.email ?? "");
    setEmailResult(null);
    setFieldResult(null);
    setNoteInput(user.note ?? "");
    setNoteResult(null);
    setMarketerForm(null);
    setMarketerResult(null);
    setPrepaid(null);
    setPrepaidAmount("");
    setPrepaidMemo("");
    setPrepaidResult(null);
    void loadPrepaid(user.email);
    setGrantAmount("");
    setGrantReason("");
    setGrantMessage("");
    setGrantResult(null);
    setDetailLoading(true);
    try {
      // 미가입 (grant-only) rows have synthetic ids — look up by email instead
      const queryString = user.signedUp
        ? `userId=${user.id}`
        : `email=${encodeURIComponent(user.email ?? "")}`;
      const res = await adminFetch(
        `/api/admin/users/detail?${queryString}`,
        accessToken
      );
      if (res.ok) {
        const data = (await res.json()) as UserDetail;
        setDetail(data);
        setNoteInput(data.note ?? "");
        if (data.applications.length > 0) {
          setMarketerForm(applicationToEditForm(data.applications[0]));
        }
      }
    } finally {
      setDetailLoading(false);
    }
  }

  async function saveEmail() {
    if (!selectedUser || emailSaving) return;
    const newEmail = emailInput.trim();
    if (!newEmail) {
      setEmailResult("오류: 이메일을 입력해주세요.");
      return;
    }
    if (newEmail.toLowerCase() === (selectedUser.email ?? "").toLowerCase()) {
      setEmailResult("오류: 기존 이메일과 동일합니다.");
      return;
    }
    setEmailSaving(true);
    setEmailResult(null);
    try {
      const res = await adminFetch("/api/admin/users/email", accessToken, {
        method: "PATCH",
        body: JSON.stringify({
          userId: detail?.user.id ?? null,
          currentEmail: selectedUser.email,
          newEmail,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        newEmail?: string;
        warning?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setEmailResult(`오류: ${data.error ?? "이메일 변경에 실패했습니다."}`);
        return;
      }
      const updated = { ...selectedUser, email: data.newEmail ?? newEmail };
      setEmailEditing(false);
      // Refresh the list and reopen detail with the new email (openDetail
      // clears transient state, so set the result message afterwards).
      void loadUsers(accessToken);
      await openDetail(updated);
      setEmailResult(data.warning ?? "이메일이 변경되었습니다.");
    } catch {
      setEmailResult("오류: 이메일 변경에 실패했습니다.");
    } finally {
      setEmailSaving(false);
    }
  }

  async function saveField(value: string) {
    if (fieldSaving || !selectedUser) return;
    const grantId =
      detail && detail.grant ? (detail.grant.id as string | undefined) : undefined;
    if (!grantId) {
      setFieldResult("이 사용자는 사전등록(grant)이 없어 분야를 저장할 수 없습니다.");
      return;
    }
    setFieldSaving(true);
    setFieldResult(null);
    try {
      const res = await adminFetch("/api/admin/grants", accessToken, {
        method: "PATCH",
        body: JSON.stringify({ id: grantId, field: value }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFieldResult(`오류: ${data.error ?? "저장에 실패했습니다."}`);
        return;
      }
      void loadUsers(accessToken);
      await openDetail({ ...selectedUser, field: value });
      setFieldResult("분야가 저장되었습니다.");
    } catch {
      setFieldResult("오류: 저장에 실패했습니다.");
    } finally {
      setFieldSaving(false);
    }
  }

  const storedMetric = (u: UserRow, metric: MetricKey): number | null =>
    metric === "instagram"
      ? u.instaFollowerCount
      : metric === "youtube"
        ? u.youtubeSubCount
        : metric === "youtube_views"
          ? u.youtubeViewCount
          : metric === "post_likes"
            ? u.postLikesCount
            : u.postCommentsCount;

  // 지표(팔로워/구독자/좋아요/댓글)를 오늘 날짜로 저장 (마케터 검토용 인라인).
  // 값이 비어있거나 기존과 같으면 무시. 성공 시 users 낙관적 갱신 + draft 비움.
  async function saveMetric(user: UserRow, metric: MetricKey, raw: string) {
    const clearDraft = () =>
      setMetricDraft((d) => {
        const cur = { ...(d[user.id] ?? {}) };
        delete cur[metric];
        return { ...d, [user.id]: cur };
      });
    const trimmed = raw.replace(/,/g, "").trim();
    const stored = storedMetric(user, metric);
    if (trimmed === "") {
      clearDraft();
      return;
    }
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 0) {
      setMetricError(`${user.name || user.email}: 0 이상의 숫자만 입력하세요.`);
      return;
    }
    if (n === stored) {
      clearDraft();
      return;
    }
    setMetricError(null);
    try {
      const res = await adminFetch("/api/admin/users/metrics", accessToken, {
        method: "PUT",
        body: JSON.stringify({ email: user.email, platform: metric, count: n }),
      });
      const data = (await res.json()) as { recordedOn?: string; error?: string };
      if (!res.ok) {
        setMetricError(`저장 실패: ${data.error ?? ""}`);
        return;
      }
      const today =
        data.recordedOn ??
        new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
      setUsers((prev) =>
        prev.map((u) => {
          if (u.id !== user.id) return u;
          switch (metric) {
            case "instagram":
              return { ...u, instaFollowerCount: n, instaFollowerDate: today };
            case "youtube":
              return { ...u, youtubeSubCount: n, youtubeSubDate: today };
            case "youtube_views":
              return { ...u, youtubeViewCount: n, youtubeViewDate: today };
            case "post_likes":
              return { ...u, postLikesCount: n, postLikesDate: today };
            default:
              return { ...u, postCommentsCount: n, postCommentsDate: today };
          }
        })
      );
      clearDraft();
    } catch {
      setMetricError("저장 중 오류가 발생했습니다.");
    }
  }

  // 마케터 검토용의 지표 입력 셀 (팔로워/구독자/좋아요/댓글 공통).
  function metricCell(
    user: UserRow,
    metric: MetricKey,
    count: number | null,
    date: string | null
  ) {
    return (
      <td
        className="px-3 py-2.5 text-right"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="text"
          inputMode="numeric"
          value={
            metricDraft[user.id]?.[metric] ??
            (count != null ? String(count) : "")
          }
          onChange={(e) =>
            setMetricDraft((d) => ({
              ...d,
              [user.id]: { ...(d[user.id] ?? {}), [metric]: e.target.value },
            }))
          }
          onBlur={(e) => void saveMetric(user, metric, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="—"
          className="w-24 px-2 py-1 text-right text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400"
        />
        {date && (
          <p className="text-[10px] text-gray-400 mt-0.5">{date.slice(5)} 기준</p>
        )}
      </td>
    );
  }

  // 월별 토스 상태 저장 (7월/8월 각각 독립). users 낙관적 갱신.
  async function saveMonthlyToss(
    user: UserRow,
    month: string,
    status: string
  ) {
    const field = month === JULY_MONTH ? "julyToss" : "augustToss";
    const previous = month === JULY_MONTH ? user.julyToss : user.augustToss;
    if (previous === status) return;

    setUsers((prev) =>
      prev.map((u) => (u.id === user.id ? { ...u, [field]: status } : u))
    );
    try {
      const res = await adminFetch("/api/admin/users/monthly-toss", accessToken, {
        method: "PUT",
        body: JSON.stringify({ email: user.email, month, status }),
      });
      if (!res.ok) throw new Error("save failed");
    } catch {
      // 실패 시 원래 값으로 되돌린다.
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, [field]: previous } : u))
      );
      setMetricError("토스 상태 저장에 실패했습니다.");
    }
  }

  // 선결제 크레딧 잔액·내역 조회
  async function loadPrepaid(email: string | null) {
    if (!email) return;
    setPrepaid(null);
    try {
      const res = await adminFetch(
        `/api/admin/users/prepaid-credit?email=${encodeURIComponent(email)}`,
        accessToken
      );
      if (!res.ok) return;
      setPrepaid(await res.json());
    } catch {
      // 무시: 화면에 "불러오지 못했습니다"로 남는다
    }
  }

  // 선결제 충전/차감/조정 1건 기록
  async function savePrepaid() {
    const email = selectedUser?.email;
    if (!email || prepaidSaving) return;
    const n = Number(prepaidAmount.replace(/,/g, "").trim());
    if (!Number.isInteger(n) || n === 0) {
      setPrepaidResult("오류: 0이 아닌 정수를 입력하세요.");
      return;
    }
    setPrepaidSaving(true);
    setPrepaidResult(null);
    try {
      const res = await adminFetch("/api/admin/users/prepaid-credit", accessToken, {
        method: "POST",
        body: JSON.stringify({
          email,
          amount: n,
          kind: prepaidKind,
          method: prepaidKind === "charge" ? prepaidMethod : null,
          memo: prepaidMemo.trim() || null,
        }),
      });
      const data = (await res.json()) as { balance?: number; error?: string };
      if (!res.ok) {
        setPrepaidResult(`오류: ${data.error ?? "저장 실패"}`);
        return;
      }
      setPrepaidResult(`저장했습니다. 현재 잔액 ${(data.balance ?? 0).toLocaleString("ko-KR")} 크레딧`);
      setPrepaidAmount("");
      setPrepaidMemo("");
      await loadPrepaid(email);
      // 목록의 잔액도 즉시 갱신
      setUsers((prev) =>
        prev.map((u) =>
          u.email === email ? { ...u, prepaidBalance: data.balance ?? u.prepaidBalance } : u
        )
      );
    } catch {
      setPrepaidResult("오류: 저장에 실패했습니다.");
    } finally {
      setPrepaidSaving(false);
    }
  }

  // URL 셀 (7월/8월 채널·게시물 공통)
  function urlCell(url: string | null) {
    return (
      <td className="px-3 py-2.5">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={url}
            className="block max-w-[15rem] truncate text-blue-600 underline underline-offset-2 hover:text-blue-800"
          >
            {url}
          </a>
        ) : (
          <span className="text-gray-300">—</span>
        )}
      </td>
    );
  }

  // 월별 토스 셀 (뱃지 + 변경 셀렉트)
  function tossCell(user: UserRow, month: string) {
    const value = month === JULY_MONTH ? user.julyToss : user.augustToss;
    return (
      <td
        className="px-3 py-2.5 whitespace-nowrap"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TOSS_CLS[value] ?? TOSS_CLS.wait}`}
          >
            {TOSS_LABEL[value] ?? "대기"}
          </span>
          <select
            value={value}
            onChange={(e) => void saveMonthlyToss(user, month, e.target.value)}
            className="text-[11px] rounded border border-gray-200 bg-white px-1 py-0.5 text-gray-600"
            aria-label={`${month} 토스 상태 변경`}
          >
            <option value="wait">대기</option>
            <option value="in_progress">진행중</option>
            <option value="done">완료</option>
          </select>
        </div>
      </td>
    );
  }

  async function saveNote() {
    if (!selectedUser || noteSaving) return;
    const email = selectedUser.email;
    if (!email) {
      setNoteResult("오류: 이메일이 없어 메모를 저장할 수 없습니다.");
      return;
    }
    setNoteSaving(true);
    setNoteResult(null);
    try {
      const res = await adminFetch("/api/admin/users/note", accessToken, {
        method: "PUT",
        body: JSON.stringify({ email, note: noteInput }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setNoteResult(`오류: ${data.error ?? "저장에 실패했습니다."}`);
        return;
      }
      setNoteResult("메모가 저장되었습니다.");
      // Reflect in the open row + refresh the list so 전체 보기에도 반영.
      setSelectedUser({ ...selectedUser, note: noteInput });
      void loadUsers(accessToken);
    } catch {
      setNoteResult("오류: 저장에 실패했습니다.");
    } finally {
      setNoteSaving(false);
    }
  }

  async function saveMarketerForm() {
    if (!marketerForm || !marketerForm.id) return;
    setMarketerSaving(true);
    setMarketerResult(null);
    try {
      const res = await adminFetch("/api/admin/users/application", accessToken, {
        method: "PATCH",
        body: JSON.stringify(marketerForm),
      });
      if (res.ok) {
        setMarketerResult("저장되었습니다.");
      } else {
        const data = (await res.json()) as { error?: string };
        setMarketerResult(`오류: ${data.error ?? "저장에 실패했습니다."}`);
      }
    } catch {
      setMarketerResult("오류: 저장에 실패했습니다.");
    } finally {
      setMarketerSaving(false);
    }
  }

  async function submitCreditGrant() {
    if (!selectedUser || !detail?.user.id || grantSaving) return;
    const amount = Number(grantAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      setGrantResult("오류: 지급 수량을 확인해주세요.");
      return;
    }
    setGrantSaving(true);
    setGrantResult(null);
    try {
      const res = await adminFetch(
        "/api/admin/users/credit-grant",
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({
            userId: detail.user.id,
            email: detail.user.email,
            amount,
            reason: grantReason,
            message: grantMessage,
          }),
        }
      );
      const data = (await res.json()) as {
        ok?: boolean;
        applied?: string;
        warning?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setGrantResult(`오류: ${data.error ?? "지급에 실패했습니다."}`);
        return;
      }
      setGrantResult(
        data.warning ??
          (data.applied === "subscription_created"
            ? "지급 완료 (신규 1개월 구독 생성됨)"
            : "지급 완료")
      );
      setGrantAmount("");
      setGrantReason("");
      setGrantMessage("");
      // Refresh detail + list so credits reflect immediately
      await openDetail(selectedUser);
      void loadUsers(accessToken);
      setDetailTab("credits");
    } finally {
      setGrantSaving(false);
    }
  }

  const hostOrgs = useMemo(() => {
    const set = new Set<string>();
    for (const user of users) {
      if (user.hostOrg) set.add(user.hostOrg);
    }
    return [...set].sort();
  }, [users]);

  // Follow-up counts: pre-registered but not signed up, and AI 마케터 users
  // who haven't submitted their 마케터 제출 내역.
  const notSignedUpCount = useMemo(
    () => users.filter((u) => !u.signedUp).length,
    [users]
  );
  const marketerNotSubmittedCount = useMemo(
    () => users.filter((u) => u.aiMarketer && !u.marketerSubmitted).length,
    [users]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = loadedAtMs;
    const minLoginCount = Number(minLogins) || 0;
    const minGenCount = Number(minGenerations) || 0;

    const rows = users.filter((user) => {
      if (q) {
        const haystack = [
          user.name,
          user.email,
          user.companyName,
          user.brandName,
          user.hostOrg,
          user.mentorOrg,
          user.note,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (signupStateFilter === "signed" && !user.signedUp) return false;
      if (signupStateFilter === "pre" && user.signedUp) return false;
      if (serviceFilter === "free" && !user.freeUser) return false;
      if (serviceFilter === "marketer" && !user.aiMarketerSub) return false;
      if (serviceFilter === "generator" && !user.aiGeneratorSub) return false;
      if (hostOrgFilter !== "all" && user.hostOrg !== hostOrgFilter)
        return false;
      if (fieldFilter !== "all" && user.field !== fieldFilter) return false;
      if (signupFilter !== "all") {
        const created = user.createdAt ? new Date(user.createdAt).getTime() : 0;
        const days = Number(signupFilter);
        if (!created || now - created > days * 86400000) return false;
      }
      if (activityFilter !== "all") {
        const last = user.lastActivityAt
          ? new Date(user.lastActivityAt).getTime()
          : null;
        if (
          activityFilter === "active7" &&
          (!last || now - last > 7 * 86400000)
        )
          return false;
        if (
          activityFilter === "active30" &&
          (!last || now - last > 30 * 86400000)
        )
          return false;
        if (
          activityFilter === "inactive30" &&
          last !== null &&
          now - last <= 30 * 86400000
        )
          return false;
        if (activityFilter === "never" && last !== null) return false;
      }
      if (subscriptionFilter === "active" && !user.subscriptionActive)
        return false;
      if (subscriptionFilter === "inactive" && user.subscriptionActive)
        return false;
      if (creditFilter !== "all") {
        if (!user.subscriptionActive || user.remainingCredits === null)
          return false;
        if (creditFilter === "low" && user.remainingCredits >= 5) return false;
        if (creditFilter === "zero" && user.remainingCredits !== 0) return false;
      }
      if (inquiryFilter === "any" && user.inquiryCount === 0) return false;
      if (inquiryFilter === "open" && user.openInquiryCount === 0) return false;
      if (marketerFilter !== "all") {
        if (!user.aiMarketer) return false;
        if (marketerFilter === "submitted" && !user.marketerSubmitted)
          return false;
        if (marketerFilter === "unsubmitted" && user.marketerSubmitted)
          return false;
      }
      if (platformFilter !== "all") {
        // 미확인 = 채널 정보가 없어 플랫폼을 판정할 수 없는 사람(null)
        const platform = user.marketingChannel ?? "unknown";
        if (platform !== platformFilter) return false;
      }
      // 8월 제출 여부. 제출 경로(변경/유지/신규)는 열의 배지로 구분하고,
      // 필터는 업무 흐름대로 '냈다 / 안 냈다' 두 갈래만 둔다.
      const hasSubmitted = ["changed", "kept", "new"].includes(
        user.augustSubmission ?? ""
      );
      if (augSubFilter === "submitted" && !hasSubmitted) return false;
      if (augSubFilter === "pending" && user.augustSubmission !== "pending")
        return false;
      if (augSubFilter === "today") {
        if (!hasSubmitted || !user.augustSubmittedAt) return false;
        if (kstDate(user.augustSubmittedAt) !== kstDate(new Date().toISOString()))
          return false;
      }
      if (tossFilter !== "all" && user.augustToss !== tossFilter) return false;
      if (minLoginCount > 0 && user.loginCount < minLoginCount) return false;
      if (minGenCount > 0 && user.aiGenerationCount < minGenCount) return false;
      if (monthFilter !== "all") {
        const m = Number(monthFilter);
        const inMarketer =
          user.aiMarketer && parseMonths(user.marketerMonths).includes(m);
        const inGenerator =
          user.aiGenerator && parseMonths(user.generatorMonths).includes(m);
        if (!inMarketer && !inGenerator) return false;
      }
      return true;
    });

    const dir = sortDesc ? -1 : 1;
    return [...rows].sort((a, b) => {
      if (sortField === "name") {
        return (
          dir *
          (a.name ?? a.email ?? "").localeCompare(
            b.name ?? b.email ?? "",
            "ko"
          )
        );
      }
      if (sortField === "loginCount")
        return dir * (a.loginCount - b.loginCount);
      if (sortField === "accessCount")
        return dir * ((a.accessCount ?? -1) - (b.accessCount ?? -1));
      if (sortField === "aiGenerationCount")
        return dir * (a.aiGenerationCount - b.aiGenerationCount);
      if (sortField === "remainingCredits")
        return dir * ((a.remainingCredits ?? -1) - (b.remainingCredits ?? -1));
      const pick = (u: UserRow) =>
        (sortField === "createdAt"
          ? u.createdAt
          : sortField === "firstAccessAt"
            ? u.firstAccessAt ?? u.createdAt
            : u.lastActivityAt) ?? "";
      return dir * pick(a).localeCompare(pick(b));
    });
  }, [
    users,
    loadedAtMs,
    query,
    hostOrgFilter,
    fieldFilter,
    signupStateFilter,
    serviceFilter,
    signupFilter,
    activityFilter,
    subscriptionFilter,
    marketerFilter,
    monthFilter,
    creditFilter,
    inquiryFilter,
    platformFilter,
    augSubFilter,
    tossFilter,
    minLogins,
    minGenerations,
    sortField,
    sortDesc,
  ]);

  // 유저DB캡쳐 표는 마지막 접속일이 없는 사용자를 보여줄 이유가 없어 뺀다.
  const visibleRows = useMemo(
    () => (udb ? filtered.filter((u) => u.lastActivityAt) : filtered),
    [filtered, udb]
  );

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDesc((prev) => !prev);
    } else {
      setSortField(field);
      setSortDesc(true);
    }
  }

  function sortIndicator(field: SortField) {
    if (sortField !== field) return "";
    return sortDesc ? " ↓" : " ↑";
  }

  // ── Early states ──────────────────────────────────────────────────────────

  if (pageState !== "ready") {
    const message =
      pageState === "loading"
        ? "로딩 중..."
        : pageState === "no_session"
          ? "관리자 로그인이 필요합니다."
          : pageState === "forbidden"
            ? "접근 권한이 없습니다."
            : "데이터를 불러오지 못했습니다.";
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500">
        {message}
      </div>
    );
  }

  const headerCls =
    "px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap cursor-pointer select-none hover:text-gray-800";
  const plainHeaderCls =
    "px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap";

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-[1500px] mx-auto px-4 py-8 space-y-5">
        <AdminNav current="users" />
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">전체 유저</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              가입·미가입 사용자를 검색하고 상세 정보·생성 횟수를 관리합니다.
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              전체 {users.length.toLocaleString()}명 (미가입 포함) · 필터 결과{" "}
              {visibleRows.length.toLocaleString()}명
              {generatedAt &&
                ` · 갱신 ${new Date(generatedAt).toLocaleTimeString("ko-KR")}`}
              {" · "}미가입 = 아직 회원가입하지 않은 사전등록 사용자
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() =>
                setViewMode((v) => (v === "capture" ? "normal" : "capture"))
              }
              title="켜면 구분·메모·가입등록일·접속·로그인·AI생성·무료·마케터제출 열을 숨깁니다 — 화면 캡쳐용"
              className={`text-sm px-4 py-2 rounded-xl border transition-colors ${
                cap
                  ? "border-gray-900 bg-gray-900 text-white hover:bg-gray-700"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              캡쳐용{cap ? " ✓" : ""}
            </button>
            <button
              onClick={() =>
                setViewMode((v) => (v === "userdb" ? "normal" : "userdb"))
              }
              title="사용자·플랫폼·AI 마케터 제출 내역·마지막 접속일만 표시 — 유저 DB 캡쳐용"
              className={`text-sm px-4 py-2 rounded-xl border transition-colors ${
                udb
                  ? "border-gray-900 bg-gray-900 text-white hover:bg-gray-700"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              유저DB캡쳐{udb ? " ✓" : ""}
            </button>
            {udb && (
              <button
                onClick={() => setShowTwoPlatforms((v) => !v)}
                title="화면 표시만 인스타그램·유튜브 둘 다로 바꿉니다 — 실제 데이터는 그대로"
                className={`text-sm px-4 py-2 rounded-xl border transition-colors ${
                  showTwoPlatforms
                    ? "border-gray-900 bg-gray-900 text-white hover:bg-gray-700"
                    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                2개{showTwoPlatforms ? " ✓" : ""}
              </button>
            )}
            <button
              onClick={() =>
                setViewMode((v) => (v === "marketer" ? "normal" : "marketer"))
              }
              title="사용자·구분·분야·회사·메모·멘토기관·생성기횟수·마케터제출만 표시 — 마케터 검토용"
              className={`text-sm px-4 py-2 rounded-xl border transition-colors ${
                mkt
                  ? "border-gray-900 bg-gray-900 text-white hover:bg-gray-700"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              마케터 검토용{mkt ? " ✓" : ""}
            </button>
            <button
              onClick={() => loadUsers(accessToken)}
              className="text-sm px-4 py-2 rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
            >
              새로고침
            </button>
            <button
              onClick={() => void exportXlsx(visibleRows, viewMode)}
              disabled={visibleRows.length === 0}
              title={
                mkt
                  ? "마케터 검토용 열 구성으로 내보내기"
                  : cap
                    ? "캡쳐용 열 구성으로 내보내기"
                    : udb
                      ? "유저DB캡쳐 열 구성으로 내보내기"
                      : "전체 열로 내보내기"
              }
              className="text-sm px-4 py-2 rounded-xl bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-40"
            >
              엑셀 내보내기 ({visibleRows.length}
              {mkt
                ? " · 마케터"
                : cap
                  ? " · 캡쳐용"
                  : udb
                    ? " · 유저DB"
                    : ""}
              )
            </button>
          </div>
        </div>

        {/* Follow-up counts */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => {
              setSignupStateFilter("pre");
              setServiceFilter("all");
              setMarketerFilter("all");
            }}
            className="text-left bg-white rounded-2xl border border-gray-200 shadow-sm p-4 hover:border-gray-300 transition-colors"
          >
            <p className="text-xs font-medium text-gray-500">
              사전등록 후 미가입
            </p>
            <p className="mt-1 text-2xl font-bold text-amber-600">
              {notSignedUpCount.toLocaleString()}
              <span className="ml-1 text-sm font-normal text-gray-400">명</span>
            </p>
          </button>
          <button
            onClick={() => {
              setSignupStateFilter("all");
              setServiceFilter("all");
              setMarketerFilter("unsubmitted");
            }}
            className="text-left bg-white rounded-2xl border border-gray-200 shadow-sm p-4 hover:border-gray-300 transition-colors"
          >
            <p className="text-xs font-medium text-gray-500">
              AI 마케터 · 제출 안 함
            </p>
            <p className="mt-1 text-2xl font-bold text-red-500">
              {marketerNotSubmittedCount.toLocaleString()}
              <span className="ml-1 text-sm font-normal text-gray-400">명</span>
            </p>
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3">
          <input
            type="text"
            placeholder="이름 · 이메일 · 회사 · 브랜드 · 주관/멘토기관 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={inputCls}
          />
          <div className="flex flex-wrap gap-2">
            <select
              value={signupStateFilter}
              onChange={(e) => setSignupStateFilter(e.target.value)}
              className={filterCls(signupStateFilter)}
            >
              <option value="all">가입 여부: 전체</option>
              <option value="signed">가입 여부: 가입함</option>
              <option value="pre">가입 여부: 미가입(사전등록)</option>
            </select>
            <select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className={filterCls(serviceFilter)}
            >
              <option value="all">이용 유형: 전체</option>
              <option value="free">이용 유형: 무료 유저</option>
              <option value="marketer">이용 유형: AI 마케터</option>
              <option value="generator">이용 유형: AI 생성기</option>
            </select>
            <select
              value={fieldFilter}
              onChange={(e) => setFieldFilter(e.target.value)}
              className={filterCls(fieldFilter)}
            >
              <option value="all">분야: 전체</option>
              <option value="local">분야: 로컬</option>
              <option value="tech">분야: 기술</option>
            </select>
            <select
              value={hostOrgFilter}
              onChange={(e) => setHostOrgFilter(e.target.value)}
              className={filterCls(hostOrgFilter)}
            >
              <option value="all">주관기관: 전체</option>
              {hostOrgs.map((org) => (
                <option key={org} value={org}>
                  {`주관기관: ${org}`}
                </option>
              ))}
            </select>
            <select
              value={signupFilter}
              onChange={(e) => setSignupFilter(e.target.value)}
              className={filterCls(signupFilter)}
            >
              <option value="all">가입일: 전체</option>
              <option value="1">가입일: 오늘</option>
              <option value="7">가입일: 최근 7일</option>
              <option value="30">가입일: 최근 30일</option>
              <option value="90">가입일: 최근 90일</option>
            </select>
            <select
              value={activityFilter}
              onChange={(e) => setActivityFilter(e.target.value)}
              className={filterCls(activityFilter)}
            >
              <option value="all">활동: 전체</option>
              <option value="active7">활동: 7일 내</option>
              <option value="active30">활동: 30일 내</option>
              <option value="inactive30">활동: 30일 이상 없음</option>
              <option value="never">활동: 기록 없음</option>
            </select>
            <select
              value={subscriptionFilter}
              onChange={(e) => setSubscriptionFilter(e.target.value)}
              className={filterCls(subscriptionFilter)}
            >
              <option value="all">생성기 구독: 전체</option>
              <option value="active">생성기 구독: 구독중</option>
              <option value="inactive">생성기 구독: 미구독</option>
            </select>
            <select
              value={creditFilter}
              onChange={(e) => setCreditFilter(e.target.value)}
              className={filterCls(creditFilter)}
            >
              <option value="all">생성 횟수: 전체</option>
              <option value="low">생성 횟수: 5회 미만</option>
              <option value="zero">생성 횟수: 0회</option>
            </select>
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value)}
              className={filterCls(platformFilter)}
            >
              <option value="all">플랫폼: 전체</option>
              <option value="instagram">플랫폼: 인스타그램</option>
              <option value="youtube">플랫폼: 유튜브</option>
              <option value="unknown">플랫폼: 미확인</option>
            </select>
            <select
              value={augSubFilter}
              onChange={(e) => setAugSubFilter(e.target.value)}
              className={filterCls(augSubFilter)}
            >
              <option value="all">8월 제출: 전체</option>
              <option value="submitted">8월 제출: 제출함</option>
              <option value="today">8월 제출: 오늘 제출</option>
              <option value="pending">8월 제출: 미제출</option>
            </select>
            <select
              value={tossFilter}
              onChange={(e) => setTossFilter(e.target.value)}
              className={filterCls(tossFilter)}
            >
              <option value="all">8월 토스: 전체</option>
              <option value="wait">8월 토스: 대기</option>
              <option value="in_progress">8월 토스: 진행중</option>
              <option value="done">8월 토스: 완료</option>
            </select>
            <select
              value={marketerFilter}
              onChange={(e) => setMarketerFilter(e.target.value)}
              className={filterCls(marketerFilter)}
            >
              <option value="all">신청서 제출: 전체</option>
              <option value="submitted">신청서 제출: 완료</option>
              <option value="unsubmitted">신청서 제출: 미제출</option>
            </select>
            <select
              value={monthFilter}
              onChange={(e) => setMonthFilter(e.target.value)}
              className={filterCls(monthFilter)}
            >
              <option value="all">이용 월: 전체</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={String(m)}>
                  이용 월: {m}월
                </option>
              ))}
            </select>
            <select
              value={inquiryFilter}
              onChange={(e) => setInquiryFilter(e.target.value)}
              className={filterCls(inquiryFilter)}
            >
              <option value="all">문의: 전체</option>
              <option value="any">문의: 있음</option>
              <option value="open">문의: 미답변 있음</option>
            </select>
            <input
              type="number"
              min="0"
              placeholder="최소 로그인 수"
              value={minLogins}
              onChange={(e) => setMinLogins(e.target.value)}
              className={`${selectCls} w-32`}
            />
            <input
              type="number"
              min="0"
              placeholder="최소 AI 생성 수"
              value={minGenerations}
              onChange={(e) => setMinGenerations(e.target.value)}
              className={`${selectCls} w-36`}
            />
          </div>
        </div>

        {mkt && (
          <div className="flex items-center justify-between gap-3 text-xs">
            <p className="text-gray-500">
              인스타 팔로워·유튜브 구독자 칸에 숫자를 입력하고 <b>Enter</b> 또는 다른
              곳 클릭 시 <b>오늘 날짜</b>로 저장됩니다. (다시 입력하면 오늘 값이 갱신,
              날짜가 바뀌면 이력으로 쌓임)
            </p>
            {metricError && (
              <p className="text-red-500 whitespace-nowrap">{metricError}</p>
            )}
          </div>
        )}

        {/* 유저DB캡쳐: 열 구성이 넓은 표와 전혀 달라 따로 그린다. 넓은 표에
            네 번째 플래그를 끼워 넣으면 40여 개 열의 헤더·셀 짝이 어긋나기
            쉬워, 필요한 네 칸만 담은 표를 쓴다. */}
        {udb ? (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100">
                <tr>
                  <th className={headerCls} onClick={() => toggleSort("name")}>
                    사용자{sortIndicator("name")}
                  </th>
                  <th className={plainHeaderCls}>플랫폼</th>
                  <th className={plainHeaderCls}>전화</th>
                  <th className={plainHeaderCls}>구독 중인 서비스</th>
                  <th className={plainHeaderCls}>마케팅 진행중인 정보</th>
                  <th className={plainHeaderCls}>마지막 접속일</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visibleRows.map((user) => (
                  <tr
                    key={user.id}
                    onClick={() => setSelectedUser(user)}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-gray-900">
                        {user.name ?? "—"}
                      </p>
                      <p className="text-xs text-gray-500">
                        {user.email ?? "—"}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                      {showTwoPlatforms
                        ? "인스타그램, 유튜브"
                        : user.marketingChannel === "youtube"
                          ? "유튜브"
                          : user.marketingChannel === "instagram"
                            ? "인스타그램"
                            : "—"}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                      {user.phone ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {subscribedServices(user).length ? (
                        <span className="inline-flex flex-wrap gap-1">
                          {subscribedServices(user).map((name) => (
                            <span
                              key={name}
                              className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-700"
                            >
                              {name}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {!user.aiMarketerSub ? (
                        <span className="text-xs text-gray-300">
                          마케터 구독 아님
                        </span>
                      ) : (
                        <UrlPair {...submittedUrls(user)} />
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                      {user.lastActivityAt?.slice(0, 10) ?? (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-10 text-center text-gray-400"
                    >
                      조건에 맞는 사용자가 없습니다
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100">
              <tr>
                <th className={headerCls} onClick={() => toggleSort("name")}>
                  사용자{sortIndicator("name")}
                </th>
                {!cap && <th className={plainHeaderCls}>구분</th>}
                <th className={plainHeaderCls}>분야</th>
                <th className={plainHeaderCls}>회사</th>
                {!cap && <th className={plainHeaderCls}>메모</th>}
                {!cap && <th className={plainHeaderCls}>플랫폼</th>}
                {!cap && <th className={plainHeaderCls}>8월 제출</th>}
                {!cap && <th className={plainHeaderCls}>제출일</th>}
                {!cap && <th className={plainHeaderCls}>7월 토스</th>}
                {!cap && <th className={plainHeaderCls}>8월 토스</th>}
                {!cap && <th className={plainHeaderCls}>7월 마케팅</th>}
                {!cap && !mkt && <th className={plainHeaderCls}>8월 마케팅</th>}
                {!mkt && <th className={plainHeaderCls}>주관기관</th>}
                <th className={plainHeaderCls}>멘토기관</th>
                {!cap && !mkt && (
                  <th
                    className={headerCls}
                    onClick={() => toggleSort("createdAt")}
                  >
                    가입/등록일{sortIndicator("createdAt")}
                  </th>
                )}
                {!mkt && (
                  <th
                    className={headerCls}
                    onClick={() => toggleSort("firstAccessAt")}
                  >
                    최초 접속일{sortIndicator("firstAccessAt")}
                  </th>
                )}
                {!cap && !mkt && (
                  <th
                    className={headerCls}
                    onClick={() => toggleSort("lastActivityAt")}
                  >
                    최근 활동{sortIndicator("lastActivityAt")}
                  </th>
                )}
                {!cap && !mkt && (
                  <>
                    <th
                      className={`${headerCls} text-right`}
                      onClick={() => toggleSort("accessCount")}
                    >
                      접속 횟수{sortIndicator("accessCount")}
                    </th>
                    <th
                      className={`${headerCls} text-right`}
                      onClick={() => toggleSort("loginCount")}
                    >
                      로그인{sortIndicator("loginCount")}
                    </th>
                    <th
                      className={`${headerCls} text-right`}
                      onClick={() => toggleSort("aiGenerationCount")}
                    >
                      AI 생성{sortIndicator("aiGenerationCount")}
                    </th>
                    <th className={`${plainHeaderCls} text-center`}>무료</th>
                  </>
                )}
                {!mkt && (
                  <th className={`${plainHeaderCls} text-center`}>마케터</th>
                )}
                {!mkt && (
                  <th className={`${plainHeaderCls} text-center`}>생성기</th>
                )}
                {!mkt && (
                  <th className={`${plainHeaderCls} text-center`}>마케터 개월</th>
                )}
                {!mkt && (
                  <th className={`${plainHeaderCls} text-center`}>생성기 개월</th>
                )}
                {!mkt && (
                  <th className={`${plainHeaderCls} text-right`}>선결제 크레딧</th>
                )}
                {!mkt && (
                  <th className={`${plainHeaderCls} text-right`}>마케터 수량</th>
                )}
                <th
                  className={`${headerCls} text-right`}
                  onClick={() => toggleSort("remainingCredits")}
                >
                  생성기 잔여 횟수{sortIndicator("remainingCredits")}
                </th>
                {!cap && <th className={plainHeaderCls}>마케터 제출</th>}
                {mkt && <th className={plainHeaderCls}>댓글 이벤트</th>}
                {mkt && <th className={plainHeaderCls}>7월 채널 주소</th>}
                {mkt && <th className={plainHeaderCls}>7월 게시물 주소</th>}
                {mkt && <th className={plainHeaderCls}>8월 채널 주소</th>}
                {mkt && <th className={plainHeaderCls}>8월 게시물 주소</th>}
                {mkt && (
                  <th className={`${plainHeaderCls} text-right`}>인스타 팔로워</th>
                )}
                {mkt && (
                  <th className={`${plainHeaderCls} text-right`}>유튜브 구독자</th>
                )}
                {mkt && (
                  <th className={`${plainHeaderCls} text-right`}>유튜브 조회수</th>
                )}
                {mkt && (
                  <th className={`${plainHeaderCls} text-right`}>게시물 좋아요</th>
                )}
                {mkt && (
                  <th className={`${plainHeaderCls} text-right`}>게시물 댓글</th>
                )}
                {!mkt && <th className={`${plainHeaderCls} text-right`}>문의</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => {
                const activity = activityLabel(user.lastActivityAt, loadedAtMs);
                return (
                  <tr
                    key={user.id}
                    onClick={() => openDetail(user)}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-gray-900">
                        {user.name || "—"}
                      </p>
                      <p className="text-xs text-gray-400">{user.email}</p>
                    </td>
                    {!cap && (
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {user.signedUp ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            가입
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                            미가입
                          </span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          user.field === "local"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {fieldLabel(user.field)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                      {user.companyName || user.brandName || "—"}
                    </td>
                    {!cap && (
                      <td
                        className="px-3 py-2.5 text-gray-600 max-w-[16rem] truncate"
                        title={user.note || undefined}
                      >
                        {user.note ? (
                          <span className="text-amber-700">{user.note}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                    )}
                    {!cap && (
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {user.marketingChannel === "instagram" ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-pink-100 text-pink-700">
                            인스타
                          </span>
                        ) : user.marketingChannel === "youtube" ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                            유튜브
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    )}
                    {!cap && (
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {user.augustSubmission ? (
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${AUG_SUB_CLS[user.augustSubmission] ?? ""}`}
                          >
                            {AUG_SUB_LABEL[user.augustSubmission]}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    )}
                    {!cap && (
                      <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                        {user.augustSubmittedAt ? (
                          <span
                            className={
                              kstDate(user.augustSubmittedAt) ===
                              kstDate(new Date().toISOString())
                                ? "font-semibold text-emerald-600"
                                : ""
                            }
                          >
                            {kstDate(user.augustSubmittedAt).slice(5)}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    )}
                    {!cap && tossCell(user, JULY_MONTH)}
                    {!cap && tossCell(user, AUGUST_MONTH)}
                    {!cap && (
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {user.julyMarketing === null ? (
                          <span className="text-gray-300">—</span>
                        ) : user.julyMarketing === "done" ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            완료
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                            미완료
                          </span>
                        )}
                      </td>
                    )}
                    {!cap && !mkt && (
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {user.augustMarketing === null ? (
                          <span className="text-gray-300">—</span>
                        ) : user.augustMarketing === "keep" ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            유지
                          </span>
                        ) : user.augustMarketing === "change" ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                            변경
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                            미정
                          </span>
                        )}
                      </td>
                    )}
                    {!mkt && (
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                        {user.hostOrg || "—"}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                      {user.mentorOrg || "—"}
                    </td>
                    {!cap && !mkt && (
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                        {fmtDate(user.createdAt)}
                      </td>
                    )}
                    {!mkt && (
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                        {fmtDate(user.firstAccessAt ?? user.createdAt)}
                      </td>
                    )}
                    {!cap && !mkt && (
                      <td
                        className={`px-3 py-2.5 whitespace-nowrap ${activity.cls}`}
                      >
                        {activity.label}
                      </td>
                    )}
                    {!cap && !mkt && (
                      <>
                        <td className="px-3 py-2.5 text-right text-gray-600">
                          {user.accessCount === null ? "-" : user.accessCount}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-600">
                          {user.loginCount}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-600">
                          {user.aiGenerationCount}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <Dot on={user.freeUser} />
                        </td>
                      </>
                    )}
                    {!mkt && (
                      <td className="px-3 py-2.5 text-center">
                        <Dot on={user.aiMarketerSub} />
                      </td>
                    )}
                    {!mkt && (
                      <td className="px-3 py-2.5 text-center">
                        <Dot on={user.aiGeneratorSub} />
                      </td>
                    )}
                    {!mkt && (
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        <MonthsCell
                          months={user.marketerMonths}
                          on={user.aiMarketer}
                          highlight={monthFilter}
                        />
                      </td>
                    )}
                    {!mkt && (
                      <td className="px-3 py-2.5 text-center whitespace-nowrap">
                        <MonthsCell
                          months={user.generatorMonths}
                          on={user.aiGenerator}
                          highlight={monthFilter}
                        />
                      </td>
                    )}
                    {!mkt && (
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {user.prepaidBalance ? (
                          <span
                            className={
                              user.prepaidBalance > 0
                                ? "font-semibold text-violet-700"
                                : "font-semibold text-red-600"
                            }
                          >
                            {user.prepaidBalance.toLocaleString("ko-KR")}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    )}
                    {!mkt && (
                      <td className="px-3 py-2.5 text-right text-gray-600">
                        {user.marketerQuantity ?? "—"}
                      </td>
                    )}
                    <td className="px-3 py-2.5 text-right text-gray-600">
                      {user.remainingCredits !== null ? (
                        user.remainingCredits
                      ) : user.grantGeneratorCredits !== null ? (
                        <span className="text-gray-400">
                          {user.grantGeneratorCredits}{" "}
                          <span className="text-[10px]">(부여)</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    {!cap && (
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {!user.aiMarketer ? (
                          <span className="text-xs text-gray-300">대상 아님</span>
                        ) : user.marketerSubmitted ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                            제출완료
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                            미제출
                          </span>
                        )}
                      </td>
                    )}
                    {mkt && (
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {user.augustSubmission === null ? (
                          <span className="text-gray-300">—</span>
                        ) : user.augustCommentsIncluded === true ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                            포함
                          </span>
                        ) : user.augustCommentsIncluded === false ? (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                            미포함
                          </span>
                        ) : (
                          <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                            미지정
                          </span>
                        )}
                      </td>
                    )}
                    {mkt && urlCell(user.julyChannelUrl)}
                    {mkt && urlCell(user.julyPostUrl)}
                    {mkt && urlCell(user.augustChannelUrl)}
                    {mkt && urlCell(user.augustPostUrl)}
                    {mkt &&
                      metricCell(
                        user,
                        "instagram",
                        user.instaFollowerCount,
                        user.instaFollowerDate
                      )}
                    {mkt &&
                      metricCell(
                        user,
                        "youtube",
                        user.youtubeSubCount,
                        user.youtubeSubDate
                      )}
                    {mkt &&
                      metricCell(
                        user,
                        "youtube_views",
                        user.youtubeViewCount,
                        user.youtubeViewDate
                      )}
                    {mkt &&
                      metricCell(
                        user,
                        "post_likes",
                        user.postLikesCount,
                        user.postLikesDate
                      )}
                    {mkt &&
                      metricCell(
                        user,
                        "post_comments",
                        user.postCommentsCount,
                        user.postCommentsDate
                      )}
                    {!mkt && (
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {user.inquiryCount > 0 ? (
                          <span
                            className={
                              user.openInquiryCount > 0
                                ? "text-red-500 font-medium"
                                : "text-gray-600"
                            }
                          >
                            {user.inquiryCount}
                            {user.openInquiryCount > 0 &&
                              ` (미답변 ${user.openInquiryCount})`}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={cap ? 13 : mkt ? 15 : 24}
                    className="px-3 py-10 text-center text-gray-400"
                  >
                    조건에 맞는 사용자가 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* ── Detail modal ─────────────────────────────────────────────────────── */}
      {selectedUser && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedUser(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {selectedUser.name || selectedUser.email}
                  {!selectedUser.signedUp && (
                    <span className="ml-2 align-middle inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                      미가입
                    </span>
                  )}
                </h2>
                {!emailEditing ? (
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-gray-500">{selectedUser.email}</p>
                    <button
                      onClick={() => {
                        setEmailInput(selectedUser.email ?? "");
                        setEmailResult(null);
                        setEmailEditing(true);
                      }}
                      className="text-xs text-gray-400 hover:text-gray-700 underline"
                    >
                      이메일 수정
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 mt-1">
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="새 이메일"
                      className="px-2 py-1 text-sm bg-white text-gray-900 border border-gray-300 rounded-lg w-56 focus:outline-none focus:border-gray-500"
                    />
                    <button
                      onClick={() => void saveEmail()}
                      disabled={emailSaving}
                      className="text-xs px-2.5 py-1 rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40"
                    >
                      {emailSaving ? "저장 중..." : "저장"}
                    </button>
                    <button
                      onClick={() => {
                        setEmailEditing(false);
                        setEmailResult(null);
                      }}
                      disabled={emailSaving}
                      className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
                    >
                      취소
                    </button>
                  </div>
                )}
                {emailResult && (
                  <p
                    className={`text-xs mt-1 ${
                      emailResult.startsWith("오류")
                        ? "text-red-500"
                        : "text-green-600"
                    }`}
                  >
                    {emailResult}
                  </p>
                )}
                {detail && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs text-gray-500">분야</span>
                    <select
                      value={(detail.grant?.field as string) ?? "tech"}
                      onChange={(e) => void saveField(e.target.value)}
                      disabled={fieldSaving || !detail.grant?.id}
                      className="text-xs px-2 py-1 rounded-lg border border-gray-300 bg-white text-gray-800 disabled:opacity-50"
                    >
                      <option value="tech">기술</option>
                      <option value="local">로컬</option>
                    </select>
                    {!detail.grant?.id && (
                      <span className="text-[11px] text-gray-400">
                        (사전등록 없음 — 저장 불가)
                      </span>
                    )}
                    {fieldResult && (
                      <span
                        className={`text-[11px] ${
                          fieldResult.startsWith("오류")
                            ? "text-red-500"
                            : "text-green-600"
                        }`}
                      >
                        {fieldResult}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={() => setSelectedUser(null)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {detailLoading ? (
              <div className="p-10 text-center text-gray-500">로딩 중...</div>
            ) : !detail ? (
              <div className="p-10 text-center text-red-500">
                사용자 정보를 불러올 수 없습니다
              </div>
            ) : (
              <div className="p-6 space-y-5">
                {/* Key stats strip */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-500">가입일</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {fmtDate(
                        detail.user.createdAt ?? detail.loginStats.authCreatedAt
                      )}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-500">최근 로그인</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {fmtDateTime(detail.loginStats.lastLoginAt)}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-500">로그인 수</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {detail.loginStats.count}
                      <span className="text-xs font-normal text-gray-400 ml-1">
                        (기록 시작 이후)
                      </span>
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-500">AI 생성</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {detail.aiUsage.totalGenerations}
                      <span className="text-xs font-normal text-gray-400 ml-1">
                        (무료 {detail.aiUsage.freeTrialGenerations})
                      </span>
                    </p>
                  </div>
                </div>

                {/* Subscription strip */}
                <div className="flex items-center gap-3 bg-gray-50 rounded-xl p-3 text-sm">
                  {detail.subscription?.isActive ? (
                    <>
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        구독중
                      </span>
                      <span className="text-gray-700">
                        남은 생성 횟수{" "}
                        <b>{detail.subscription.remainingCredits}</b>
                      </span>
                      <span className="text-gray-500">
                        {fmtDate(detail.subscription.startDate)} ~{" "}
                        {fmtDate(detail.subscription.endDate)}
                      </span>
                    </>
                  ) : (
                    <span className="text-gray-500">활성 구독 없음</span>
                  )}
                </div>

                {/* Tabs */}
                <div className="flex gap-1 border-b border-gray-100 overflow-x-auto">
                  {(
                    [
                      ["summary", "기본 정보"],
                      ["memo", detail.note ? "메모 ●" : "메모"],
                      ["logins", `로그인 기록 (${detail.loginHistory.length})`],
                      ["posts", `AI 생성물 (${detail.posts.length})`],
                      ["genlogs", `생성 로그 (${detail.generationLogs.length})`],
                      ["marketer", "마케터 제출"],
                      ["credits", `생성 횟수 지급 (${detail.creditGrants.length})`],
                      ["prepaid", "선결제 크레딧"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setDetailTab(key)}
                      className={`px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors ${
                        detailTab === key
                          ? "border-gray-900 text-gray-900 font-medium"
                          : "border-transparent text-gray-400 hover:text-gray-600"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Tab: summary */}
                {detailTab === "summary" && (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    {(
                      [
                        ["이름", detail.user.name],
                        ["회사명", detail.user.companyName],
                        [
                          "주관기관",
                          (detail.grant?.host_org as string | null) ?? null,
                        ],
                        [
                          "멘토기관",
                          (detail.grant?.mentor_org as string | null) ?? null,
                        ],
                        [
                          "전화",
                          (detail.grant?.phone as string | null) ?? null,
                        ],
                        ["인스타그램", detail.user.instagramUrl],
                        ["유튜브", detail.user.youtubeUrl],
                        [
                          "온보딩 완료",
                          detail.user.accountOnboardedAt
                            ? fmtDate(detail.user.accountOnboardedAt)
                            : "미완료",
                        ],
                        [
                          "최초 접속일",
                          detail.accessStats.firstAccessAt
                            ? fmtDateTime(detail.accessStats.firstAccessAt)
                            : "-",
                        ],
                        [
                          "접속 횟수",
                          detail.accessStats.accessCount === null
                            ? "-"
                            : `${detail.accessStats.accessCount}회`,
                        ],
                        [
                          "인증 기준 최근 로그인",
                          fmtDateTime(detail.loginStats.authLastSignInAt),
                        ],
                        [
                          "최근 AI 생성",
                          fmtDateTime(detail.aiUsage.latestGeneratedAt),
                        ],
                        ["최근 생성물", detail.aiUsage.latestTitle],
                      ] as Array<[string, string | null]>
                    ).map(([label, value]) => (
                      <div key={label}>
                        <p className="text-xs text-gray-500">{label}</p>
                        <p className="text-gray-900 break-all">
                          {value || "—"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Tab: memo (특이사항) */}
                {detailTab === "memo" && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500">
                      이 유저에 대한 특이사항을 적어두세요. 전체 유저 목록의 &lsquo;메모&rsquo;
                      열에도 표시됩니다.
                    </p>
                    <textarea
                      value={noteInput}
                      onChange={(e) => setNoteInput(e.target.value)}
                      rows={6}
                      placeholder="예: 결제 확인 대기 / 인증메일 수동처리함 / 담당자 요청사항 등"
                      className={`${inputCls} resize-none`}
                    />
                    <div className="flex items-center gap-3">
                      <button
                        onClick={saveNote}
                        disabled={noteSaving}
                        className="text-sm px-4 py-2 rounded-xl bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-40"
                      >
                        {noteSaving ? "저장 중..." : "메모 저장"}
                      </button>
                      {noteResult && (
                        <p
                          className={`text-sm ${
                            noteResult.startsWith("오류")
                              ? "text-red-500"
                              : "text-green-600"
                          }`}
                        >
                          {noteResult}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Tab: login history */}
                {detailTab === "logins" &&
                  (detail.loginHistory.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4">
                      기록된 로그인이 없습니다. (로그인 기록은 기능 도입 이후부터
                      쌓입니다 — 인증 기준 최근 로그인:{" "}
                      {fmtDateTime(detail.loginStats.authLastSignInAt)})
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {detail.loginHistory.map((event, index) => (
                        <div
                          key={index}
                          className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm"
                        >
                          <span className="text-gray-900">
                            {fmtDateTime(event.occurredAt)}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              event.eventType === "login"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-gray-200 text-gray-600"
                            }`}
                          >
                            {event.eventType === "login" ? "로그인" : "방문"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}

                {/* Tab: saved posts */}
                {detailTab === "posts" &&
                  (detail.posts.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4">
                      생성 내역이 없습니다.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {detail.posts.map((post) => (
                        <div
                          key={post.id}
                          className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm gap-3"
                        >
                          <span className="text-gray-900 truncate">
                            {post.title || "(제목 없음)"}
                          </span>
                          <span className="text-xs text-gray-500 whitespace-nowrap">
                            {fmtDateTime(post.createdAt)} ·{" "}
                            {post.isFreeTrial ? "무료" : "구독"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}

                {/* Tab: generation logs (attempts incl. failures) */}
                {detailTab === "genlogs" &&
                  (detail.generationLogs.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4">
                      생성 시도 로그가 없습니다. (로그는 기능 도입 이후부터
                      쌓입니다)
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {detail.generationLogs.map((log) => {
                        const outcome = str(log.outcome);
                        const success = outcome === "success";
                        return (
                          <div
                            key={str(log.id)}
                            className="px-3 py-2 bg-gray-50 rounded-lg text-sm space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs text-gray-500">
                                {fmtDateTime(str(log.created_at))} ·{" "}
                                {str(log.usage_mode) === "premium"
                                  ? "구독"
                                  : "무료"}{" "}
                                · {Math.round(Number(log.duration_ms ?? 0) / 1000)}
                                초 · 이미지 {Number(log.image_count ?? 0)}장
                              </span>
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full ${
                                  success
                                    ? "bg-green-100 text-green-700"
                                    : "bg-red-100 text-red-700"
                                }`}
                              >
                                {success ? "성공" : `실패 (${outcome})`}
                              </span>
                            </div>
                            {str(log.user_prompt) && (
                              <p className="text-gray-800 text-xs whitespace-pre-wrap">
                                {str(log.user_prompt)}
                              </p>
                            )}
                            {success && (
                              <p className="text-[11px] text-gray-400">
                                {str(log.text_model)} + {str(log.image_model)}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}

                {/* Tab: marketer submission (view + edit) */}
                {detailTab === "marketer" &&
                  (!marketerForm ? (
                    <p className="text-sm text-gray-400 py-4">
                      제출된 신청서가 없습니다.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        {(
                          [
                            ["marketing_channel", "마케팅 채널"],
                            ["channel_url", "채널 URL"],
                            ["main_content_url", "대표 콘텐츠 URL"],
                            ["instagram_id", "인스타그램 ID"],
                            ["industry", "업종"],
                            ["product_service", "제품/서비스"],
                            ["manager_name", "담당자명"],
                            ["phone", "전화"],
                          ] as Array<[keyof MarketerEditForm, string]>
                        ).map(([field, label]) => (
                          <div key={field}>
                            <p className="text-xs text-gray-500 mb-1">
                              {label}
                            </p>
                            <input
                              type="text"
                              value={marketerForm[field]}
                              onChange={(e) =>
                                setMarketerForm({
                                  ...marketerForm,
                                  [field]: e.target.value,
                                })
                              }
                              className={inputCls}
                            />
                          </div>
                        ))}
                      </div>
                      {(
                        [
                          ["account_direction", "계정 방향"],
                          ["account_bio", "계정 소개"],
                          ["account_concept", "계정 컨셉"],
                        ] as Array<[keyof MarketerEditForm, string]>
                      ).map(([field, label]) => (
                        <div key={field}>
                          <p className="text-xs text-gray-500 mb-1">{label}</p>
                          <textarea
                            value={marketerForm[field]}
                            onChange={(e) =>
                              setMarketerForm({
                                ...marketerForm,
                                [field]: e.target.value,
                              })
                            }
                            rows={2}
                            className={`${inputCls} resize-none`}
                          />
                        </div>
                      ))}
                      <div className="flex items-center gap-3">
                        <button
                          onClick={saveMarketerForm}
                          disabled={marketerSaving}
                          className="text-sm px-4 py-2 rounded-xl bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-40"
                        >
                          {marketerSaving ? "저장 중..." : "저장"}
                        </button>
                        {marketerResult && (
                          <p
                            className={`text-sm ${
                              marketerResult.startsWith("오류")
                                ? "text-red-500"
                                : "text-green-600"
                            }`}
                          >
                            {marketerResult}
                          </p>
                        )}
                      </div>
                      {detail.applications.length > 1 && (
                        <p className="text-xs text-gray-400">
                          최신 신청서 기준입니다 (총{" "}
                          {detail.applications.length}건).
                        </p>
                      )}
                    </div>
                  ))}

                {/* Tab: credit grants */}
                {detailTab === "prepaid" && (
                  <div className="space-y-4">
                    <div className="rounded-xl bg-violet-50 px-4 py-3">
                      <p className="text-xs font-medium text-violet-600">현재 잔액</p>
                      <p className="text-2xl font-extrabold tabular-nums text-violet-800">
                        {prepaid
                          ? prepaid.balance.toLocaleString("ko-KR")
                          : "···"}
                        <span className="ml-1 text-sm font-semibold">크레딧</span>
                      </p>
                      <p className="mt-1 text-[11px] text-violet-500">
                        1원 = 1크레딧. AI 생성기의 생성 횟수와는 별개입니다.
                      </p>
                    </div>

                    {!selectedUser?.email ? (
                      <p className="text-sm text-gray-400">
                        이메일이 없어 선결제를 기록할 수 없습니다.
                      </p>
                    ) : (
                      <div className="space-y-2.5 rounded-xl border border-gray-200 p-4">
                        <p className="text-sm font-semibold text-gray-900">
                          충전 · 차감 기록
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <select
                            value={prepaidKind}
                            onChange={(e) => setPrepaidKind(e.target.value)}
                            className={selectCls}
                          >
                            <option value="charge">충전 (+)</option>
                            <option value="deduct">차감 (−)</option>
                            <option value="adjust">조정 (±)</option>
                          </select>
                          {prepaidKind === "charge" && (
                            <select
                              value={prepaidMethod}
                              onChange={(e) => setPrepaidMethod(e.target.value)}
                              className={selectCls}
                            >
                              <option value="bank_transfer">계좌이체</option>
                              <option value="card">카드결제</option>
                              <option value="other">기타</option>
                            </select>
                          )}
                          <input
                            type="text"
                            inputMode="numeric"
                            value={prepaidAmount}
                            onChange={(e) => setPrepaidAmount(e.target.value)}
                            placeholder="금액 (예: 900000)"
                            className="px-3 py-2 w-44 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400"
                          />
                        </div>
                        <input
                          type="text"
                          value={prepaidMemo}
                          onChange={(e) => setPrepaidMemo(e.target.value)}
                          placeholder="메모 (예: 90만원 계좌이체 선결제)"
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400"
                        />
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => void savePrepaid()}
                            disabled={prepaidSaving || !prepaidAmount.trim()}
                            className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 disabled:opacity-40"
                          >
                            {prepaidSaving ? "저장 중..." : "기록"}
                          </button>
                          {prepaidResult && (
                            <p
                              className={`text-sm ${prepaidResult.startsWith("오류") ? "text-red-500" : "text-green-600"}`}
                            >
                              {prepaidResult}
                            </p>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-400">
                          부호는 구분에 맞춰 자동 적용됩니다. 차감을 고르면 입력한
                          금액이 마이너스로 기록됩니다.
                        </p>
                      </div>
                    )}

                    {prepaid && !prepaid.available && (
                      <p className="text-sm text-amber-600">
                        선결제 테이블이 아직 생성되지 않았습니다. SQL 실행이 필요합니다.
                      </p>
                    )}

                    {prepaid && prepaid.entries.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-gray-400">내역</p>
                        {prepaid.entries.map((entry) => (
                          <div
                            key={entry.id}
                            className="px-3 py-2 bg-gray-50 rounded-lg text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={`font-semibold tabular-nums ${entry.amount >= 0 ? "text-violet-700" : "text-red-600"}`}
                              >
                                {entry.amount >= 0 ? "+" : ""}
                                {entry.amount.toLocaleString("ko-KR")}
                              </span>
                              <span className="text-xs text-gray-500">
                                {entry.occurred_on}
                                {entry.method === "bank_transfer"
                                  ? " · 계좌이체"
                                  : entry.method === "card"
                                    ? " · 카드결제"
                                    : entry.method === "other"
                                      ? " · 기타"
                                      : ""}
                              </span>
                            </div>
                            {entry.memo && (
                              <p className="mt-0.5 text-xs text-gray-600">{entry.memo}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {prepaid && prepaid.available && prepaid.entries.length === 0 && (
                      <p className="text-sm text-gray-400">아직 내역이 없습니다.</p>
                    )}
                  </div>
                )}

                {detailTab === "credits" && (
                  <div className="space-y-4">
                    {!selectedUser.signedUp || !detail.user.id ? (
                      <p className="text-sm text-gray-400 py-2">
                        미가입 사용자에게는 생성 횟수를 지급할 수 없습니다.
                      </p>
                    ) : (
                      <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                        <p className="text-sm font-medium text-gray-900">
                          생성 횟수 추가 지급
                        </p>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-xs text-gray-500 mb-1">
                              지급 수량 *
                            </p>
                            <input
                              type="number"
                              min="1"
                              value={grantAmount}
                              onChange={(e) => setGrantAmount(e.target.value)}
                              placeholder="예: 5"
                              className={inputCls}
                            />
                          </div>
                          <div>
                            <p className="text-xs text-gray-500 mb-1">
                              지급 사유 (관리자용)
                            </p>
                            <input
                              type="text"
                              value={grantReason}
                              onChange={(e) => setGrantReason(e.target.value)}
                              placeholder="예: 오류 보상"
                              className={inputCls}
                            />
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 mb-1">
                            사용자에게 보여줄 메시지
                          </p>
                          <input
                            type="text"
                            value={grantMessage}
                            onChange={(e) => setGrantMessage(e.target.value)}
                            placeholder="예: 이용에 불편을 드려 생성 횟수를 추가 지급했습니다."
                            className={inputCls}
                          />
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => void submitCreditGrant()}
                            disabled={grantSaving || !grantAmount}
                            className="text-sm px-4 py-2 rounded-xl bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-40"
                          >
                            {grantSaving ? "지급 중..." : "지급하기"}
                          </button>
                          {grantResult && (
                            <p
                              className={`text-sm ${
                                grantResult.startsWith("오류")
                                  ? "text-red-500"
                                  : "text-green-600"
                              }`}
                            >
                              {grantResult}
                            </p>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-400">
                          지급 즉시 사용자의 남은 생성 횟수에 반영되며, 사용자는
                          다음 접속 시 1회성 팝업으로 안내받습니다.
                        </p>
                      </div>
                    )}

                    {detail.creditGrants.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-gray-400">
                          지급 이력
                        </p>
                        {detail.creditGrants.map((grant) => (
                          <div
                            key={str(grant.id)}
                            className="px-3 py-2 bg-gray-50 rounded-lg text-sm space-y-0.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-gray-900">
                                +{Number(grant.amount ?? 0)}회
                              </span>
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full ${
                                  grant.confirmed
                                    ? "bg-green-100 text-green-700"
                                    : "bg-amber-100 text-amber-700"
                                }`}
                              >
                                {grant.confirmed
                                  ? `확인함 · ${fmtDateTime(str(grant.confirmed_at))}`
                                  : "미확인"}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500">
                              {fmtDateTime(str(grant.created_at))} ·{" "}
                              {str(grant.granted_by) || "관리자"}
                              {str(grant.reason) &&
                                ` · 사유: ${str(grant.reason)}`}
                            </p>
                            {str(grant.message) && (
                              <p className="text-xs text-gray-700">
                                메시지: {str(grant.message)}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
