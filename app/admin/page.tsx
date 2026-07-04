"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";

// ─── Types ────────────────────────────────────────────────────────────────────

type OverviewRow = {
  id: string;
  email: string;
  applicant_name: string | null;
  phone: string | null;
  host_org: string | null;
  mentor_org: string | null;
  ai_marketer: boolean;
  ai_generator: boolean;
  marketer_quantity: number | null;
  marketer_months: string | null;
  generator_months: string | null;
  generator_credits: number;
  status: string;
  applied_user_id: string | null;
  applied_at: string | null;
  created_at: string;
  signup: "가입" | "미가입";
  generatorState: string | null;
  marketerState: string | null;
  marketer_submitted_at: string | null;
  marketer_detail: MarketerDetail | null;
};

type MarketerDetail = {
  created_at: string | null;
  marketing_channel: string | null;
  channel_url: string | null;
  main_content_url: string | null;
  industry: string | null;
  product_service: string | null;
  selected_plan: number | null;
  selected_duration: number | null;
  instagram_id: string | null;
  account_direction: string | null;
  account_bio: string | null;
  account_concept: string | null;
  manager_name: string | null;
  phone: string | null;
};

type BulkPreviewRow = {
  rowIndex: number;
  email: string;
  applicant_name: string | null;
  action: "신규 등록" | "기존 수정" | "오류";
  reason?: string;
};

type BulkTotals = { new: number; update: number; error: number };

type EditFormData = {
  id: string;
  email: string;
  applicant_name: string;
  phone: string;
  host_org: string;
  mentor_org: string;
  ai_marketer: boolean;
  marketer_quantity: string;
  marketer_months: string;
  ai_generator: boolean;
  generator_months: string;
  generator_credits: string;
};

type AdminPageState = "loading" | "no_session" | "forbidden" | "error" | "ready";

type UserSearchResult = {
  id: string;
  email: string | null;
  name: string | null;
  createdAt: string | null;
  source: "profile" | "application";
};

type Application = Record<string, unknown>;

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
    id: string;
    startDate: string;
    endDate: string;
    remainingCredits: number;
    dailyUsageCount: number;
    lastUsageDate: string | null;
    createdAt: string;
    updatedAt: string;
    isActive: boolean;
  } | null;
  applications: Application[];
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

type OpsMetrics = {
  generatedAt: string;
  today: string;
  activity: {
    dau: number;
    wau: number;
    mau: number;
    totalUsers: number | null;
    newSignupsToday: number | null;
    newSignups7d: number | null;
  };
  aiUsage: {
    generationsToday: number;
    generations7d: number;
    generations30d: number;
    freeToday: number;
    paidToday: number;
    free30d: number;
    paid30d: number;
    capped: boolean;
  };
  freeTrial: {
    usedToday: number | null;
    used7d: number | null;
    dailyBudget: number;
    remainingBudget: number | null;
    perIpLimit: number;
  };
  subscriptions: {
    active: number;
    remainingCreditsSum: number;
    startedToday: number;
    started7d: number;
  };
  cost: { unitUsd: number; estTodayUsd: number; est30dUsd: number };
  trend7d: Array<{ date: string; total: number; free: number; paid: number }>;
};

const EMPTY_ADD_FORM = {
  email: "",
  applicant_name: "",
  phone: "",
  host_org: "",
  mentor_org: "",
  ai_marketer: false,
  marketer_quantity: "1",
  marketer_months: "",
  ai_generator: false,
  generator_months: "",
  generator_credits: "40",
};

// ─── Small helpers ─────────────────────────────────────────────────────────────

function serviceLabel(row: OverviewRow) {
  if (row.ai_marketer && row.ai_generator) return "마케터+생성기";
  if (row.ai_marketer) return "마케터";
  if (row.ai_generator) return "생성기";
  return "-";
}

type BadgeColor = "green" | "red" | "blue" | "yellow" | "gray" | "orange" | "violet";

