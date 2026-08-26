"use client";

// Extracted from app/tools/page.tsx (ToolsHeader) so every workspace tool
// (게시물 생성기, 브랜드 아이덴티티, ...) shares the exact same sticky header
// chrome: wordmark, optional back link, pricing/mypage links, optional
// progress bar for multi-step flows.

export function WorkspaceHeader({
  onBack,
  onHome,
  onMyPage,
  progress,
  progressLabel = "진행 단계",
  progressBarClassName = "bg-gradient-to-r from-violet-500 to-purple-500",
}: {
  onBack?: () => void;
  onHome: () => void;
  onMyPage: () => void;
  progress?: { current: number; total: number } | null;
  progressLabel?: string;
  progressBarClassName?: string;
}) {
  return (
    <div className="sticky top-0 z-20 bg-[#f8f9fb] pb-3">
      <div className="space-y-3 rounded-2xl border border-gray-200 bg-white/90 px-4 py-3 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <button
              onClick={onHome}
              className="text-sm font-bold tracking-tight text-gray-900"
            >
              큐밋
            </button>
            {onBack && (
              <button
                onClick={onBack}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                ← 뒤로
              </button>
            )}
          </div>
          <div className="flex items-center gap-4">
            <a
              href="/pricing"
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              가격 안내
            </a>
            <button
              onClick={onMyPage}
              className="text-sm font-medium text-rose-600 hover:text-rose-700 transition-colors"
            >
              마이페이지
            </button>
          </div>
        </div>
        {progress && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-gray-500 font-medium">
              <span>{progressLabel}</span>
              <span>
                {progress.current}/{progress.total}
              </span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${progressBarClassName}`}
                style={{
                  width: `${Math.max((progress.current / progress.total) * 100, 10)}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
