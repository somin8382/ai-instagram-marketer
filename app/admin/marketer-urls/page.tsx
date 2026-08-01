"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";
import { AdminNav } from "@/lib/ui/admin-nav";

type PageState = "loading" | "no_session" | "forbidden" | "error" | "ready";

type InvalidUrl = {
  applicationId: string;
  userId: string | null;
  email: string | null;
  managerName: string | null;
  createdAt: string | null;
  field: string;
  fieldLabel: string;
  platform: "instagram" | "youtube";
  value: string;
  reason: string;
};

function adminFetch(path: string, token: string): Promise<Response> {
  return fetch(path, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
}

function fmtDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function AdminMarketerUrlsPage() {
  const [pageState, setPageState] = useState<PageState>("loading");
  const [accessToken, setAccessToken] = useState("");
  const [items, setItems] = useState<InvalidUrl[]>([]);
  const [scanned, setScanned] = useState(0);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  async function load(token: string) {
    const res = await adminFetch("/api/admin/marketer-urls", token);
    if (res.status === 401 || res.status === 403) {
      setPageState("forbidden");
      return;
    }
    if (!res.ok) {
      setPageState("error");
      return;
    }
    const data = (await res.json()) as {
      invalid: InvalidUrl[];
      submissionsScanned: number;
      generatedAt: string;
    };
    setItems(data.invalid ?? []);
    setScanned(data.submissionsScanned ?? 0);
    setGeneratedAt(data.generatedAt ?? null);
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
      await load(token);
    })();
  }, []);

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

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-5">
        <AdminNav current="marketer-urls" />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">잘못된 URL 모아보기</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              마케터 제출 내역 중 형식이 잘못된 URL을 모아 사용자에게 수정을
              안내하기 위한 점검 목록입니다.
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              형식 오류 URL {items.length.toLocaleString()}건 · 검사한 제출{" "}
              {scanned.toLocaleString()}건
              {generatedAt &&
                ` · 갱신 ${new Date(generatedAt).toLocaleTimeString("ko-KR")}`}
            </p>
          </div>
          <button
            onClick={() => load(accessToken)}
            className="text-sm px-4 py-2 rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-colors"
          >
            새로고침
          </button>
        </div>

        {items.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 text-center text-gray-400">
            형식 오류 URL이 없습니다 🎉
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                    제출자
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                    필드
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                    입력된 URL
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                    문제
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                    제출일
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr
                    key={`${item.applicationId}-${item.field}-${index}`}
                    className="border-b border-gray-50"
                  >
                    <td className="px-3 py-2.5 align-top">
                      <p className="font-medium text-gray-900">
                        {item.managerName || "—"}
                      </p>
                      <p className="text-xs text-gray-400">{item.email || "—"}</p>
                    </td>
                    <td className="px-3 py-2.5 align-top whitespace-nowrap">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        {item.fieldLabel}
                      </span>
                      <p className="text-[11px] text-gray-400 mt-1">
                        {item.platform === "youtube" ? "유튜브" : "인스타그램"}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <span className="text-gray-800 break-all">{item.value}</span>
                    </td>
                    <td className="px-3 py-2.5 align-top text-red-600 whitespace-nowrap">
                      {item.reason}
                    </td>
                    <td className="px-3 py-2.5 align-top text-gray-500 whitespace-nowrap">
                      {fmtDateTime(item.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
