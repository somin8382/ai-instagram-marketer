"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";
import { AppSurface } from "@/lib/ui/theme";

const MONTH = "2026-08";

type State = "loading" | "no_session" | "ready" | "already" | "done";

type Submitted = {
  channel: string | null;
  channelUrl: string | null;
  mainContentUrl: string | null;
  commentsIncluded: boolean | null;
};

export default function MarketingAugustPage() {
  const [state, setState] = useState<State>("loading");
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [channel, setChannel] = useState<"instagram" | "youtube">("instagram");
  const [channelUrl, setChannelUrl] = useState("");
  const [mainContentUrl, setMainContentUrl] = useState("");
  const [commentsIncluded, setCommentsIncluded] = useState(true);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const supabase = getSupabaseBrowserClientOrNull();
      if (!supabase) return setState("no_session");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? "";
      if (!uid) return setState("no_session");
      setUserId(uid);
      setEmail(session?.user?.email ?? null);
      // 이미 8월 정보를 제출했으면 수정 불가 — 제출 내용만 보여준다.
      const { data } = (await (supabase
        .from("monthly_channel_info" as never)
        .select("marketing_channel, channel_url, main_content_url, comments_included")
        .eq("user_id", uid)
        .eq("month", MONTH)
        .maybeSingle() as unknown as Promise<{
        data: {
          marketing_channel: string | null;
          channel_url: string | null;
          main_content_url: string | null;
          comments_included: boolean | null;
        } | null;
      }>));
      if (data) {
        setSubmitted({
          channel: data.marketing_channel,
          channelUrl: data.channel_url,
          mainContentUrl: data.main_content_url,
          commentsIncluded: data.comments_included,
        });
        setState("already");
      } else {
        setState("ready");
      }
    })();
  }, []);

  async function save() {
    if (saving) return;
    if (!channelUrl.trim()) return setError("채널 주소를 입력해주세요.");
    if (!mainContentUrl.trim()) return setError("메인 게시물 주소를 입력해주세요.");
    setError(null);
    setSaving(true);
    try {
      const supabase = getSupabaseBrowserClientOrNull();
      if (!supabase) return;
      const { error: err } = (await (supabase.from("monthly_channel_info" as never).upsert(
        {
          user_id: userId,
          email,
          month: MONTH,
          marketing_channel: channel,
          channel_url: channelUrl.trim(),
          main_content_url: mainContentUrl.trim(),
          comments_included: commentsIncluded,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: "user_id,month" }
      ) as unknown as Promise<{ error: { message: string } | null }>));
      if (err) {
        setError("저장에 실패했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }
      setState("done");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full px-3 py-2.5 bg-white text-gray-900 border border-gray-200 rounded-xl text-sm placeholder:text-gray-400 focus:outline-none focus:border-violet-400";

  if (state === "loading") {
    return (
      <AppSurface>
        <div className="relative min-h-screen flex items-center justify-center text-gray-500">
          로딩 중...
        </div>
      </AppSurface>
    );
  }
  if (state === "no_session") {
    return (
      <AppSurface>
        <div className="relative min-h-screen flex items-center justify-center text-gray-500">
        <p>
          로그인이 필요합니다.{" "}
          <Link href="/auth?tab=login" className="underline text-gray-700">
            로그인
          </Link>
        </p>
        </div>
      </AppSurface>
    );
  }

  // 마감/댓글 안내 — 폼과 완료 화면에서 공용으로 쓰는 안내 블록
  const DeadlineNotice = (
    <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-sm text-amber-800 leading-relaxed">
      <p className="font-semibold">제출 마감 안내</p>
      <p className="mt-1">
        · <b>1차 마감 8월 3일</b> 또는 <b>2차 마감 8월 10일</b>까지 제출해 주세요.
      </p>
      <p>
        · 8월 10일까지 제출해 주시면 마케터를 <b>1~2명 추가 투입</b>해 기간 내
        목표를 달성해 드리니 걱정하지 않으셔도 됩니다.
      </p>
      <p>
        · 다만 8월 10일 이후 제출은 다소 어려울 수 있으니, 늦어지실 경우 따로
        연락 주세요.
      </p>
    </div>
  );

  return (
    <AppSurface>
      <div className="relative min-h-screen text-gray-900">
      <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
        <Link
          href="/mypage"
          className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          ← 마이페이지
        </Link>

        {state === "done" || state === "already" ? (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 space-y-4">
            <div className="text-center space-y-2">
              <div className="text-3xl">✅</div>
              <h1 className="text-xl font-bold text-gray-900">
                {state === "done"
                  ? "8월 정보가 제출되었습니다"
                  : "이미 8월 정보를 제출하셨습니다"}
              </h1>
              <p className="text-sm text-gray-500 leading-relaxed">
                입력하신 채널·메인 게시물로 8월 마케팅이 진행됩니다.{" "}
                <b>제출한 내용은 수정할 수 없으니</b>, 변경이 필요하시면 따로
                문의해 주세요.
              </p>
            </div>

            {submitted && (
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-gray-400 shrink-0">채널</span>
                  <span className="text-right break-all font-medium text-gray-700">
                    {submitted.channel === "youtube" ? "유튜브" : "인스타그램"}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-400 shrink-0">채널 주소</span>
                  <span className="text-right break-all text-gray-700">
                    {submitted.channelUrl || "-"}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-400 shrink-0">메인 게시물</span>
                  <span className="text-right break-all text-gray-700">
                    {submitted.mainContentUrl || "-"}
                  </span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-gray-400 shrink-0">댓글 이벤트</span>
                  <span className="text-right font-medium text-gray-700">
                    {submitted.commentsIncluded === false
                      ? "미포함 (좋아요·팔로우로 대체)"
                      : "포함"}
                  </span>
                </div>
              </div>
            )}

            <Link
              href="/mypage"
              className="inline-flex w-full items-center justify-center rounded-xl bg-gray-900 text-white text-sm font-semibold px-5 py-2.5 hover:bg-gray-700 transition-colors"
            >
              마이페이지로
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-5">
            <div className="space-y-1.5">
              <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold px-3 py-1">
                8월 AI 마케터
              </span>
              <h1 className="text-xl font-bold text-gray-900">
                8월 채널·게시물 변경
              </h1>
              <p className="text-sm text-gray-500 leading-relaxed">
                8월에 마케팅할 <b>채널과 메인 게시물</b>을 입력해 주세요. (7월
                정보와 별개로 저장됩니다)
              </p>
            </div>

            {DeadlineNotice}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">채널 종류</label>
              <div className="flex gap-2">
                {(["instagram", "youtube"] as const).map((c) => (
                  <button
                    key={c}
                    onClick={() => setChannel(c)}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                      channel === c
                        ? "border-violet-400 bg-violet-50 text-violet-700"
                        : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    {c === "instagram" ? "인스타그램" : "유튜브"}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">
                {channel === "youtube" ? "채널 주소" : "계정 주소"}
              </label>
              <input
                type="url"
                value={channelUrl}
                onChange={(e) => setChannelUrl(e.target.value)}
                placeholder={
                  channel === "youtube"
                    ? "https://www.youtube.com/@..."
                    : "https://www.instagram.com/..."
                }
                className={inputCls}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">
                {channel === "youtube" ? "메인 영상 주소" : "메인 게시물 주소"}
              </label>
              <input
                type="url"
                value={mainContentUrl}
                onChange={(e) => setMainContentUrl(e.target.value)}
                placeholder="https://..."
                className={inputCls}
              />
            </div>

            {/* 댓글 이벤트 안내 + 포함/미포함 선택 */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-600">
                댓글 이벤트
              </label>
              <p className="text-xs text-gray-500 leading-relaxed rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5">
                댓글은 <b>하루 이벤트</b>로 진행됩니다. 실제로는 불특정 다수가
                참여해 직접 작성하기 때문에 <b>특정 댓글 내용은 지정할 수
                없습니다.</b> 원치 않으시면 댓글 대신 <b>좋아요·팔로우 등으로
                대체</b>해 마저 진행해 드립니다.
              </p>
              <div className="flex gap-2">
                {(
                  [
                    [true, "댓글 포함"],
                    [false, "미포함 (좋아요·팔로우로 대체)"],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={String(val)}
                    onClick={() => setCommentsIncluded(val)}
                    className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${
                      commentsIncluded === val
                        ? "border-violet-400 bg-violet-50 text-violet-700"
                        : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 제출 전 최종 확인 안내 */}
            <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700 leading-relaxed">
              한 번 제출하시면 <b>수정할 수 없습니다.</b> 내용을 꼼꼼히
              확인하시고, 확정되면 저장해 주세요.
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <button
              onClick={() => void save()}
              disabled={saving}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 text-white font-semibold hover:from-violet-600 hover:to-purple-600 disabled:opacity-50 transition-colors"
            >
              {saving ? "제출 중..." : "확정하고 제출하기"}
            </button>
          </div>
        )}
      </div>
      </div>
    </AppSurface>
  );
}
