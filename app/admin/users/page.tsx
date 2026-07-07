"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";

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
  aiMarketerSub: boolean;
  aiGeneratorSub: boolean;
  freeUser: boolean;
  createdAt: string | null;
  onboardedAt: string | null;
  subscriptionActive: boolean;
  subscriptionEndDate: string | null;
  remainingCredits: number | null;
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

const EXPORT_COLUMNS: Array<{
  header: string;
  get: (u: UserRow) => string | number;
}> = [
  { header: "이름", get: (u) => u.name ?? "" },
  { header: "이메일", get: (u) => u.email ?? "" },
  { header: "구분", get: (u) => (u.signedUp ? "가입" : "미가입") },
  { header: "회사", get: (u) => u.companyName ?? "" },
  { header: "브랜드", get: (u) => u.brandName ?? "" },
  { header: "주관기관", get: (u) => u.hostOrg ?? "" },
  { header: "멘토기관", get: (u) => u.mentorOrg ?? "" },
  { header: "전화", get: (u) => u.phone ?? "" },
  { header: "무료 유저", get: (u) => (u.freeUser ? "O" : "") },
  { header: "AI 마케터 구독", get: (u) => (u.aiMarketerSub ? "O" : "") },
  { header: "AI 생성기 구독", get: (u) => (u.aiGeneratorSub ? "O" : "") },
  { header: "가입/등록일", get: (u) => u.createdAt?.slice(0, 10) ?? "" },
  { header: "최초 접속일", get: (u) => u.firstAccessAt?.slice(0, 10) ?? "-" },
  { header: "접속 횟수", get: (u) => (u.accessCount === null ? "-" : u.accessCount) },
  { header: "최근 로그인", get: (u) => u.lastLoginAt?.slice(0, 10) ?? "" },
  { header: "최근 활동", get: (u) => u.lastActivityAt?.slice(0, 10) ?? "" },
  { header: "로그인 수", get: (u) => u.loginCount },
  { header: "AI 생성 수", get: (u) => u.aiGenerationCount },
  {
    header: "남은 크레딧",
    get: (u) => (u.remainingCredits === null ? "" : u.remainingCredits),
  },
  {
    header: "마케터 제출",
    get: (u) =>
      u.aiMarketer ? (u.marketerSubmitted ? "제출완료" : "미제출") : "",
  },
  { header: "문의 수", get: (u) => u.inquiryCount },
];

