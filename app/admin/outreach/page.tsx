"use client";

import { useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";
import { AdminNav } from "@/lib/ui/admin-nav";

type PageState = "loading" | "no_session" | "forbidden" | "error" | "ready";

type UserRow = {
  id: string;
  signedUp: boolean;
  email: string | null;
  name: string | null;
  companyName: string | null;
  phone: string | null;
  hostOrg: string | null;
  mentorOrg: string | null;
  aiMarketer: boolean;
  aiMarketerSub: boolean;
  aiGeneratorSub: boolean;
  subscriptionActive: boolean;
  createdAt: string | null;
};

type Channel = "email" | "sms" | "alimtalk";
type Category = "notice" | "ad";

type CampaignRow = {
  id: string;
  channel: string;
  category: string;
  subject: string | null;
  body: string;
  created_by: string | null;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  created_at: string;
};

type SendRow = {
  recipient_email: string | null;
  recipient_phone: string | null;
  recipient_name: string | null;
  status: string;
  error: string | null;
  created_at: string;
};

function adminFetch(path: string, token: string, options: RequestInit = {}) {
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers as Record<string, string> | undefined),
    },
  });
}

function fmtDateTime(v: string | null): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

const inputCls =
  "w-full px-3 py-2 bg-white text-gray-900 border border-gray-200 rounded-xl text-sm placeholder:text-gray-400 focus:outline-none focus:border-gray-400";
const selectCls =
  "px-3 py-2 bg-white text-gray-900 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-gray-400";