function Badge({ label, color }: { label: string; color: BadgeColor }) {
  const cls: Record<BadgeColor, string> = {
    green: "bg-green-100 text-green-700",
    red: "bg-red-100 text-red-700",
    blue: "bg-blue-100 text-blue-700",
    yellow: "bg-amber-100 text-amber-700",
    gray: "bg-gray-100 text-gray-500",
    orange: "bg-orange-100 text-orange-700",
    violet: "bg-violet-100 text-violet-700",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls[color]}`}
    >
      {label}
    </span>
  );
}

// ─── Operations panel ───────────────────────────────────────────────────────

function fmt(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString();
}

function StatCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "warn" | "good";
}) {
  const valueCls =
    tone === "warn"
      ? "text-red-600"
      : tone === "good"
        ? "text-green-600"
        : "text-gray-900";
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${valueCls}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function OpsPanel({ ops, error }: { ops: OpsMetrics | null; error: boolean }) {
  if (error) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <p className="text-sm text-gray-500">운영 지표를 불러오지 못했습니다.</p>
      </div>
    );
  }

  if (!ops) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
        <p className="text-sm text-gray-400">운영 지표를 불러오는 중…</p>
      </div>
    );
  }

  const budgetLow =
    ops.freeTrial.remainingBudget !== null &&
    ops.freeTrial.remainingBudget <= Math.max(ops.freeTrial.dailyBudget * 0.1, 1);
  const maxTrend = Math.max(1, ...ops.trend7d.map((d) => d.total));

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          운영 현황
        </p>
        <p className="text-xs text-gray-400">
          {ops.today} · 갱신 {new Date(ops.generatedAt).toLocaleTimeString("ko-KR")}
        </p>
      </div>

      {/* Activity */}
      <div>
        <p className="text-xs font-medium text-gray-400 mb-2">사용자 활동</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="오늘 활성 사용자 (DAU)" value={fmt(ops.activity.dau)} />
          <StatCard label="주간 활성 (WAU)" value={fmt(ops.activity.wau)} />
          <StatCard label="월간 활성 (MAU)" value={fmt(ops.activity.mau)} />
          <StatCard
            label="가입 사용자"
            value={fmt(ops.activity.totalUsers)}
            sub={`오늘 +${fmt(ops.activity.newSignupsToday)} · 7일 +${fmt(ops.activity.newSignups7d)}`}
          />
        </div>
      </div>

      {/* AI usage */}
      <div>
        <p className="text-xs font-medium text-gray-400 mb-2">AI 생성 (저장 기준)</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="오늘 생성"
            value={fmt(ops.aiUsage.generationsToday)}
            sub={`무료 ${fmt(ops.aiUsage.freeToday)} · 구독 ${fmt(ops.aiUsage.paidToday)}`}
          />
          <StatCard label="최근 7일" value={fmt(ops.aiUsage.generations7d)} />
          <StatCard
            label="최근 30일"
            value={fmt(ops.aiUsage.generations30d)}
            sub={ops.aiUsage.capped ? "상한 도달(≥10,000)" : undefined}
          />
          <StatCard
            label="예상 비용(오늘)"
            value={`$${ops.cost.estTodayUsd.toLocaleString()}`}
            sub={`30일 $${ops.cost.est30dUsd.toLocaleString()} · 단가 $${ops.cost.unitUsd}`}
          />
        </div>
      </div>

      {/* Free trial + subscriptions */}
      <div>
        <p className="text-xs font-medium text-gray-400 mb-2">무료 체험 / 구독</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="오늘 무료 체험"
            value={fmt(ops.freeTrial.usedToday)}
            sub={`7일 ${fmt(ops.freeTrial.used7d)}`}
          />
          <StatCard
            label="남은 일일 예산"
            value={fmt(ops.freeTrial.remainingBudget)}
            sub={`예산 ${fmt(ops.freeTrial.dailyBudget)} · IP한도 ${fmt(ops.freeTrial.perIpLimit)}`}
            tone={budgetLow ? "warn" : "default"}
          />
          <StatCard
            label="활성 구독"
            value={fmt(ops.subscriptions.active)}
            sub={`오늘 +${fmt(ops.subscriptions.startedToday)} · 7일 +${fmt(ops.subscriptions.started7d)}`}
            tone="good"
          />
          <StatCard
            label="잔여 크레딧 합계"
            value={fmt(ops.subscriptions.remainingCreditsSum)}
          />
        </div>
      </div>

      {/* 7-day trend */}
      <div>
        <p className="text-xs font-medium text-gray-400 mb-2">최근 7일 생성 추이</p>
        <div className="flex items-end gap-2 h-24">
          {ops.trend7d.map((day) => (
            <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex items-end justify-center h-20">
                <div
                  className="w-full max-w-[36px] bg-violet-500 rounded-t"
                  style={{ height: `${Math.round((day.total / maxTrend) * 100)}%` }}
                  title={`${day.date} · 총 ${day.total} (무료 ${day.free} / 구독 ${day.paid})`}
                />
              </div>
              <span className="text-[10px] text-gray-400">{day.date.slice(5)}</span>
              <span className="text-[10px] font-medium text-gray-600 tabular-nums">
                {day.total}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function signupBadge(signup: "가입" | "미가입") {
  return <Badge label={signup} color={signup === "가입" ? "green" : "red"} />;
}

function generatorBadge(state: string | null) {
  if (!state) return <span className="text-gray-400">-</span>;
  if (state === "구독중") return <Badge label={state} color="blue" />;
  if (state.includes("진행 예정")) return <Badge label={state} color="yellow" />;
  return <Badge label={state} color="gray" />;
}

function marketerBadge(state: string | null) {
  if (!state) return <span className="text-gray-400">-</span>;
  if (state === "제출완료") return <Badge label={state} color="green" />;
  if (state.includes("진행 예정")) return <Badge label={state} color="yellow" />;
  return <Badge label={state} color="orange" />;
}

function formatSeoulDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "-";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return "-";
  }
}

function previewActionBadge(action: BulkPreviewRow["action"]) {
  if (action === "신규 등록") return <Badge label={action} color="blue" />;
  if (action === "기존 수정") return <Badge label={action} color="yellow" />;
  return <Badge label={action} color="red" />;
}

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

function rowToEditForm(row: OverviewRow): EditFormData {
  return {
    id: row.id,
    email: row.email,
    applicant_name: row.applicant_name ?? "",
    phone: row.phone ?? "",
    host_org: row.host_org ?? "",
    mentor_org: row.mentor_org ?? "",
    ai_marketer: row.ai_marketer,
    marketer_quantity: String(row.marketer_quantity ?? 1),
    marketer_months: row.marketer_months ?? "",
    ai_generator: row.ai_generator,
    generator_months: row.generator_months ?? "",
    generator_credits: String(row.generator_credits ?? 40),
  };
}

// ─── Shared class constants ───────────────────────────────────────────────────

const pageShellCls =
  "min-h-screen bg-gray-50 flex items-center justify-center text-gray-500";

const inputCls =
  "w-full px-3 py-2 bg-white text-gray-900 border border-gray-200 rounded-xl text-sm placeholder:text-gray-400 focus:outline-none focus:border-gray-400";
const inputSmCls =
  "w-full px-3 py-1.5 bg-white text-gray-900 border border-gray-200 rounded-lg text-sm placeholder:text-gray-400 focus:outline-none focus:border-gray-400";

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [pageState, setPageState] = useState<AdminPageState>("loading");
  const [accessToken, setAccessToken] = useState("");
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [filter, setFilter] = useState<"all" | "unsigned" | "marketer_unsubmitted">("all");
  const [sortMode, setSortMode] = useState<"default" | "submitted_asc">("default");

  // Bulk registration
  const [bulkText, setBulkText] = useState("");
  const [bulkPreview, setBulkPreview] = useState<{
    rows: BulkPreviewRow[];
    totals: BulkTotals;
  } | null>(null);
  const [bulkHeaderError, setBulkHeaderError] = useState<string | null>(null);
  const [bulkPreviewLoading, setBulkPreviewLoading] = useState(false);
  const [bulkConfirmLoading, setBulkConfirmLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  // Single add form
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [addLoading, setAddLoading] = useState(false);
  const [addResult, setAddResult] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // Edit modal
  const [editForm, setEditForm] = useState<EditFormData | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null);

  // Detail view modal
  const [viewDetailRow, setViewDetailRow] = useState<OverviewRow | null>(null);

  // Operations metrics
  const [ops, setOps] = useState<OpsMetrics | null>(null);
  const [opsError, setOpsError] = useState(false);

  // User search
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [userSearchResults, setUserSearchResults] = useState<UserSearchResult[]>([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [userDetail, setUserDetail] = useState<UserDetail | null>(null);
  const [userDetailLoading, setUserDetailLoading] = useState(false);

  // ── Init ──────────────────────────────────────────────────────────────────

  async function loadOverview(token: string) {
    const res = await adminFetch("/api/admin/overview", token);
    if (res.status === 401 || res.status === 403) {
      setPageState("forbidden");
      return;
    }
    if (!res.ok) {
      setPageState("error");
      return;
    }
    const data = (await res.json()) as { rows: OverviewRow[] };
    setRows(data.rows ?? []);
    setPageState("ready");
  }

  async function loadOps(token: string) {
    setOpsError(false);
    try {
      const res = await adminFetch("/api/admin/ops", token);
      if (!res.ok) {
        setOpsError(true);
        return;
      }
      setOps((await res.json()) as OpsMetrics);
    } catch {
      setOpsError(true);
    }
  }

  async function searchUsers(query: string, token: string) {
    if (query.trim().length < 2) {
      setUserSearchResults([]);
      return;
    }
    setUserSearchLoading(true);
    try {
      const res = await adminFetch(`/api/admin/users/search?q=${encodeURIComponent(query)}`, token);
      if (res.ok) {
        const data = (await res.json()) as { results: UserSearchResult[] };
        setUserSearchResults(data.results ?? []);
      } else {
        setUserSearchResults([]);
      }
    } catch {
      setUserSearchResults([]);
    } finally {
      setUserSearchLoading(false);
    }
  }

  async function loadUserDetail(user: UserSearchResult, token: string) {
    setSelectedUser(user);
    setUserDetailLoading(true);
    try {
      const query = user.source === "profile" ? `userId=${user.id}` : `email=${encodeURIComponent(user.email || "")}`;
      const res = await adminFetch(`/api/admin/users/detail?${query}`, token);
      if (res.ok) {
        const data = (await res.json()) as UserDetail;
        setUserDetail(data);
      }
    } catch {
      // Error handled by modal displaying null
    } finally {
      setUserDetailLoading(false);
    }
  }

  useEffect(() => {
    const supabase = getSupabaseBrowserClientOrNull();
    if (!supabase) {
      setPageState("no_session");
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      const token = session?.access_token ?? "";
      if (!token) {
        setPageState("no_session");
        return;
      }
      setAccessToken(token);
      loadOverview(token);
      loadOps(token);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Bulk handlers ─────────────────────────────────────────────────────────

  async function handleBulkPreview() {
    setBulkPreviewLoading(true);
    setBulkPreview(null);
    setBulkHeaderError(null);
    setBulkResult(null);
    try {
      const res = await adminFetch("/api/admin/grants/bulk", accessToken, {
        method: "POST",
        body: JSON.stringify({ rows: bulkText, dryRun: true }),
      });
      if (res.status === 400) {
        const data = (await res.json()) as { headerError?: string };
        if (data.headerError) {
          setBulkHeaderError(data.headerError);
          return;
        }
      }
      if (!res.ok) {
        setBulkHeaderError("미리보기 요청이 실패했습니다.");
        return;
      }
      const data = (await res.json()) as {
        rows: BulkPreviewRow[];
        totals: BulkTotals;
      };
      setBulkPreview(data);
    } finally {
      setBulkPreviewLoading(false);
    }
  }

  async function handleBulkConfirm() {
    setBulkConfirmLoading(true);
    setBulkResult(null);
    try {
      const res = await adminFetch("/api/admin/grants/bulk", accessToken, {
        method: "POST",
        body: JSON.stringify({ rows: bulkText, dryRun: false }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string; headerError?: string };
        setBulkResult(`오류: ${data.error ?? data.headerError ?? "알 수 없는 오류"}`);
        return;
      }
      const data = (await res.json()) as {
        inserted: number;
        updated: number;
        skipped: number;
      };
      setBulkResult(
        `완료 — 신규 ${data.inserted}건, 수정 ${data.updated}건, 오류 ${data.skipped}건`
      );
      setBulkPreview(null);
      setBulkText("");
      await loadOverview(accessToken);
    } finally {
      setBulkConfirmLoading(false);
    }
  }

  // ── Single add handler ────────────────────────────────────────────────────

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddLoading(true);
    setAddResult(null);
    const f = addForm;
    // Format as TSV for the bulk endpoint
    const header =
      "이메일\t이름\t전화\t주관기관\t선택 멘토기관\tai_marketer\tmarketer_quantity\tmarketer_months\tai_generator\tgenerator_months\tgenerator_credits";
    const dataRow = [
      f.email,
      f.applicant_name,
      f.phone,
      f.host_org,
      f.mentor_org,
      f.ai_marketer.toString().toUpperCase(),
      f.marketer_quantity,
      f.marketer_months,
      f.ai_generator.toString().toUpperCase(),
      f.generator_months,
      f.generator_credits,
    ].join("\t");
    try {
      const res = await adminFetch("/api/admin/grants/bulk", accessToken, {
        method: "POST",
        body: JSON.stringify({
          rows: `${header}\n${dataRow}`,
          dryRun: false,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string; headerError?: string };
        setAddResult(`오류: ${data.error ?? data.headerError ?? "알 수 없는 오류"}`);
        return;
      }
      const data = (await res.json()) as {
        inserted: number;
        updated: number;
        skipped: number;
        rowErrors: Array<{ reason: string }>;
      };
      if (data.rowErrors?.length) {
        setAddResult(`오류: ${data.rowErrors[0].reason}`);
        return;
      }
      setAddResult(`완료 — ${data.inserted ? "신규 등록" : "기존 수정"} 완료`);
      setAddForm(EMPTY_ADD_FORM);
      setShowAddForm(false);
      await loadOverview(accessToken);
    } finally {
      setAddLoading(false);
    }
  }

  // ── Edit handlers ─────────────────────────────────────────────────────────

  async function handleEditSave() {
    if (!editForm) return;
    setEditLoading(true);
    setEditError(null);
    try {
      const res = await adminFetch("/api/admin/grants", accessToken, {
        method: "PATCH",
        body: JSON.stringify({
          id: editForm.id,
          applicant_name: editForm.applicant_name || null,
          phone: editForm.phone || null,
          host_org: editForm.host_org || null,
          mentor_org: editForm.mentor_org || null,
          ai_marketer: editForm.ai_marketer,
          ai_generator: editForm.ai_generator,
          marketer_quantity: editForm.ai_marketer
            ? Number(editForm.marketer_quantity) || 1
            : null,
          marketer_months: editForm.marketer_months || null,
          generator_months: editForm.generator_months || null,
          generator_credits: Number(editForm.generator_credits) || 40,
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setEditError(data.error ?? "수정에 실패했습니다.");
        return;
      }
      setEditForm(null);
      await loadOverview(accessToken);
    } finally {
      setEditLoading(false);
    }
  }

  // ── Delete handler ────────────────────────────────────────────────────────

  async function handleDelete(row: OverviewRow) {
    const confirmed = window.confirm(
      `"${row.email}" 의 사전등록 정보를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`
    );
    if (!confirmed) return;
    setDeleteLoadingId(row.id);
    try {
      const res = await adminFetch("/api/admin/grants", accessToken, {
        method: "DELETE",
        body: JSON.stringify({ id: row.id }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        alert(data.error ?? "삭제에 실패했습니다.");
        return;
      }
      await loadOverview(accessToken);
    } finally {
      setDeleteLoadingId(null);
    }
  }

  // ── Filter + sort ─────────────────────────────────────────────────────────

  const filteredRows = rows.filter((r) => {
    if (filter === "unsigned") return r.signup === "미가입";
    if (filter === "marketer_unsubmitted")
      return r.ai_marketer && r.marketerState === "미제출";
    return true;
  });

  const displayRows =
    sortMode === "submitted_asc"
      ? [...filteredRows].sort((a, b) => {
          const aDate = a.marketer_submitted_at;
          const bDate = b.marketer_submitted_at;
          if (!aDate && !bDate) return 0;
          if (!aDate) return 1;  // no submission → bottom
          if (!bDate) return -1; // no submission → bottom
          return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
        })
      : filteredRows;

  // ── Early states ──────────────────────────────────────────────────────────

  if (pageState === "loading") {
    return (
      <div className={pageShellCls}>
        로딩 중...
      </div>
    );
  }

  if (pageState === "no_session") {
    return (
      <div className={pageShellCls}>
        관리자 로그인이 필요합니다.
      </div>
    );
  }

  if (pageState === "forbidden") {
    return (
      <div className={pageShellCls}>
        접근 권한이 없습니다.
      </div>
    );
  }

  if (pageState === "error") {
    return (
      <div className={pageShellCls}>
        오류가 발생했습니다. 새로고침 후 다시 시도해주세요.
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">관리자 대시보드</h1>
            <p className="text-sm text-gray-500 mt-0.5">서비스 권한 사전등록 관리</p>
          </div>
          <button
            onClick={() => {
              loadOverview(accessToken);
              loadOps(accessToken);
            }}
            className="text-sm px-4 py-2 rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
          >
            새로고침
          </button>
        </div>

        <OpsPanel ops={ops} error={opsError} />

        {/* ── User search ────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            사용자 조사
          </p>
          <input
            type="text"
            placeholder="이메일 또는 이름으로 검색 (최소 2글자)"
            value={userSearchQuery}
            onChange={(e) => {
              const val = e.target.value;
              setUserSearchQuery(val);
              searchUsers(val, accessToken);
            }}
            className="w-full px-4 py-3 bg-white text-gray-900 border border-gray-200 rounded-xl text-sm placeholder:text-gray-400 focus:outline-none focus:border-gray-400"
          />
          {userSearchLoading && (
            <p className="text-sm text-gray-500">검색 중...</p>
          )}
          {userSearchResults.length > 0 && (
            <div className="space-y-2">
              {userSearchResults.map((result) => (
                <button
                  key={result.id}
                  onClick={() => loadUserDetail(result, accessToken)}
                  className="block w-full text-left px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors"
                >
                  <p className="text-sm font-medium text-gray-900">{result.email || "—"}</p>
                  {result.name && <p className="text-xs text-gray-600">{result.name}</p>}
                  <p className="text-xs text-gray-400">
                    {result.source === "profile" ? "가입됨" : "신청만 함"} · {result.createdAt ? new Date(result.createdAt).toLocaleDateString("ko-KR") : "—"}
                  </p>
                </button>
              ))}
            </div>
          )}
          {userSearchQuery.length >= 2 && userSearchResults.length === 0 && !userSearchLoading && (
            <p className="text-sm text-gray-500">검색 결과 없음</p>
          )}
        </div>

        {/* ── User detail modal ──────────────────────────────────────────────── */}
        {selectedUser && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-96 overflow-y-auto">
              {userDetailLoading ? (
                <div className="p-6 text-center text-gray-500">로딩 중...</div>
              ) : userDetail ? (
                <div className="p-6 space-y-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">{userDetail.user.email}</h2>
                      <p className="text-sm text-gray-600 mt-1">{userDetail.user.name || "—"}</p>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedUser(null);
                        setUserDetail(null);
                      }}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Profile info */}
                  <div className="border-t border-gray-200 pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">프로필</p>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-gray-500">가입일</p>
                        <p className="font-medium text-gray-900">
                          {userDetail.user.createdAt ? new Date(userDetail.user.createdAt).toLocaleDateString("ko-KR") : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500">온보딩</p>
                        <p className="font-medium text-gray-900">
                          {userDetail.user.accountOnboardedAt ? new Date(userDetail.user.accountOnboardedAt).toLocaleDateString("ko-KR") : "미완료"}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-500">회사명</p>
                        <p className="font-medium text-gray-900">{userDetail.user.companyName || "—"}</p>
                      </div>
                    </div>
                  </div>

                  {/* Subscription */}
                  {userDetail.subscription && (
                    <div className="border-t border-gray-200 pt-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">구독</p>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-gray-500">상태</p>
                          <p className="font-medium text-green-600">활성</p>
                        </div>
                        <div>
                          <p className="text-gray-500">남은 크레딧</p>
                          <p className="font-medium text-gray-900">{userDetail.subscription.remainingCredits}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">시작일</p>
                          <p className="font-medium text-gray-900">{new Date(userDetail.subscription.startDate).toLocaleDateString("ko-KR")}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">종료일</p>
                          <p className="font-medium text-gray-900">{new Date(userDetail.subscription.endDate).toLocaleDateString("ko-KR")}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* AI usage */}
                  <div className="border-t border-gray-200 pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">AI 생성</p>
                    <div className="grid grid-cols-3 gap-4 text-sm">
                      <div>
                        <p className="text-gray-500">총 생성</p>
                        <p className="font-medium text-gray-900">{userDetail.aiUsage.totalGenerations}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">무료 체험</p>
                        <p className="font-medium text-gray-900">{userDetail.aiUsage.freeTrialGenerations}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">구독 사용</p>
                        <p className="font-medium text-gray-900">{userDetail.aiUsage.paidGenerations}</p>
                      </div>
                      <div className="col-span-3">
                        <p className="text-gray-500">최신 생성</p>
                        <p className="font-medium text-gray-900">
                          {userDetail.aiUsage.latestGeneratedAt
                            ? new Date(userDetail.aiUsage.latestGeneratedAt).toLocaleDateString("ko-KR")
                            : "없음"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Recent posts */}
                  {userDetail.posts.length > 0 && (
                    <div className="border-t border-gray-200 pt-4">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">최신 생성물 (상위 5개)</p>
                      <div className="space-y-2">
                        {userDetail.posts.slice(0, 5).map((post) => (
                          <div key={post.id} className="text-sm px-3 py-2 bg-gray-50 rounded-lg">
                            <p className="font-medium text-gray-900">{post.title}</p>
                            <p className="text-xs text-gray-500">
                              {new Date(post.createdAt).toLocaleDateString("ko-KR")} · {post.isFreeTrial ? "무료" : "구독"}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 text-center text-red-500">사용자 정보를 불러올 수 없습니다</div>
              )}
            </div>
          </div>
        )}

        {/* ── Bulk registration ──────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            일괄 등록 (스프레드시트 붙여넣기)
          </p>

          <textarea
            className="w-full h-36 px-4 py-3 bg-white text-gray-900 border border-gray-200 rounded-xl text-sm font-mono placeholder:text-gray-400 focus:outline-none focus:border-gray-400 resize-none"
            placeholder={`이메일\t이름\t전화\t주관기관\tai_marketer\tai_generator\tgenerator_months\n(스프레드시트에서 복사한 행을 그대로 붙여넣으세요)`}
            value={bulkText}
            onChange={(e) => {
              setBulkText(e.target.value);
              setBulkPreview(null);
              setBulkHeaderError(null);
              setBulkResult(null);
            }}
          />

          {bulkHeaderError && (
            <p className="text-sm text-red-500">{bulkHeaderError}</p>
          )}

          {bulkResult && (
            <p className={`text-sm ${bulkResult.startsWith("오류") ? "text-red-500" : "text-green-600"}`}>
              {bulkResult}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleBulkPreview}
              disabled={!bulkText.trim() || bulkPreviewLoading}
              className="px-4 py-2 rounded-xl text-sm font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              {bulkPreviewLoading ? "미리보는 중..." : "미리보기"}
            </button>
            {bulkPreview && (
              <button
                onClick={handleBulkConfirm}
                disabled={bulkConfirmLoading}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40 transition-colors"
              >
                {bulkConfirmLoading ? "등록 중..." : "등록 확정"}
              </button>
            )}
          </div>

          {/* Preview table */}
          {bulkPreview && (
            <div className="space-y-2">
              <div className="flex gap-3 text-xs text-gray-600">
                <span>신규 <strong className="text-blue-600">{bulkPreview.totals.new}</strong></span>
                <span>수정 <strong className="text-amber-600">{bulkPreview.totals.update}</strong></span>
                <span>오류 <strong className="text-red-500">{bulkPreview.totals.error}</strong></span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs text-gray-600 border-b border-gray-200">
                      <th className="px-3 py-2 font-medium">행</th>
                      <th className="px-3 py-2 font-medium">이메일</th>
                      <th className="px-3 py-2 font-medium">이름</th>
                      <th className="px-3 py-2 font-medium">구분</th>
                      <th className="px-3 py-2 font-medium">비고</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {bulkPreview.rows.map((r) => (
                      <tr key={r.rowIndex} className={r.action === "오류" ? "bg-red-50" : ""}>
                        <td className="px-3 py-2 text-gray-500">{r.rowIndex}</td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-800">{r.email || "-"}</td>
                        <td className="px-3 py-2 text-gray-700">{r.applicant_name ?? "-"}</td>
                        <td className="px-3 py-2">{previewActionBadge(r.action)}</td>
                        <td className="px-3 py-2 text-xs text-red-500">{r.reason ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── Single add ────────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              개별 등록
            </p>
            <button
              onClick={() => { setShowAddForm((v) => !v); setAddResult(null); }}
              className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2 transition-colors"
            >
              {showAddForm ? "접기" : "펼치기"}
            </button>
          </div>

          {addResult && (
            <p className={`text-sm ${addResult.startsWith("오류") ? "text-red-500" : "text-green-600"}`}>
              {addResult}
            </p>
          )}

          {showAddForm && (
            <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(
                [
                  { key: "email", label: "이메일 *", type: "email", required: true },
                  { key: "applicant_name", label: "이름", type: "text", required: false },
                  { key: "phone", label: "전화", type: "text", required: false },
                  { key: "host_org", label: "주관기관", type: "text", required: false },
                  { key: "mentor_org", label: "선택 멘토기관", type: "text", required: false },
                ] as Array<{
                  key: keyof Pick<typeof addForm, "email" | "applicant_name" | "phone" | "host_org" | "mentor_org">;
                  label: string;
                  type: string;
                  required: boolean;
                }>
              ).map(({ key, label, type, required }) => (
                <div key={key} className="space-y-1">
                  <label className="text-xs font-medium text-gray-600">{label}</label>
                  <input
                    type={type}
                    required={required}
                    value={addForm[key]}
                    onChange={(e) =>
                      setAddForm((f) => ({ ...f, [key]: e.target.value }))
                    }
                    className={inputCls}
                  />
                </div>
              ))}

              <div className="sm:col-span-2 grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addForm.ai_marketer}
                      onChange={(e) =>
                        setAddForm((f) => ({ ...f, ai_marketer: e.target.checked }))
                      }
                      className="accent-gray-800"
                    />
                    AI 마케터
                  </label>
                  {addForm.ai_marketer && (
                    <>
                      <div className="space-y-1 pl-5">
                        <label className="text-xs font-medium text-gray-600">마케터 진행 월 (예: 7,8)</label>
                        <input
                          type="text"
                          value={addForm.marketer_months}
                          onChange={(e) =>
                            setAddForm((f) => ({ ...f, marketer_months: e.target.value }))
                          }
                          className={inputSmCls}
                        />
                      </div>
                    </>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={addForm.ai_generator}
                      onChange={(e) =>
                        setAddForm((f) => ({ ...f, ai_generator: e.target.checked }))
                      }
                      className="accent-gray-800"
                    />
                    AI 생성기
                  </label>
                  {addForm.ai_generator && (
                    <div className="pl-5 space-y-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-600">생성기 진행 월 (예: 7,8)</label>
                        <input
                          type="text"
                          value={addForm.generator_months}
                          onChange={(e) =>
                            setAddForm((f) => ({ ...f, generator_months: e.target.value }))
                          }
                          className={inputSmCls}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-gray-600">크레딧 수 (기본 40)</label>
                        <input
                          type="number"
                          value={addForm.generator_credits}
                          onChange={(e) =>
                            setAddForm((f) => ({ ...f, generator_credits: e.target.value }))
                          }
                          className={inputSmCls}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={addLoading}
                  className="px-6 py-2 rounded-xl text-sm font-semibold bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40 transition-colors"
                >
                  {addLoading ? "등록 중..." : "등록"}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* ── Overview table ────────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              등록 현황 ({filteredRows.length} / {rows.length})
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex gap-1">
                {(
                  [
                    ["all", "전체"],
                    ["unsigned", "미가입"],
                    ["marketer_unsubmitted", "마케터 미제출"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      filter === key
                        ? "bg-gray-900 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="h-4 w-px bg-gray-200" />
              <button
                onClick={() =>
                  setSortMode((m) => (m === "submitted_asc" ? "default" : "submitted_asc"))
                }
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  sortMode === "submitted_asc"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {sortMode === "submitted_asc" ? "기본순" : "제출일순"}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-xs text-gray-600 border-b border-gray-200">
                  <th className="px-3 py-2.5 font-medium">이메일</th>
                  <th className="px-3 py-2.5 font-medium">이름</th>
                  <th className="px-3 py-2.5 font-medium">구분</th>
                  <th className="px-3 py-2.5 font-medium">가입</th>
                  <th className="px-3 py-2.5 font-medium">생성기</th>
                  <th className="px-3 py-2.5 font-medium">마케터</th>
                  <th className="px-3 py-2.5 font-medium">제출일</th>
                  <th className="px-3 py-2.5 font-medium">주관기관</th>
                  <th className="px-3 py-2.5 font-medium">전화</th>
                  <th className="px-3 py-2.5 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-8 text-center text-gray-500 text-sm">
                      {rows.length === 0 ? "등록된 항목이 없습니다." : "해당 조건의 항목이 없습니다."}
                    </td>
                  </tr>
                )}
                {displayRows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2.5 font-mono text-xs text-gray-700 max-w-[180px] truncate">
                      {row.email}
                    </td>
                    <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">
                      {row.applicant_name ?? "-"}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <Badge
                        label={serviceLabel(row)}
                        color={
                          row.ai_marketer && row.ai_generator
                            ? "violet"
                            : row.ai_marketer
                              ? "green"
                              : row.ai_generator
                                ? "blue"
                                : "gray"
                        }
                      />
                    </td>
                    <td className="px-3 py-2.5">{signupBadge(row.signup)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{generatorBadge(row.generatorState)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{marketerBadge(row.marketerState)}</td>
                    <td className="px-3 py-2.5 text-gray-600 text-xs whitespace-nowrap">
                      {formatSeoulDate(row.marketer_submitted_at)}
                    </td>
                    <td className="px-3 py-2.5 text-gray-600 text-xs">{row.host_org ?? "-"}</td>
                    <td className="px-3 py-2.5 text-gray-600 text-xs whitespace-nowrap">
                      {row.phone ?? "-"}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-2 items-center">
                        <button
                          onClick={() => setViewDetailRow(row)}
                          disabled={!row.marketer_detail}
                          title={!row.marketer_detail ? "제출 내역 없음" : undefined}
                          className="text-xs text-blue-500 hover:text-blue-700 disabled:text-gray-300 disabled:cursor-default transition-colors"
                        >
                          조회
                        </button>
                        <button
                          onClick={() => { setEditForm(rowToEditForm(row)); setEditError(null); }}
                          className="text-xs text-gray-500 hover:text-gray-800 transition-colors"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => handleDelete(row)}
                          disabled={deleteLoadingId === row.id}
                          className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 transition-colors"
                        >
                          {deleteLoadingId === row.id ? "..." : "삭제"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Edit modal ────────────────────────────────────────────────────── */}
        {editForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900">등록 정보 수정</h2>
                <button
                  onClick={() => setEditForm(null)}
                  className="text-gray-400 hover:text-gray-700 text-sm transition-colors"
                >
                  닫기
                </button>
              </div>

              <p className="text-xs font-mono text-gray-600 bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg">
                {editForm.email}
              </p>

              {editError && <p className="text-sm text-red-500">{editError}</p>}

              <div className="grid grid-cols-1 gap-3">
                {(
                  [
                    { key: "applicant_name", label: "이름" },
                    { key: "phone", label: "전화" },
                    { key: "host_org", label: "주관기관" },
                    { key: "mentor_org", label: "선택 멘토기관" },
                  ] as Array<{
                    key: keyof Pick<EditFormData, "applicant_name" | "phone" | "host_org" | "mentor_org">;
                    label: string;
                  }>
                ).map(({ key, label }) => (
                  <div key={key} className="space-y-1">
                    <label className="text-xs font-medium text-gray-600">{label}</label>
                    <input
                      type="text"
                      value={editForm[key]}
                      onChange={(e) =>
                        setEditForm((f) => f && { ...f, [key]: e.target.value })
                      }
                      className={inputCls}
                    />
                  </div>
                ))}

                <div className="grid grid-cols-2 gap-4 pt-1">
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editForm.ai_marketer}
                        onChange={(e) =>
                          setEditForm((f) => f && { ...f, ai_marketer: e.target.checked })
                        }
                        className="accent-gray-800"
                      />
                      AI 마케터
                    </label>
                    {editForm.ai_marketer && (
                      <div className="pl-5 space-y-1">
                        <label className="text-xs font-medium text-gray-600">진행 월</label>
                        <input
                          type="text"
                          value={editForm.marketer_months}
                          onChange={(e) =>
                            setEditForm((f) => f && { ...f, marketer_months: e.target.value })
                          }
                          className={inputSmCls}
                        />
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editForm.ai_generator}
                        onChange={(e) =>
                          setEditForm((f) => f && { ...f, ai_generator: e.target.checked })
                        }
                        className="accent-gray-800"
                      />
                      AI 생성기
                    </label>
                    {editForm.ai_generator && (
                      <div className="pl-5 space-y-2">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-gray-600">진행 월</label>
                          <input
                            type="text"
                            value={editForm.generator_months}
                            onChange={(e) =>
                              setEditForm((f) => f && { ...f, generator_months: e.target.value })
                            }
                            className={inputSmCls}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-gray-600">크레딧</label>
                          <input
                            type="number"
                            value={editForm.generator_credits}
                            onChange={(e) =>
                              setEditForm((f) => f && { ...f, generator_credits: e.target.value })
                            }
                            className={inputSmCls}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleEditSave}
                  disabled={editLoading}
                  className="flex-1 py-2 rounded-xl text-sm font-semibold bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-40 transition-colors"
                >
                  {editLoading ? "저장 중..." : "저장"}
                </button>
                <button
                  onClick={() => setEditForm(null)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Marketer detail modal ─────────────────────────────────────────── */}
        {viewDetailRow?.marketer_detail && (() => {
          const detail = viewDetailRow.marketer_detail!;

          // Resolve channel URL: prefer channel_url, else build instagram URL from instagram_id
          const ch = (detail.marketing_channel ?? "").toLowerCase();
          const isInstagram = ch.includes("instagram") || ch.includes("인스타");
          const resolvedChannelUrl: string | null =
            detail.channel_url ||
            (isInstagram && detail.instagram_id
              ? `https://www.instagram.com/${detail.instagram_id.replace(/^@/, "")}/`
              : null);

          const channelIdFallback =
            !detail.channel_url && isInstagram && detail.instagram_id
              ? detail.instagram_id
              : null;

          return (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
              onClick={() => setViewDetailRow(null)}
            >
              <div
                className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-gray-900">마케터 제출 내역</h2>
                  <button
                    onClick={() => setViewDetailRow(null)}
                    className="text-gray-400 hover:text-gray-700 text-sm transition-colors"
                  >
                    닫기
                  </button>
                </div>

                {/* Email */}
                <p className="text-xs font-mono text-gray-600 bg-gray-50 border border-gray-200 px-3 py-2 rounded-lg">
                  {viewDetailRow.email}
                </p>

                {/* Fields */}
                <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-3 text-sm">

                  <dt className="text-gray-500 pt-px">채널</dt>
                  <dd className="text-gray-900">{detail.marketing_channel || "-"}</dd>

                  <dt className="text-gray-500 pt-px">채널 URL</dt>
                  <dd className="text-gray-900 break-all">
                    {resolvedChannelUrl ? (
                      <a
                        href={resolvedChannelUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 underline underline-offset-2 hover:text-blue-800 transition-colors"
                      >
                        {channelIdFallback ?? resolvedChannelUrl}
                      </a>
                    ) : (
                      "-"
                    )}
                  </dd>

                  <dt className="text-gray-500 pt-px">대표 게시물/영상 URL</dt>
                  <dd className="text-gray-900 break-all">
                    {detail.main_content_url ? (
                      <a
                        href={detail.main_content_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 underline underline-offset-2 hover:text-blue-800 transition-colors"
                      >
                        {detail.main_content_url}
                      </a>
                    ) : (
                      <span className="text-gray-400 italic text-xs">미제출 (임시저장)</span>
                    )}
                  </dd>

                  <dt className="text-gray-500 pt-px">업종</dt>
                  <dd className="text-gray-900">{detail.industry || "-"}</dd>

                  <dt className="text-gray-500 pt-px">상품/서비스</dt>
                  <dd className="text-gray-900">{detail.product_service || "-"}</dd>

                  <dt className="text-gray-500 pt-px">수량 · 기간</dt>
                  <dd className="text-gray-900">
                    {detail.selected_plan != null || detail.selected_duration != null
                      ? [
                          detail.selected_plan != null ? `${detail.selected_plan}명` : null,
                          detail.selected_duration != null ? `${detail.selected_duration}개월` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "-"
                      : "-"}
                  </dd>

                  <dt className="text-gray-500 pt-px">담당자</dt>
                  <dd className="text-gray-900">{detail.manager_name || "-"}</dd>

                  <dt className="text-gray-500 pt-px">연락처</dt>
                  <dd className="text-gray-900">{detail.phone || "-"}</dd>

                  <dt className="text-gray-500 pt-px">계정 방향</dt>
                  <dd className="text-gray-900 whitespace-pre-wrap">{detail.account_direction || "-"}</dd>

                  <dt className="text-gray-500 pt-px">계정 소개</dt>
                  <dd className="text-gray-900 whitespace-pre-wrap">{detail.account_bio || "-"}</dd>

                  <dt className="text-gray-500 pt-px">계정 컨셉</dt>
                  <dd className="text-gray-900 whitespace-pre-wrap">{detail.account_concept || "-"}</dd>

                  <dt className="text-gray-500 pt-px">제출일</dt>
                  <dd className="text-gray-900">{formatSeoulDate(viewDetailRow.marketer_submitted_at)}</dd>

                </dl>

                <div className="pt-2">
                  <button
                    onClick={() => setViewDetailRow(null)}
                    className="w-full py-2 rounded-xl text-sm font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 transition-colors"
                  >
                    닫기
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

      </div>
    </div>
  );
}
