"use client";

// Extracted from app/tools/page.tsx (ToolsHeader) so every workspace tool
// (게시물 생성기, 브랜드 아이덴티티, ...) shares the exact same sticky header
// chrome: wordmark, optional back link, pricing/mypage links, optional
// progress bar for multi-step flows.

// The dark tone is spelled out rather than routed through the .ink-form CSS
// layer: the header's light build uses arbitrary page-background values
// (bg-[#f8f9fb]/85) that a utility remap cannot reach.
const TONE_STYLES = {
  light: {
    outer: "bg-[#f8f9fb]/85",
    panel: "border-gray-200 bg-white/90 shadow-sm",
    wordmark: "text-gray-900",
    quietLink: "text-gray-500 hover:text-gray-700",
    accentLink: "text-rose-600 hover:text-rose-700",
    progressLabel: "text-gray-500",
    progressTrack: "bg-gray-100",
  },
  dark: {
    outer: "bg-[color:var(--ink-bg)]/80",
    panel:
      "border-[color:var(--ink-line-strong)] bg-[color:var(--ink-raised)]/85",
    wordmark: "text-[color:var(--ink-text)]",
    quietLink:
      "text-[color:var(--ink-muted)] hover:text-[color:var(--ink-text)]",
    accentLink: "text-[color:var(--ink-accent)] hover:brightness-125",
    progressLabel: "text-[color:var(--ink-muted)]",
    progressTrack: "bg-white/10",
  },
} as const;

export function WorkspaceHeader({
  onBack,
  onHome,
  onMyPage,
  progress,
  progressLabel = "진행 단계",
  progressBarClassName = "bg-gradient-to-r from-violet-500 to-purple-500",
  tone = "light",
}: {
  onBack?: () => void;
  onHome: () => void;
  onMyPage: () => void;
  progress?: { current: number; total: number } | null;
  progressLabel?: string;
  progressBarClassName?: string;
  tone?: keyof typeof TONE_STYLES;
}) {
  const styles = TONE_STYLES[tone];

  return (
    <div className={`sticky top-0 z-20 backdrop-blur-sm pb-3 ${styles.outer}`}>
      <div
        className={`space-y-3 rounded-2xl border px-4 py-3 backdrop-blur ${styles.panel}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <button
              onClick={onHome}
              className={`text-sm font-bold tracking-tight ${styles.wordmark}`}
            >
              큐밋
            </button>
            {onBack && (
              <button
                onClick={onBack}
                className={`text-sm transition-colors ${styles.quietLink}`}
              >
                ← 뒤로
              </button>
            )}
          </div>
          <div className="flex items-center gap-4">
            <a
              href="/pricing"
              className={`text-sm transition-colors ${styles.quietLink}`}
            >
              가격 안내
            </a>
            <button
              onClick={onMyPage}
              className={`text-sm font-medium transition-colors ${styles.accentLink}`}
            >
              마이페이지
            </button>
          </div>
        </div>
        {progress && (
          <div className="space-y-2">
            <div
              className={`flex items-center justify-between text-[11px] font-medium ${styles.progressLabel}`}
            >
              <span>{progressLabel}</span>
              <span>
                {progress.current}/{progress.total}
              </span>
            </div>
            <div
              className={`h-2 rounded-full overflow-hidden ${styles.progressTrack}`}
            >
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
