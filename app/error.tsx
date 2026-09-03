"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary. Without one, any uncaught client exception (the
 * localStorage quota overflow that used to take the generator down, for one)
 * renders Next's bare "Application error" screen — a blank page with no way
 * back. Here the user at least gets a retry and a route out.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error]", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
      <div className="w-full max-w-md bg-white border-2 border-gray-100 rounded-2xl p-8 text-center space-y-4">
        <div className="w-14 h-14 bg-rose-50 rounded-full flex items-center justify-center mx-auto">
          <span className="text-2xl">⚠️</span>
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-gray-900">
            화면을 불러오지 못했습니다
          </h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            일시적인 오류입니다. 다시 시도하거나 홈으로 이동해주세요.
            문제가 계속되면 문의해주세요.
          </p>
        </div>
        <div className="flex gap-2 justify-center pt-1">
          <button
            onClick={reset}
            className="px-4 py-2 text-sm font-semibold text-white bg-gray-900 rounded-xl hover:bg-gray-800 transition-colors"
          >
            다시 시도
          </button>
          <a
            href="/home"
            className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors"
          >
            홈으로
          </a>
        </div>
        {error.digest && (
          <p className="text-[10px] text-gray-400 pt-1">오류 코드: {error.digest}</p>
        )}
      </div>
    </div>
  );
}