async function exportXlsx(rows: UserRow[]) {
  const XLSX = await import("xlsx");
  const data = rows.map((row) => {
    const record: Record<string, string | number> = {};
    for (const column of EXPORT_COLUMNS) {
      record[column.header] = column.get(row);
    }
    return record;
  });
  const sheet = XLSX.utils.json_to_sheet(data, {
    header: EXPORT_COLUMNS.map((c) => c.header),
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "사용자");
  XLSX.writeFile(
    workbook,
    `users_${new Date().toISOString().slice(0, 10)}.xlsx`
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

function Dot({ on }: { on: boolean }) {
  return on ? (
    <span className="text-green-600 font-semibold">O</span>
  ) : (
    <span className="text-gray-300">—</span>
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
  const [signupStateFilter, setSignupStateFilter] = useState("all"); // all | signed | pre
  const [serviceFilter, setServiceFilter] = useState("all"); // all | free | marketer | generator
  const [signupFilter, setSignupFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState("all");
  const [subscriptionFilter, setSubscriptionFilter] = useState("all");
  const [marketerFilter, setMarketerFilter] = useState("all");
  const [creditFilter, setCreditFilter] = useState("all"); // all | low | zero
  const [inquiryFilter, setInquiryFilter] = useState("all"); // all | any | open
  const [minLogins, setMinLogins] = useState("");
  const [minGenerations, setMinGenerations] = useState("");

  // Sort
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDesc, setSortDesc] = useState(true);

  // Detail
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<
    "summary" | "logins" | "posts" | "genlogs" | "marketer" | "credits"
  >("summary");

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
    setMarketerForm(null);
    setMarketerResult(null);
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
        if (data.applications.length > 0) {
          setMarketerForm(applicationToEditForm(data.applications[0]));
        }
      }
    } finally {
      setDetailLoading(false);
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
      if (minLoginCount > 0 && user.loginCount < minLoginCount) return false;
      if (minGenCount > 0 && user.aiGenerationCount < minGenCount) return false;
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
            ? u.firstAccessAt
            : u.lastActivityAt) ?? "";
      return dir * pick(a).localeCompare(pick(b));
    });
  }, [
    users,
    loadedAtMs,
    query,
    hostOrgFilter,
    signupStateFilter,
    serviceFilter,
    signupFilter,
    activityFilter,
    subscriptionFilter,
    marketerFilter,
    creditFilter,
    inquiryFilter,
    minLogins,
    minGenerations,
    sortField,
    sortDesc,
  ]);

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
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">전체 유저</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              전체 {users.length.toLocaleString()}명 (미가입 포함) · 필터 결과{" "}
              {filtered.length.toLocaleString()}명
              {generatedAt &&
                ` · 갱신 ${new Date(generatedAt).toLocaleTimeString("ko-KR")}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/admin"
              className="text-sm px-4 py-2 rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
            >
              ← 대시보드
            </Link>
            <button
              onClick={() => loadUsers(accessToken)}
              className="text-sm px-4 py-2 rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
            >
              새로고침
            </button>
            <button
              onClick={() => void exportXlsx(filtered)}
              disabled={filtered.length === 0}
              className="text-sm px-4 py-2 rounded-xl bg-gray-900 text-white hover:bg-gray-700 transition-colors disabled:opacity-40"
            >
              엑셀 내보내기 ({filtered.length})
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
            placeholder="이름 · 이메일 · 회사 · 브랜드 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={inputCls}
          />
          <div className="flex flex-wrap gap-2">
            <select
              value={signupStateFilter}
              onChange={(e) => setSignupStateFilter(e.target.value)}
              className={selectCls}
            >
              <option value="all">가입 여부 전체</option>
              <option value="signed">가입</option>
              <option value="pre">미가입 (사전등록)</option>
            </select>
            <select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className={selectCls}
            >
              <option value="all">이용 유형 전체</option>
              <option value="free">무료 유저</option>
              <option value="marketer">AI 마케터 구독</option>
              <option value="generator">AI 생성기 구독</option>
            </select>
            <select
              value={hostOrgFilter}
              onChange={(e) => setHostOrgFilter(e.target.value)}
              className={selectCls}
            >
              <option value="all">주관기관 전체</option>
              {hostOrgs.map((org) => (
                <option key={org} value={org}>
                  {org}
                </option>
              ))}
            </select>
            <select
              value={signupFilter}
              onChange={(e) => setSignupFilter(e.target.value)}
              className={selectCls}
            >
              <option value="all">가입일 전체</option>
              <option value="1">오늘 가입</option>
              <option value="7">최근 7일 가입</option>
              <option value="30">최근 30일 가입</option>
              <option value="90">최근 90일 가입</option>
            </select>
            <select
              value={activityFilter}
              onChange={(e) => setActivityFilter(e.target.value)}
              className={selectCls}
            >
              <option value="all">활동 전체</option>
              <option value="active7">7일 내 활동</option>
              <option value="active30">30일 내 활동</option>
              <option value="inactive30">30일+ 미활동</option>
              <option value="never">활동 기록 없음</option>
            </select>
            <select
              value={subscriptionFilter}
              onChange={(e) => setSubscriptionFilter(e.target.value)}
              className={selectCls}
            >
              <option value="all">생성기 구독 전체</option>
              <option value="active">구독중</option>
              <option value="inactive">미구독</option>
            </select>
            <select
              value={creditFilter}
              onChange={(e) => setCreditFilter(e.target.value)}
              className={selectCls}
            >
              <option value="all">크레딧 전체</option>
              <option value="low">5개 미만</option>
              <option value="zero">0개</option>
            </select>
            <select
              value={marketerFilter}
              onChange={(e) => setMarketerFilter(e.target.value)}
              className={selectCls}
            >
              <option value="all">마케터 제출 전체</option>
              <option value="submitted">제출완료</option>
              <option value="unsubmitted">미제출</option>
            </select>
            <select
              value={inquiryFilter}
              onChange={(e) => setInquiryFilter(e.target.value)}
              className={selectCls}
            >
              <option value="all">문의 전체</option>
              <option value="any">문의 있음</option>
              <option value="open">미답변 문의 있음</option>
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

        {/* Table */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100">
              <tr>
                <th className={headerCls} onClick={() => toggleSort("name")}>
                  사용자{sortIndicator("name")}
                </th>
                <th className={plainHeaderCls}>구분</th>
                <th className={plainHeaderCls}>회사</th>
                <th className={plainHeaderCls}>주관기관</th>
                <th
                  className={headerCls}
                  onClick={() => toggleSort("createdAt")}
                >
                  가입/등록일{sortIndicator("createdAt")}
                </th>
                <th
                  className={headerCls}
                  onClick={() => toggleSort("firstAccessAt")}
                >
                  최초 접속일{sortIndicator("firstAccessAt")}
                </th>
                <th
                  className={headerCls}
                  onClick={() => toggleSort("lastActivityAt")}
                >
                  최근 활동{sortIndicator("lastActivityAt")}
                </th>
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
                <th className={`${plainHeaderCls} text-center`}>마케터</th>
                <th className={`${plainHeaderCls} text-center`}>생성기</th>
                <th
                  className={`${headerCls} text-right`}
                  onClick={() => toggleSort("remainingCredits")}
                >
                  크레딧{sortIndicator("remainingCredits")}
                </th>
                <th className={plainHeaderCls}>마케터 제출</th>
                <th className={`${plainHeaderCls} text-right`}>문의</th>
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
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                      {user.companyName || user.brandName || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                      {user.hostOrg || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                      {fmtDate(user.createdAt)}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                      {user.firstAccessAt ? fmtDate(user.firstAccessAt) : "-"}
                    </td>
                    <td
                      className={`px-3 py-2.5 whitespace-nowrap ${activity.cls}`}
                    >
                      {activity.label}
                    </td>
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
                    <td className="px-3 py-2.5 text-center">
                      <Dot on={user.aiMarketerSub} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <Dot on={user.aiGeneratorSub} />
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-600">
                      {user.remainingCredits ?? "—"}
                    </td>
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
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={16}
                    className="px-3 py-10 text-center text-gray-400"
                  >
                    조건에 맞는 사용자가 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
                <p className="text-sm text-gray-500">{selectedUser.email}</p>
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
                        남은 크레딧{" "}
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
                      ["logins", `로그인 기록 (${detail.loginHistory.length})`],
                      ["posts", `AI 생성물 (${detail.posts.length})`],
                      ["genlogs", `생성 로그 (${detail.generationLogs.length})`],
                      ["marketer", "마케터 제출"],
                      ["credits", `크레딧 지급 (${detail.creditGrants.length})`],
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
                {detailTab === "credits" && (
                  <div className="space-y-4">
                    {!selectedUser.signedUp || !detail.user.id ? (
                      <p className="text-sm text-gray-400 py-2">
                        미가입 사용자에게는 크레딧을 지급할 수 없습니다.
                      </p>
                    ) : (
                      <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                        <p className="text-sm font-medium text-gray-900">
                          보너스 크레딧 지급
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
                            placeholder="예: 이용에 불편을 드려 보상 크레딧을 지급했습니다."
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
                          지급 즉시 사용자의 남은 크레딧에 반영되며, 사용자는
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
