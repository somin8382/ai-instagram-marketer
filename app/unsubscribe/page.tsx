import Link from "next/link";

type SearchParams = { status?: string };

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { status } = await searchParams;

  const message =
    status === "ok"
      ? {
          title: "수신거부가 완료되었습니다",
          body: "앞으로 광고성 이메일을 보내지 않겠습니다. 이용에 불편을 드려 죄송합니다.",
          tone: "ok" as const,
        }
      : status === "invalid"
        ? {
            title: "잘못된 수신거부 링크입니다",
            body: "링크가 만료되었거나 올바르지 않습니다. 메일 하단의 링크를 다시 눌러주세요.",
            tone: "warn" as const,
          }
        : {
            title: "처리 중 오류가 발생했습니다",
            body: "잠시 후 다시 시도해주세요. 계속 문제가 되면 고객센터로 문의해주세요.",
            tone: "warn" as const,
          };

  return (
    <main className="min-h-screen bg-[#f8f9fb] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center space-y-3">
        <div
          className={`w-14 h-14 rounded-full mx-auto flex items-center justify-center text-2xl ${
            message.tone === "ok" ? "bg-green-50" : "bg-amber-50"
          }`}
        >
          {message.tone === "ok" ? "✓" : "!"}
        </div>
        <h1 className="text-xl font-bold text-gray-900">{message.title}</h1>
        <p className="text-sm text-gray-500 leading-relaxed">{message.body}</p>
        <Link
          href="/"
          className="inline-block mt-2 text-sm px-4 py-2 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          홈으로
        </Link>
      </div>
    </main>
  );
}
