import Link from "next/link";

export type AdminTab =
  | "dashboard"
  | "users"
  | "subscriptions"
  | "outreach"
  | "marketer-urls"
  | "help";

const TABS: Array<{ id: AdminTab; label: string; href: string }> = [
  { id: "dashboard", label: "대시보드", href: "/admin" },
  { id: "users", label: "전체 유저", href: "/admin/users" },
  { id: "subscriptions", label: "구독 관리", href: "/admin/subscriptions" },
  { id: "outreach", label: "아웃리치", href: "/admin/outreach" },
  { id: "marketer-urls", label: "잘못된 URL", href: "/admin/marketer-urls" },
  { id: "help", label: "📖 사용설명서", href: "/admin/help" },
];

// Shared admin navigation. Rendered at the top of every admin page so no page
// is orphaned and the current location is always clear (active tab = dark pill).
export function AdminNav({ current }: { current: AdminTab }) {
  return (
    <nav className="flex flex-wrap items-center gap-2">
      {TABS.map((tab) => {
        const active = tab.id === current;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`text-sm px-4 py-2 rounded-xl transition-colors ${
              active
                ? "bg-gray-900 text-white"
                : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

// Small inline "ⓘ" with a plain-Korean explanation on hover/focus (native title
// tooltip — works without JS and on touch via long-press/label). Use next to
// non-obvious terms (미가입, 주관기관, 크레딧 지급 등).
export function InfoTip({ text }: { text: string }) {
  return (
    <span
      title={text}
      tabIndex={0}
      role="note"
      aria-label={text}
      className="inline-flex items-center justify-center w-4 h-4 ml-1 rounded-full bg-gray-200 text-gray-500 text-[10px] font-bold cursor-help align-middle select-none"
    >
      ?
    </span>
  );
}
