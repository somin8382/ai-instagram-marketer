"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";
import { AdminNav } from "@/lib/ui/admin-nav";

type PageState = "loading" | "no_session" | "forbidden" | "error" | "ready";

type Product = "marketer" | "generator";
type Row = {
  id: string;
  email: string;
  name: string | null;
  hostOrg: string | null;
  hasMarketer: boolean;
  hasGenerator: boolean;
  marketerMonths: number[];
  generatorMonths: number[];
};
// 한 구독 = 한 유저의 한 상품
type Entry = {
  email: string;
  name: string | null;
  hostOrg: string | null;
  product: Product;
  months: number[];
};

function adminFetch(path: string, token: string, init?: RequestInit) {
  return fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
}

function monthsLabel(months: number[]): string {
  return months.length
    ? `${[...months].sort((a, b) => a - b).join("·")}월`
    : "미이용";
}

// 이용 개월 목록 + 현재 월(KST) → 상태.
function statusOf(months: number[], nowM: number) {
  if (months.length === 0) return null;
  const has = months.includes(nowM);
  const max = Math.max(...months);
  const future = months.some((m) => m > nowM);
  if (has && max === nowM)
    return { key: "expiring", label: "이번 달 만료", cls: "bg-amber-100 text-amber-700" };
  if (has) return { key: "active", label: "구독중", cls: "bg-green-100 text-green-700" };
  if (future) return { key: "upcoming", label: "예정", cls: "bg-gray-100 text-gray-500" };
  return { key: "expired", label: "만료", cls: "bg-red-100 text-red-600" };
}

