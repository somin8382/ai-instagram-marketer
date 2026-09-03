"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for errors thrown in the root layout itself, where
 * app/error.tsx cannot render. Must supply its own <html>/<body>, and cannot
 * rely on the app's global stylesheet being applied — so the styling here is
 * inline on purpose.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/global-error]", error);
  }, [error]);

  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f9fafb",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
          padding: "24px",
        }}
      >
        <div
          style={{
            maxWidth: "420px",
            width: "100%",
            background: "#fff",
            border: "2px solid #f3f4f6",
            borderRadius: "16px",
            padding: "32px",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "18px", fontWeight: 700, color: "#111827", margin: "0 0 8px" }}>
            화면을 불러오지 못했습니다
          </h1>
          <p style={{ fontSize: "14px", color: "#6b7280", lineHeight: 1.6, margin: "0 0 20px" }}>
            일시적인 오류입니다. 다시 시도해주세요.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "8px 16px",
              fontSize: "14px",
              fontWeight: 600,
              color: "#fff",
              background: "#111827",
              border: "none",
              borderRadius: "12px",
              cursor: "pointer",
            }}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
