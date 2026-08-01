"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";

const MONTH = "2026-08";

/**
 * 8월 AI 마케터 이용자용 1회성 팝업. 지난 채널·메인 게시물을 그대로 8월에도
 * 진행할지, 변경할지 선택한다. 선택은 marketing_confirmations에 기록되어(RLS)
 * 이후에는 다시 뜨지 않고, 관리자도 결과를 확인할 수 있다.
 *   - "그대로 진행" → choice=keep, 닫기
 *   - "변경하기"   → choice=change 기록 후 onChange()(채널 설정 화면으로 이동)
 */
export function AugustMarketingPopup({
  userId,
  email,
  channelUrl,
  channelLabel,
  mainContentUrl,
  onChange,
}: {
  userId: string;
  email: string | null;
  channelUrl: string | null;
  channelLabel: string;
  mainContentUrl: string | null;
  onChange: () => void;
}) {
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabaseBrowserClientOrNull();
    if (!supabase) return;
    void (async () => {
      const { data } = (await (supabase
        .from("marketing_confirmations" as never)
        .select("id")
        .eq("user_id", userId)
        .eq("month", MONTH)
        .maybeSingle() as unknown as Promise<{ data: { id: string } | null }>));
      if (!data) setShow(true); // 아직 선택 안 함 → 표시
    })();
  }, [userId]);

  async function choose(choice: "keep" | "change") {
    if (saving) return;
    setSaving(true);
    try {
      const supabase = getSupabaseBrowserClientOrNull();
      if (supabase) {
        await (supabase.from("marketing_confirmations" as never).insert({
          user_id: userId,
          email,
          month: MONTH,
          choice,
        } as never) as unknown as Promise<unknown>);
      }
    } finally {
      setSaving(false);
      setShow(false);
      if (choice === "change") onChange();
    }
  }

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-6 space-y-5">
        <div className="space-y-1.5">
          <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold px-3 py-1">
            8월 AI 마케터
          </span>
          <h2 className="text-lg font-bold text-gray-900">
            8월 마케팅을 어떻게 진행할까요?
          </h2>
          <p className="text-sm text-gray-500 leading-relaxed">
            지난달에 등록한 채널·메인 게시물 그대로 8월에도 마케팅을 진행할지,
            변경할지 선택해 주세요.
          </p>
        </div>

        {/* 기존 정보 */}
        <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-2.5 text-sm">
          <div className="flex items-start justify-between gap-3">
            <span className="shrink-0 text-gray-400">{channelLabel}</span>
            {channelUrl ? (
              <a
                href={channelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 truncate text-right font-medium text-blue-600 hover:underline"
              >
                {channelUrl}
              </a>
            ) : (
              <span className="text-gray-400">-</span>
            )}
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="shrink-0 text-gray-400">메인 게시물</span>
            {mainContentUrl ? (
              <a
                href={mainContentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 truncate text-right font-medium text-blue-600 hover:underline"
              >
                {mainContentUrl}
              </a>
            ) : (
              <span className="text-gray-400">-</span>
            )}
          </div>
        </div>

        {/* 마감 안내 */}
        <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-sm text-amber-800 leading-relaxed">
          <p className="font-semibold">제출 마감 안내</p>
          <p className="mt-1">
            · <b>1차 마감 8월 3일</b> 또는 <b>2차 마감 8월 10일</b>까지 제출해
            주세요.
          </p>
          <p>
            · 8월 10일까지 제출해 주시면 마케터를 <b>1~2명 추가 투입</b>해 기간
            내 목표를 달성해 드리니 걱정하지 않으셔도 됩니다.
          </p>
          <p>
            · 다만 8월 10일 이후 제출은 다소 어려울 수 있으니, 늦어지실 경우 따로
            연락 주세요.
          </p>
        </div>

        {/* 선택 */}
        <div className="flex flex-col gap-2">
          <button
            onClick={() => void choose("keep")}
            disabled={saving}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-green-500 text-white font-semibold hover:from-emerald-600 hover:to-green-600 disabled:opacity-50 transition-colors"
          >
            그대로 8월 진행하기
          </button>
          <button
            onClick={() => void choose("change")}
            disabled={saving}
            className="w-full py-3 rounded-xl border border-gray-200 bg-white text-gray-700 font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            채널·게시물 변경하기
          </button>
        </div>
      </div>
    </div>
  );
}