export default function AdminOutreachPage() {
  const [pageState, setPageState] = useState<PageState>("loading");
  const [token, setToken] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [config, setConfig] = useState<Record<Channel, boolean>>({
    email: false,
    sms: false,
    alimtalk: false,
  });
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [optOutEmails, setOptOutEmails] = useState<Set<string>>(new Set());
  const [optOutPhones, setOptOutPhones] = useState<Set<string>>(new Set());

  // Recipient filters (reuse the 전체 유저 dimensions; default to 미가입)
  const [query, setQuery] = useState("");
  const [signupFilter, setSignupFilter] = useState<"pre" | "signed" | "all">("pre");
  const [hostOrgFilter, setHostOrgFilter] = useState("all");
  const [subFilter, setSubFilter] = useState<"all" | "generator" | "marketer" | "none">("all");
  const [marketerOnly, setMarketerOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Test send + confirm-before-bulk
  const [testAddress, setTestAddress] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // Compose
  const [channel, setChannel] = useState<Channel>("email");
  const [category, setCategory] = useState<Category>("notice");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // History detail
  const [openCampaign, setOpenCampaign] = useState<CampaignRow | null>(null);
  const [sends, setSends] = useState<SendRow[]>([]);
  const [sendsLoading, setSendsLoading] = useState(false);

  async function loadAll(t: string) {
    const [usersRes, outreachRes] = await Promise.all([
      adminFetch("/api/admin/users/list", t),
      adminFetch("/api/admin/outreach", t),
    ]);
    if (usersRes.status === 401 || usersRes.status === 403) {
      setPageState("forbidden");
      return;
    }
    if (!usersRes.ok) {
      setPageState("error");
      return;
    }
    const usersData = (await usersRes.json()) as { users: UserRow[] };
    setUsers(usersData.users ?? []);
    if (outreachRes.ok) {
      const o = (await outreachRes.json()) as {
        messages: CampaignRow[];
        config: Record<Channel, boolean>;
        optOutEmails?: string[];
        optOutPhones?: string[];
      };
      setCampaigns(o.messages ?? []);
      if (o.config) setConfig(o.config);
      setOptOutEmails(new Set(o.optOutEmails ?? []));
      setOptOutPhones(new Set(o.optOutPhones ?? []));
    }
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
      const t = session?.access_token ?? "";
      if (!t) {
        setPageState("no_session");
        return;
      }
      setToken(t);
      await loadAll(t);
    })();
  }, []);

  const hostOrgs = useMemo(() => {
    const set = new Set<string>();
    for (const u of users) if (u.hostOrg) set.add(u.hostOrg);
    return [...set].sort();
  }, [users]);

  // Is this recipient opted out on the current channel?
  function isOptedOut(u: UserRow): boolean {
    if (channel === "email") {
      return !!u.email && optOutEmails.has(u.email.trim().toLowerCase());
    }
    return !!u.phone && optOutPhones.has(u.phone.replace(/[^0-9]/g, ""));
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (signupFilter === "pre" && u.signedUp) return false;
      if (signupFilter === "signed" && !u.signedUp) return false;
      if (hostOrgFilter !== "all" && u.hostOrg !== hostOrgFilter) return false;
      if (marketerOnly && !u.aiMarketer) return false;
      if (subFilter === "generator" && !u.aiGeneratorSub) return false;
      if (subFilter === "marketer" && !u.aiMarketerSub) return false;
      if (subFilter === "none" && (u.aiGeneratorSub || u.aiMarketerSub)) return false;
      // channel needs the matching contact field
      if (channel === "email" && !u.email) return false;
      if (channel !== "email" && !u.phone) return false;
      if (q) {
        const hay = [u.name, u.email, u.companyName, u.hostOrg, u.phone]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [users, query, signupFilter, hostOrgFilter, subFilter, marketerOnly, channel]);

  // Selected, opted-out excluded (defensive — opted-out rows aren't selectable).
  const selectedRecipients = useMemo(
    () => filtered.filter((u) => selectedIds.has(u.id) && !isOptedOut(u)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, selectedIds, optOutEmails, optOutPhones, channel]
  );

  const filterOptedOutCount = useMemo(
    () => filtered.filter((u) => isOptedOut(u)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, optOutEmails, optOutPhones, channel]
  );

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function selectAllInFilter() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const u of filtered) if (!isOptedOut(u)) next.add(u.id);
      return next;
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  // Cost estimate (KRW) shown in the confirm step. Email via Gmail = free;
  // SMS/알림톡 are per-message (rough ranges until Solapi rate is known).
  function estimateCost(count: number): string {
    if (channel === "email") return "무료 (이메일)";
    const per = channel === "sms" ? "8~45" : "7~15";
    const lo = channel === "sms" ? count * 8 : count * 7;
    const hi = channel === "sms" ? count * 45 : count * 15;
    return `약 ${lo.toLocaleString()}~${hi.toLocaleString()}원 (건당 ${per}원)`;
  }

  async function postCampaign(
    recipients: Array<{ email: string | null; phone: string | null; name: string | null; company: string | null }>,
    opts: { test?: boolean } = {}
  ) {
    const res = await adminFetch("/api/admin/outreach", token, {
      method: "POST",
      body: JSON.stringify({ channel, category, subject, body: message, recipients, test: opts.test }),
    });
    return { res, data: (await res.json()) as Record<string, unknown> };
  }

  async function send() {
    if (sending) return;
    setShowConfirm(false);
    const recipients = selectedRecipients.map((u) => ({
      email: u.email,
      phone: u.phone,
      name: u.name,
      company: u.companyName ?? u.hostOrg,
    }));
    if (recipients.length === 0) {
      setResult("오류: 수신자를 선택해주세요.");
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const { res, data } = await postCampaign(recipients);
      if (!res.ok || !data.ok) {
        setResult(`오류: ${(data.error as string) ?? "발송에 실패했습니다."}`);
        return;
      }
      setResult(
        `발송 완료 — 대상 ${data.total} · 성공 ${data.sent} · 실패 ${data.failed} · 건너뜀 ${data.skipped}`
      );
      clearSelection();
      await loadAll(token);
    } finally {
      setSending(false);
    }
  }

  async function sendTest() {
    if (testing) return;
    const addr = testAddress.trim();
    if (!addr) {
      setTestResult("오류: 테스트 주소를 입력해주세요.");
      return;
    }
    if (!message.trim() || (channel === "email" && !subject.trim())) {
      setTestResult("오류: 제목/본문을 먼저 작성해주세요.");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const recipient =
        channel === "email"
          ? { email: addr, phone: null, name: "테스트", company: "테스트" }
          : { email: null, phone: addr, name: "테스트", company: "테스트" };
      const { res, data } = await postCampaign([recipient], { test: true });
      if (!res.ok || !data.ok) {
        setTestResult(`오류: ${(data.error as string) ?? "테스트 발송 실패"}`);
        return;
      }
      const results = (data.results as Array<{ status: string; error?: string }>) ?? [];
      const first = results[0];
      setTestResult(
        first?.status === "sent"
          ? "테스트 발송 성공 — 수신함을 확인해주세요."
          : `테스트 실패: ${first?.error ?? "알 수 없는 오류"}`
      );
    } finally {
      setTesting(false);
    }
  }

  async function resendFailed(campaign: CampaignRow) {
    const failed = sends.filter((s) => s.status === "failed");
    if (failed.length === 0) return;
    // Re-send uses the campaign's own channel/category/subject/body.
    const recipients = failed.map((s) => ({
      email: s.recipient_email,
      phone: s.recipient_phone,
      name: s.recipient_name,
      company: null,
    }));
    const res = await adminFetch("/api/admin/outreach", token, {
      method: "POST",
      body: JSON.stringify({
        channel: campaign.channel,
        category: campaign.category,
        subject: campaign.subject,
        body: campaign.body,
        recipients,
      }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (res.ok && data.ok) {
      setOpenCampaign(null);
      await loadAll(token);
      setResult(`실패분 재발송 — 성공 ${data.sent} · 실패 ${data.failed} · 건너뜀 ${data.skipped}`);
    }
  }

  function duplicateCampaign(c: CampaignRow) {
    setChannel((["email", "sms", "alimtalk"].includes(c.channel) ? c.channel : "email") as Channel);
    setCategory(c.category === "ad" ? "ad" : "notice");
    setSubject(c.subject ?? "");
    setMessage(c.body);
    setOpenCampaign(null);
    setResult("이전 캠페인 내용을 불러왔습니다. 수신자를 선택 후 발송하세요.");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function openDetail(c: CampaignRow) {
    setOpenCampaign(c);
    setSends([]);
    setSendsLoading(true);
    try {
      const res = await adminFetch(`/api/admin/outreach/sends?messageId=${c.id}`, token);
      if (res.ok) {
        const d = (await res.json()) as { sends: SendRow[] };
        setSends(d.sends ?? []);
      }
    } finally {
      setSendsLoading(false);
    }
  }

  if (pageState !== "ready") {
    const msg =
      pageState === "loading"
        ? "로딩 중..."
        : pageState === "no_session"
          ? "관리자 로그인이 필요합니다."
          : pageState === "forbidden"
            ? "접근 권한이 없습니다."
            : "데이터를 불러오지 못했습니다.";
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500">
        {msg}
      </div>
    );
  }

  const channelReady = config[channel];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-5">
        <AdminNav current="outreach" />
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">아웃리치</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              미가입·사전등록 사용자에게 안내/광고 메시지를 보냅니다. 처음이면
              테스트 발송으로 먼저 확인하세요.
            </p>
          </div>
          <button
            onClick={() => loadAll(token)}
            className="text-sm px-4 py-2 rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
          >
            새로고침
          </button>
        </div>

        {/* Channel config status */}
        <div className="flex flex-wrap gap-2 text-xs">
          {(["email", "sms", "alimtalk"] as Channel[]).map((ch) => (
            <span
              key={ch}
              className={`px-2.5 py-1 rounded-full font-medium ${
                config[ch] ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"
              }`}
            >
              {ch === "email" ? "이메일" : ch === "sms" ? "SMS" : "알림톡"}{" "}
              {config[ch] ? "설정됨" : "미설정"}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Recipients */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-900">수신자 선택</p>
              <span className="text-xs text-gray-500">
                선택 {selectedRecipients.length} / 필터 {filtered.length}
              </span>
            </div>
            <input
              type="text"
              placeholder="이름 · 이메일 · 회사 · 전화 검색"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={inputCls}
            />
            <div className="flex flex-wrap gap-2">
              <select
                value={signupFilter}
                onChange={(e) => setSignupFilter(e.target.value as typeof signupFilter)}
                className={selectCls}
              >
                <option value="pre">미가입 (사전등록)</option>
                <option value="signed">가입</option>
                <option value="all">전체</option>
              </select>
              <select
                value={hostOrgFilter}
                onChange={(e) => setHostOrgFilter(e.target.value)}
                className={selectCls}
              >
                <option value="all">주관기관 전체</option>
                {hostOrgs.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <select
                value={subFilter}
                onChange={(e) => setSubFilter(e.target.value as typeof subFilter)}
                className={selectCls}
              >
                <option value="all">구독 전체</option>
                <option value="generator">생성기 구독</option>
                <option value="marketer">마케터 구독</option>
                <option value="none">미구독</option>
              </select>
              <label className="flex items-center gap-1.5 text-sm text-gray-600 px-2">
                <input
                  type="checkbox"
                  checked={marketerOnly}
                  onChange={(e) => setMarketerOnly(e.target.checked)}
                />
                마케터 대상만
              </label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={selectAllInFilter}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                필터 전체 선택 ({filtered.length})
              </button>
              <button
                onClick={clearSelection}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                선택 해제
              </button>
            </div>
            <p className="text-[11px] text-gray-400">
              {channel === "email" ? "이메일이 없는 대상은 숨겨집니다." : "전화번호가 없는 대상은 숨겨집니다."}
              {filterOptedOutCount > 0 && (
                <span className="text-amber-600">
                  {" "}· 수신거부 {filterOptedOutCount}명은 선택·발송에서 제외됩니다.
                </span>
              )}
            </p>
            <div className="max-h-80 overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-50">
              {filtered.slice(0, 500).map((u) => {
                const optedOut = isOptedOut(u);
                return (
                  <label
                    key={u.id}
                    className={`flex items-center gap-3 px-3 py-2 ${
                      optedOut
                        ? "opacity-50 cursor-not-allowed"
                        : "hover:bg-gray-50 cursor-pointer"
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={optedOut}
                      checked={selectedIds.has(u.id) && !optedOut}
                      onChange={() => toggle(u.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-900 truncate">
                        {u.name || "—"}
                        {!u.signedUp && (
                          <span className="ml-1.5 text-[10px] text-gray-400">미가입</span>
                        )}
                        {optedOut && (
                          <span className="ml-1.5 text-[10px] text-amber-600">수신거부</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400 truncate">
                        {channel === "email" ? u.email : u.phone} · {u.hostOrg || "기관 없음"}
                      </p>
                    </div>
                  </label>
                );
              })}
              {filtered.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">
                  조건에 맞는 수신자가 없습니다
                </p>
              )}
              {filtered.length > 500 && (
                <p className="text-[11px] text-gray-400 text-center py-2">
                  상위 500명만 표시 (필터 전체 선택은 {filtered.length}명 모두 적용)
                </p>
              )}
            </div>
          </div>

          {/* Compose */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-3">
            <p className="text-sm font-semibold text-gray-900">메시지 작성</p>
            <div className="flex flex-wrap gap-2">
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as Channel)}
                className={selectCls}
              >
                <option value="email">이메일</option>
                <option value="sms">SMS</option>
                <option value="alimtalk">알림톡</option>
              </select>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
                className={selectCls}
              >
                <option value="notice">안내성</option>
                <option value="ad">광고성</option>
              </select>
            </div>

            {!channelReady && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-700">
                이 채널은 아직 설정되지 않았습니다. 발송하려면 환경변수(키/발신번호/템플릿)를 먼저
                등록해야 합니다. {channel === "email" ? "이메일은 OUTREACH_SMTP_PASS만 추가하면 됩니다." : "SMS/알림톡은 Solapi 계정이 필요합니다."}
              </div>
            )}
            {category === "ad" && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-blue-700">
                광고성 발송에는 자동으로 <b>(광고)</b> 표기와 <b>무료수신거부</b> 안내가 추가됩니다.
              </div>
            )}

            {channel === "email" && (
              <input
                type="text"
                placeholder="제목 (예: {{name}}님, 큐밋 AI 마케터 안내)"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className={inputCls}
              />
            )}
            <textarea
              placeholder={`본문. 변수 사용 가능: {{name}}, {{company}}\n예) {{name}}님, {{company}}의 마케팅을 도와드릴게요.`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={8}
              className={`${inputCls} resize-none font-mono`}
            />
            <p className="text-[11px] text-gray-400">
              변수: <code>{"{{name}}"}</code> · <code>{"{{company}}"}</code> (없으면 빈칸)
            </p>

            {/* Preview against the first selected recipient */}
            {selectedRecipients[0] && (
              <div className="bg-gray-50 rounded-xl p-3 text-xs text-gray-600 space-y-1">
                <p className="font-medium text-gray-500">
                  미리보기 ({selectedRecipients[0].name || selectedRecipients[0].email})
                </p>
                {channel === "email" && (
                  <p>
                    <span className="text-gray-400">제목: </span>
                    {(category === "ad" ? "(광고) " : "") +
                      subject
                        .replace(/\{\{\s*name\s*\}\}/g, selectedRecipients[0].name ?? "")
                        .replace(
                          /\{\{\s*company\s*\}\}/g,
                          selectedRecipients[0].companyName ?? selectedRecipients[0].hostOrg ?? ""
                        )}
                  </p>
                )}
                <p className="whitespace-pre-wrap">
                  {(channel === "sms" && category === "ad" ? "(광고) " : "") +
                    message
                      .replace(/\{\{\s*name\s*\}\}/g, selectedRecipients[0].name ?? "")
                      .replace(
                        /\{\{\s*company\s*\}\}/g,
                        selectedRecipients[0].companyName ?? selectedRecipients[0].hostOrg ?? ""
                      )}
                </p>
              </div>
            )}

            {/* Test send */}
            <div className="border-t border-gray-100 pt-3 space-y-2">
              <p className="text-xs font-medium text-gray-500">테스트 발송</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={testAddress}
                  onChange={(e) => setTestAddress(e.target.value)}
                  placeholder={channel === "email" ? "내 이메일 주소" : "내 전화번호"}
                  className={inputCls}
                />
                <button
                  onClick={() => void sendTest()}
                  disabled={testing || !channelReady}
                  className="shrink-0 text-sm px-4 py-2 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-40"
                >
                  {testing ? "발송 중..." : "테스트"}
                </button>
              </div>
              {testResult && (
                <p
                  className={`text-xs ${
                    testResult.startsWith("오류") || testResult.startsWith("테스트 실패")
                      ? "text-red-500"
                      : "text-green-600"
                  }`}
                >
                  {testResult}
                </p>
              )}
            </div>

            <button
              onClick={() => setShowConfirm(true)}
              disabled={sending || selectedRecipients.length === 0 || !channelReady}
              className="w-full py-3 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-40"
            >
              {sending ? "발송 중..." : `${selectedRecipients.length}명에게 발송`}
            </button>
            {result && (
              <p
                className={`text-sm ${
                  result.startsWith("오류") ? "text-red-500" : "text-green-600"
                }`}
              >
                {result}
              </p>
            )}
          </div>
        </div>

        {/* History */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-x-auto">
          <div className="px-5 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-900">발송 이력</p>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100">
              <tr>
                {["일시", "채널", "구분", "제목/본문", "대상", "성공", "실패", "건너뜀", "발송자"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => openDetail(c)}
                  className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                    {fmtDateTime(c.created_at)}
                  </td>
                  <td className="px-3 py-2.5">
                    {c.channel === "email" ? "이메일" : c.channel === "sms" ? "SMS" : "알림톡"}
                  </td>
                  <td className="px-3 py-2.5">
                    {c.category === "ad" ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                        광고
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                        안내
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 max-w-xs truncate text-gray-800">
                    {c.subject ? `${c.subject} · ` : ""}
                    {c.body.slice(0, 40)}
                  </td>
                  <td className="px-3 py-2.5 text-gray-600">{c.total}</td>
                  <td className="px-3 py-2.5 text-green-600">{c.sent}</td>
                  <td className="px-3 py-2.5 text-red-500">{c.failed}</td>
                  <td className="px-3 py-2.5 text-gray-400">{c.skipped}</td>
                  <td className="px-3 py-2.5 text-gray-400 text-xs">{c.created_by}</td>
                </tr>
              ))}
              {campaigns.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-gray-400">
                    발송 이력이 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Confirm-before-bulk-send */}
      {showConfirm && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowConfirm(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-gray-900">발송 확인</h2>
            <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">채널</span>
                <span className="font-medium text-gray-900">
                  {channel === "email" ? "이메일" : channel === "sms" ? "SMS" : "알림톡"}
                  {" · "}
                  {category === "ad" ? "광고성" : "안내성"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">수신자</span>
                <span className="font-bold text-gray-900">
                  {selectedRecipients.length.toLocaleString()}명
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">예상 비용</span>
                <span className="font-medium text-gray-900">
                  {estimateCost(selectedRecipients.length)}
                </span>
              </div>
            </div>
            {category === "ad" && (
              <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-lg p-2.5">
                (광고) 표기와 무료수신거부 안내가 자동으로 포함됩니다.
              </p>
            )}
            {selectedRecipients.length >= 200 && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2.5">
                ⚠️ 대량 발송입니다. 수신자 수와 내용을 다시 확인해주세요.
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => void send()}
                disabled={sending}
                className="flex-1 py-3 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-40"
              >
                {sending ? "발송 중..." : "정말 발송하기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {openCampaign && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setOpenCampaign(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-start justify-between">
              <div>
                <p className="text-sm font-bold text-gray-900">
                  {openCampaign.channel === "email" ? "이메일" : openCampaign.channel === "sms" ? "SMS" : "알림톡"}{" "}
                  · {openCampaign.category === "ad" ? "광고" : "안내"}
                </p>
                <p className="text-xs text-gray-500">{fmtDateTime(openCampaign.created_at)}</p>
              </div>
              <button
                onClick={() => setOpenCampaign(null)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              {openCampaign.subject && (
                <div>
                  <p className="text-xs text-gray-400">제목</p>
                  <p className="text-sm text-gray-900">{openCampaign.subject}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-400">본문</p>
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{openCampaign.body}</p>
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-gray-500">대상 {openCampaign.total}</span>
                <span className="text-green-600">성공 {openCampaign.sent}</span>
                <span className="text-red-500">실패 {openCampaign.failed}</span>
                <span className="text-gray-400">건너뜀 {openCampaign.skipped}</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => duplicateCampaign(openCampaign)}
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  이 내용으로 다시 작성
                </button>
                {openCampaign.failed > 0 && (
                  <button
                    onClick={() => void resendFailed(openCampaign)}
                    disabled={sendsLoading || sends.length === 0}
                    className="text-sm px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-40"
                  >
                    실패 {openCampaign.failed}명에게 재발송
                  </button>
                )}
              </div>
              <div className="border-t border-gray-100 pt-3">
                <p className="text-xs font-medium text-gray-400 mb-2">수신자별 결과</p>
                {sendsLoading ? (
                  <p className="text-sm text-gray-500">로딩 중...</p>
                ) : (
                  <div className="space-y-1 max-h-72 overflow-y-auto">
                    {sends.map((s, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between gap-3 text-xs px-3 py-1.5 bg-gray-50 rounded-lg"
                      >
                        <span className="text-gray-700 truncate">
                          {s.recipient_name ? `${s.recipient_name} · ` : ""}
                          {s.recipient_email || s.recipient_phone}
                        </span>
                        <span
                          className={
                            s.status === "sent"
                              ? "text-green-600"
                              : s.status === "failed"
                                ? "text-red-500"
                                : "text-gray-400"
                          }
                        >
                          {s.status === "sent" ? "성공" : s.status === "failed" ? `실패: ${s.error ?? ""}` : `건너뜀: ${s.error ?? ""}`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
