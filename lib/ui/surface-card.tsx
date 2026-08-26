"use client";

// Extracted from app/tools/page.tsx so every workspace surface (게시물 생성기,
// 브랜드 아이덴티티, ...) shares the exact same card chrome instead of each
// page reinventing its own border/shadow/spacing.

export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-6 ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
      {children}
    </p>
  );
}
