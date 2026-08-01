import Link from "next/link";

export const metadata = {
  title: "가격 안내 · AI 인스타그램 마케터",
  description: "크레딧 충전 요금 안내",
};

const KAKAO_URL = "https://open.kakao.com/o/s0Viuxzi";

// 1원 = 1크레딧. 충전 금액만큼 크레딧이 지급됩니다.
const PLANS: Array<{ won: number; man: number; highlight?: boolean }> = [
  { won: 150000, man: 15 },
  { won: 300000, man: 30, highlight: true },
  { won: 600000, man: 60 },
  { won: 900000, man: 90 },
  { won: 1200000, man: 120 },
];

function comma(n: number): string {
  return n.toLocaleString("ko-KR");
}

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#f8f9fb] text-gray-900">
      <div className="max-w-3xl mx-auto px-4 py-8 sm:py-12 space-y-8">
        {/* 상단 네비 */}
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← 홈으로
          </Link>
          <Link
            href="/mypage"
            className="text-xs font-medium text-rose-600 hover:text-rose-700 transition-colors border border-rose-100 rounded-full px-3 py-1.5 bg-rose-50"
          >
            마이페이지
          </Link>
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
            서비스는 <b>크레딧</b>으로 이용합니다. 충전 금액만큼 크레딧이
            지급됩니다.
            <br />
            <span className="text-gray-400">(1원 = 1크레딧)</span>
          </p>
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
            AI 마케터 30일 운영 기준{" "}
            <span className="text-violet-600">30만 크레딧</span> 차감
          </p>
          <p className="text-xs text-gray-500 leading-relaxed">
            충전한 크레딧에서 이용한 만큼 차감됩니다. 필요한 만큼 충전해 사용하실
            수 있습니다.
          </p>
        </div>

        {/* 문의 CTA */}
        <div className="text-center space-y-3">
          <p className="text-sm text-gray-500">
            충전·결제나 요금이 궁금하시면 1:1로 문의해주세요.
          </p>
          <a
            href={KAKAO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-2xl bg-gradient-to-r from-violet-500 to-purple-500 text-white font-semibold px-6 py-3 shadow-sm hover:from-violet-600 hover:to-purple-600 transition-colors"
          >
            카카오톡으로 문의하기
          </a>
        </div>
      </div>
    </div>
  );
}
