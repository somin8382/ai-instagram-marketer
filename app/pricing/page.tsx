import Link from "next/link";
import { AppSurface, ThemeToggle } from "@/lib/ui/theme";

export const metadata = {
  title: "가격 안내 · AI 인스타그램 마케터",
  description: "크레딧 충전 요금 안내",
};

// 1원 = 1크레딧. 충전 금액만큼 크레딧이 지급됩니다.
const PLANS: Array<{ won: number; man: number; highlight?: boolean }> = [
  { won: 330000, man: 33, highlight: true },
  { won: 660000, man: 66 },
  { won: 990000, man: 99 },
  { won: 1320000, man: 132 },
];

// 월 이용료(정액 구독) 안내. 크레딧과 별개로, 서비스별로 정해진 금액이다.
const SERVICES: Array<{ name: string; won: number; accentCls: string }> = [
  { name: "AI 마케터", won: 330000, accentCls: "text-rose-600 bg-rose-50" },
  {
    name: "게시물 AI 생성기",
    won: 22000,
    accentCls: "text-violet-600 bg-violet-50",
  },
];

function comma(n: number): string {
  return n.toLocaleString("ko-KR");
}

export default function PricingPage() {
  return (
    <AppSurface accent="violet" className="text-gray-900">
    <div className="relative min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12 space-y-8">
        {/* 상단 네비 */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← 홈으로
          </Link>
          <div className="flex items-center gap-3">
          <ThemeToggle className="text-sm text-gray-500 hover:text-gray-700 transition-colors" />
          <Link
            href="/mypage"
            className="text-xs font-medium text-rose-600 hover:text-rose-700 transition-colors border border-rose-100 rounded-full px-3 py-1.5 bg-rose-50"
          >
            마이페이지
          </Link>
          </div>
        </div>

        {/* 헤더 */}
        <div className="text-center space-y-2">
          <span className="inline-flex items-center rounded-full bg-violet-100 text-violet-700 text-xs font-semibold px-3 py-1">
            크레딧 충전 요금
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">
            가격 안내
          </h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            AI 마케터는 <b>크레딧</b>으로, 게시물 AI 생성기는 월 정액으로
            이용합니다.
            <br />
            <span className="text-gray-400">(크레딧은 1원 = 1크레딧으로 충전됩니다)</span>
          </p>
        </div>

        {/* 서비스별 월 이용료 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {SERVICES.map((s) => (
            <div
              key={s.name}
              className="rounded-2xl border border-gray-200 p-5 bg-white shadow-sm flex items-center justify-between gap-2"
            >
              <span className="text-sm font-semibold text-gray-500">
                {s.name}
              </span>
              <span
                className={`text-lg font-extrabold tracking-tight rounded-full px-3 py-1 ${s.accentCls}`}
              >
                월 {comma(s.won)}원
              </span>
            </div>
          ))}
        </div>

        {/* 플랜 카드 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {PLANS.map((p) => (
            <div
              key={p.won}
              className={`rounded-2xl border p-5 bg-white shadow-sm flex flex-col gap-2 ${
                p.highlight
                  ? "border-violet-300 ring-1 ring-violet-200"
                  : "border-gray-200"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-500">
                  {p.man}만원 플랜
                </span>
                {p.highlight && (
                  <span className="text-[11px] font-bold text-violet-600 bg-violet-50 rounded-full px-2 py-0.5">
                    인기
                  </span>
                )}
              </div>
              <p className="text-2xl font-extrabold tracking-tight text-gray-900">
                {comma(p.won)}원
              </p>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-lg font-bold text-violet-600">
                  {comma(p.won)} 크레딧
                </span>
                <span className="text-xs text-gray-400">지급</span>
              </div>
            </div>
          ))}
        </div>

        {/* 사용 안내 */}
        <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-5 space-y-2">
          <p className="text-xs font-semibold text-violet-500">크레딧 사용 안내</p>
          <p className="text-base font-bold text-gray-900">
            AI 마케터 1명 30일 운영 기준{" "}
            <span className="text-violet-600">33만 크레딧</span> 차감
          </p>
          <p className="text-xs text-gray-500 leading-relaxed">
            충전한 크레딧에서 이용한 만큼 차감됩니다. 필요한 만큼 충전해 사용하실
            수 있습니다.
          </p>
        </div>
      </div>
    </div>
    </AppSurface>
  );
}