const PRODUCT_LABEL: Record<Product, string> = {
  marketer: "AI 마케터",
  generator: "AI 생성기",
};

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function AdminSubscriptionsPage() {
  const [pageState, setPageState] = useState<PageState>("loading");
  const [accessToken, setAccessToken] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  // draft[`${email}:${product}`] = number[] (선택된 이용 개월)
  const [drafts, setDrafts] = useState<Record<string, number[]>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [productFilter, setProductFilter] = useState<"all" | Product>("all");
  const [statusFilter, setStatusFilter] = useState("all"); // all|active|expiring|expired|upcoming

  const nowM = useMemo(
    () =>
      Number(
        new Date()
          .toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" })
          .slice(5, 7)
      ),
    []
  );

  function seedDrafts(data: Row[]) {
    const d: Record<string, number[]> = {};
    for (const r of data) {
      if (r.hasMarketer) d[`${r.email}:marketer`] = [...r.marketerMonths];
      if (r.hasGenerator) d[`${r.email}:generator`] = [...r.generatorMonths];
    }
    setDrafts(d);
  }

  async function load(token: string) {
    const res = await adminFetch("/api/admin/subscriptions", token);
    if (res.status === 401 || res.status === 403) return setPageState("forbidden");
    if (!res.ok) return setPageState("error");
    const data = (await res.json()) as { rows: Row[] };
    setRows(data.rows ?? []);
    seedDrafts(data.rows ?? []);
    setPageState("ready");
  }

  useEffect(() => {
    void (async () => {
      const supabase = getSupabaseBrowserClientOrNull();
      if (!supabase) return setPageState("no_session");
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      if (!token) return setPageState("no_session");
      setAccessToken(token);
      await load(token);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 플랫 목록: 유저×상품, 필터 적용
  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Entry[] = [];
    for (const r of rows) {
      const products: Product[] = [];
      if (r.hasMarketer) products.push("marketer");
      if (r.hasGenerator) products.push("generator");
      for (const product of products) {
        if (productFilter !== "all" && productFilter !== product) continue;
        const months = product === "marketer" ? r.marketerMonths : r.generatorMonths;
        if (statusFilter !== "all") {
          const st = statusOf(months, nowM);
          if ((st?.key ?? "expired") !== statusFilter) continue;
        }
        if (q) {
          const hay = `${r.name ?? ""} ${r.email} ${r.hostOrg ?? ""}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }
        out.push({ email: r.email, name: r.name, hostOrg: r.hostOrg, product, months });
      }
    }
    return out;
  }, [rows, query, productFilter, statusFilter, nowM]);

  const summary = useMemo(() => {
    const c = { active: 0, expiring: 0, expired: 0, upcoming: 0, total: 0 };
    for (const r of rows) {
      for (const [has, months] of [
        [r.hasMarketer, r.marketerMonths],
        [r.hasGenerator, r.generatorMonths],
      ] as const) {
        if (!has) continue;
        c.total++;
        const st = statusOf(months, nowM);
        if (st) (c as Record<string, number>)[st.key]++;
      }
    }
    return c;
  }, [rows, nowM]);

  function toggleMonth(key: string, m: number) {
    setDrafts((p) => {
      const cur = p[key] ?? [];
      const next = cur.includes(m)
        ? cur.filter((x) => x !== m)
        : [...cur, m].sort((a, b) => a - b);
      return { ...p, [key]: next };
    });
  }

  async function save(email: string, product: Product) {
    const key = `${email}:${product}`;
    const months = drafts[key] ?? [];
    setError(null);
    setSaving((s) => ({ ...s, [key]: true }));
    try {
      const res = await adminFetch("/api/admin/subscriptions", accessToken, {
        method: "PUT",
        body: JSON.stringify({ email, product, months }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        return setError(data.error ?? "저장에 실패했습니다.");
      }
      setRows((prev) =>
        prev.map((r) =>
          r.email === email
            ? product === "marketer"
              ? { ...r, marketerMonths: months }
              : { ...r, generatorMonths: months }
            : r
        )
      );
      setSavedKey(key);
      setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      setError("저장 중 오류가 발생했습니다.");
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  }

  if (pageState !== "ready") {
    const message =
      pageState === "loading" ? "로딩 중..."
        : pageState === "no_session" ? "관리자 로그인이 필요합니다."
          : pageState === "forbidden" ? "접근 권한이 없습니다."
            : "데이터를 불러오지 못했습니다.";
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500">{message}</div>;
  }

  const selectCls = "px-3 py-2 text-sm bg-white text-gray-700 border border-gray-200 rounded-xl focus:outline-none focus:border-gray-400";

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
        <AdminNav current="subscriptions" />

        <div>
          <h1 className="text-2xl font-bold text-gray-900">구독 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            AI 마케터·생성기 신청 유저의 <b>이용 월</b>을 관리합니다. 상품별로 이용한
            달을 켜고 끄면 상태가 자동 계산됩니다. (전체 유저·사전등록과 같은 개월 기준)
          </p>
        </div>

        {/* 요약 카드 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {([
            ["구독중", summary.active, "text-green-600"],
            ["이번 달 만료", summary.expiring, "text-amber-600"],
            ["만료", summary.expired, "text-red-500"],
            ["전체 구독", summary.total, "text-gray-900"],
          ] as const).map(([label, n, cls]) => (
            <div key={label} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3">
              <p className="text-xs text-gray-500">{label}</p>
              <p className={`text-xl font-bold ${cls}`}>{n}</p>
            </div>
          ))}
        </div>

        {/* 필터 */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3 flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="이름 · 이메일 · 기관 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={`${selectCls} flex-1 min-w-[10rem]`}
          />
          <select value={productFilter} onChange={(e) => setProductFilter(e.target.value as "all" | Product)} className={selectCls}>
            <option value="all">상품 전체</option>
            <option value="marketer">AI 마케터</option>
            <option value="generator">AI 생성기</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={selectCls}>
            <option value="all">상태 전체</option>
            <option value="active">구독중</option>
            <option value="expiring">이번 달 만료</option>
            <option value="expired">만료</option>
            <option value="upcoming">예정</option>
          </select>
          <button onClick={() => load(accessToken)} className="text-sm px-4 py-2 rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50">
            새로고침
          </button>
        </div>

        {error && (
          <p className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-xl px-4 py-2">{error}</p>
        )}

        <p className="text-xs text-gray-400 px-1">
          기준월 {nowM}월 · 표시 {entries.length}건
        </p>

        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-100">
          {entries.length === 0 ? (
            <div className="p-10 text-center text-gray-400">조건에 맞는 구독이 없습니다.</div>
          ) : (
            entries.map((e, i) => {
              const key = `${e.email}:${e.product}`;
              const draft = drafts[key] ?? [];
              const st = statusOf(e.months, nowM);
              const prev = entries[i - 1];
              const newUser = !prev || prev.email !== e.email; // 유저 첫 행에만 이름 표시
              const dirty =
                [...draft].sort((a, b) => a - b).join(",") !==
                [...e.months].sort((a, b) => a - b).join(",");
              const color = e.product === "marketer" ? "violet" : "sky";
              return (
                <div key={key} className="p-3 sm:flex sm:items-start sm:gap-4">
                  {/* 사용자 */}
                  <div className="sm:w-52 shrink-0 mb-2 sm:mb-0">
                    {newUser ? (
                      <>
                        <p className="font-medium text-gray-900 text-sm">{e.name || "—"}</p>
                        <p className="text-xs text-gray-400 break-all">{e.email}</p>
                      </>
                    ) : (
                      <p className="text-xs text-gray-300 hidden sm:block">〃</p>
                    )}
                  </div>

                  {/* 상품 + 개월 토글 */}
                  <div className="flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${e.product === "marketer" ? "bg-violet-100 text-violet-700" : "bg-sky-100 text-sky-700"}`}>
                        {PRODUCT_LABEL[e.product]}
                      </span>
                      <span className="text-xs text-gray-500">{monthsLabel(draft)}</span>
                      {st && (
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>
                          {st.label}
                        </span>
                      )}
                      <button
                        onClick={() => void save(e.email, e.product)}
                        disabled={saving[key] || !dirty}
                        className="text-xs px-3 py-1 rounded-lg bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 ml-auto"
                      >
                        {saving[key] ? "저장 중" : savedKey === key ? "저장됨 ✓" : dirty ? "저장" : "저장됨"}
                      </button>
                    </div>
                    {/* 1~12월 토글 */}
                    <div className="flex flex-wrap gap-1">
                      {MONTHS.map((m) => {
                        const on = draft.includes(m);
                        const isNow = m === nowM;
                        return (
                          <button
                            key={m}
                            onClick={() => toggleMonth(key, m)}
                            title={isNow ? "이번 달" : undefined}
                            className={`w-8 h-7 rounded-lg text-xs font-medium border transition-colors ${
                              on
                                ? color === "violet"
                                  ? "bg-violet-500 border-violet-500 text-white"
                                  : "bg-sky-500 border-sky-500 text-white"
                                : "bg-white border-gray-200 text-gray-400 hover:bg-gray-50"
                            } ${isNow ? "ring-2 ring-offset-1 ring-amber-400" : ""}`}
                          >
                            {m}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
