"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";

type InquiryRow = {
  id: string;
  message: string;
  status: string;
  admin_reply: string | null;
  replied_at: string | null;
  reply_read_at: string | null;
  created_at: string;
};

function fmt(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleString("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * Floating 문의 button (bottom-right on every page). Authenticated users can
 * submit inquiries/error reports and read admin replies; unread replies show
 * a red dot. Silently absent when Supabase is not configured.
 */
export function InquiryWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [inquiries, setInquiries] = useState<InquiryRow[]>([]);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClientOrNull();
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
      setEmail(session?.user?.email ?? null);
    });
  }, [pathname]);

  async function loadInquiries() {
    const supabase = getSupabaseBrowserClientOrNull();
    if (!supabase || !userId) return;
    const { data } = (await (supabase
      .from("inquiries" as never)
      .select("id, message, status, admin_reply, replied_at, reply_read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(20) as unknown as Promise<{
      data: InquiryRow[] | null;
      error: { message: string } | null;
    }>)) as { data: InquiryRow[] | null };
    setInquiries(data ?? []);
  }

  useEffect(() => {
    if (!userId) return;
    void (async () => {
      await loadInquiries();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const unreadCount = inquiries.filter(
    (inquiry) => inquiry.admin_reply && !inquiry.reply_read_at
  ).length;

  async function openPanel() {
    setOpen(true);
    setResult(null);
    if (!userId) return;
    await loadInquiries();
    // Mark replies as read when the panel opens
    const unread = inquiries.filter(
      (inquiry) => inquiry.admin_reply && !inquiry.reply_read_at
    );
    if (unread.length > 0) {
      const supabase = getSupabaseBrowserClientOrNull();
      if (supabase) {
        for (const inquiry of unread) {
          await (supabase
            .from("inquiries" as never)
            .update({ reply_read_at: new Date().toISOString() } as never)
            .eq("id", inquiry.id) as unknown as Promise<unknown>);
        }
        void loadInquiries();
      }
    }
  }

  async function submit() {
    if (submitting || !userId || !message.trim()) return;
    setSubmitting(true);
    setResult(null);
    try {
      const supabase = getSupabaseBrowserClientOrNull();
      if (!supabase) return;
      const { error } = (await (supabase.from("inquiries" as never).insert({
        user_id: userId,
        email,
        message: message.trim().slice(0, 2000),
        page_path: pathname,
      } as never) as unknown as Promise<{
        error: { message: string } | null;
      }>)) as { error: { message: string } | null };
      if (error) {
        setResult("접수에 실패했습니다. 잠시 후 다시 시도해주세요.");
        return;
      }
      setMessage("");
      setResult("접수되었습니다. 답변은 이곳에서 확인하실 수 있습니다.");
      void loadInquiries();
    } finally {
      setSubmitting(false);
    }
  }

  // Hide on admin pages (admins use the dashboard instead)
  if (pathname?.startsWith("/admin")) return null;

  return (
    <>
      <button
        onClick={() => (open ? setOpen(false) : void openPanel())}
        className="fixed bottom-14 right-3 sm:bottom-16 sm:right-4 z-[55] rounded-full bg-gray-900 text-white text-sm font-medium px-4 py-2.5 shadow-lg hover:bg-gray-700 transition-colors"
        aria-label="문의하기"
      >
        💬 문의
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed bottom-28 right-3 sm:right-4 z-[56] w-[calc(100vw-1.5rem)] max-w-sm bg-white rounded-2xl border border-gray-200 shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">문의 · 오류 신고</p>
            <button
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-gray-600"
              aria-label="닫기"
            >
              ✕
            </button>
          </div>

          <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
            {!userId ? (
              <p className="text-sm text-gray-500 py-4 text-center">
                로그인 후 문의를 남길 수 있습니다.{" "}
                <a href="/auth?tab=login" className="underline text-gray-700">
                  로그인
                </a>
              </p>
            ) : (
              <>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  placeholder="문의 내용이나 오류 상황을 적어주세요."
                  className="w-full px-3 py-2 bg-white text-gray-900 border border-gray-200 rounded-xl text-sm placeholder:text-gray-400 focus:outline-none focus:border-gray-400 resize-none"
                />
                <button
                  onClick={() => void submit()}
                  disabled={submitting || !message.trim()}
                  className="w-full py-2.5 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-40"
                >
                  {submitting ? "접수 중..." : "문의 접수"}
                </button>
                {result && <p className="text-xs text-gray-500">{result}</p>}

                {inquiries.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-gray-100">
                    <p className="text-xs font-medium text-gray-400">내 문의 내역</p>
                    {inquiries.map((inquiry) => (
                      <div
                        key={inquiry.id}
                        className="bg-gray-50 rounded-xl p-3 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-gray-400">
                            {fmt(inquiry.created_at)}
                          </span>
                          <span
                            className={`text-[11px] px-1.5 py-0.5 rounded-full ${
                              inquiry.admin_reply
                                ? "bg-green-100 text-green-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {inquiry.admin_reply ? "답변완료" : "접수됨"}
                          </span>
                        </div>
                        <p className="text-sm text-gray-800 whitespace-pre-wrap">
                          {inquiry.message}
                        </p>
                        {inquiry.admin_reply && (
                          <div className="bg-white rounded-lg p-2.5 border border-gray-100">
                            <p className="text-[11px] text-gray-400 mb-1">
                              답변 · {fmt(inquiry.replied_at)}
                            </p>
                            <p className="text-sm text-gray-800 whitespace-pre-wrap">
                              {inquiry.admin_reply}
                            </p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
