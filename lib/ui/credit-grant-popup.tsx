"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";

type PendingGrant = {
  id: string;
  amount: number;
  message: string | null;
};

/**
 * One-time popup for admin-issued bonus credits. Reads the user's own
 * unconfirmed credit_grants (RLS-scoped); pressing 확인 marks the grant
 * confirmed so it never shows again.
 */
export function CreditGrantPopup({ userId }: { userId: string }) {
  const [queue, setQueue] = useState<PendingGrant[]>([]);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!userId) return;
    const supabase = getSupabaseBrowserClientOrNull();
    if (!supabase) return;

    void (
      supabase
        .from("credit_grants" as never)
        .select("id, amount, message")
        .eq("confirmed", false)
        .order("created_at", { ascending: true }) as unknown as Promise<{
        data: PendingGrant[] | null;
        error: { message: string } | null;
      }>
    ).then(({ data, error }) => {
      if (!error && data?.length) setQueue(data);
    });
  }, [userId]);

  const current = queue[0];
  if (!current) return null;

  async function confirm() {
    if (confirming || !current) return;
    setConfirming(true);
    try {
      const supabase = getSupabaseBrowserClientOrNull();
      if (supabase) {
        await (supabase
          .from("credit_grants" as never)
          .update({
            confirmed: true,
            confirmed_at: new Date().toISOString(),
          } as never)
          .eq("id", current.id) as unknown as Promise<unknown>);
      }
    } finally {
      setQueue((prev) => prev.slice(1));
      setConfirming(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 text-center space-y-4">
        <p className="text-3xl">🎉</p>
        <p className="text-lg font-bold text-gray-900">
          생성 횟수 {current.amount}회가 추가 지급되었습니다!
        </p>
        {current.message && (
          <p className="text-sm text-gray-600 whitespace-pre-wrap">
            {current.message}
          </p>
        )}
        <button
          onClick={() => void confirm()}
          disabled={confirming}
          className="w-full py-3 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-40"
        >
          확인
        </button>
      </div>
    </div>
  );
}
