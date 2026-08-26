"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";
import { clearSignedInCookie } from "@/lib/ui/auth-cookie-sync";

/**
 * Signed-in home: the service hub. `/` (marketing) redirects customers here;
 * from here they pick a tool or open their dashboard. Deliberately light on
 * data - no snapshot fetch - so it renders instantly as a launcher.
 */
export default function HomeHubPage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    const supabase = getSupabaseBrowserClientOrNull();
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (!data.session) {
        // Not signed in (stale cookie or direct visit). Clear the hint first,
        // otherwise `/` would bounce straight back here forever.
        clearSignedInCookie();
        router.replace("/");
        return;
      }
      const meta = data.session.user.user_metadata as { name?: string } | null;
      setDisplayName(meta?.name || data.session.user.email || "");
    });
    return () => {
      active = false;
    };
  }, [router]);

  async function handleLogout() {
    const supabase = getSupabaseBrowserClientOrNull();
    if (supabase) {
      await supabase.auth.signOut();
    }
    router.push("/");
  }

  const services = [
    {
      icon: "🤖",
      iconCls: "from-rose-400 to-pink-500",
      hoverCls: "hover:border-rose-300",
      nameHoverCls: "group-hover:text-rose-600",
      name: "AI 마케터",
      desc: "계정 기획부터 콘텐츠 운영, 마케팅 전략까지 맡깁니다.",
      meta: "월 30만원부터",
      onClick: () => router.push("/?screen=apply"),
    },
    {
      icon: "✨",
      iconCls: "from-violet-400 to-purple-500",
      hoverCls: "hover:border-violet-300",
      nameHoverCls: "group-hover:text-violet-600",
      name: "게시물 AI 생성기",
      desc: "프롬프트를 넣으면 게시물 문구와 이미지가 함께 나옵니다.",
      meta: "월 2만원",
      onClick: () => router.push("/tools"),
    },
    {
      icon: "🧩",
      iconCls: "from-blue-400 to-sky-500",
      hoverCls: "hover:border-blue-300",
      nameHoverCls: "group-hover:text-blue-600",
      name: "랜딩페이지 개발 AI",
      desc: "한 문장으로 인스타 프로필에 걸 페이지 한 장을 만듭니다.",
      meta: "준비 중 · 사전 신청",
      onClick: () => router.push("/landing-ai"),
    },
  ];

  return (
    <main className="min-h-screen bg-[#f8f9fb] px-4 py-12">
      <div className="max-w-xl mx-auto space-y-10">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-bold tracking-tight text-gray-900">
            큐밋
          </span>
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/preview/home")}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              서비스 소개
            </button>
            <button
              onClick={handleLogout}
              className="text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
            >
              로그아웃
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">
            {displayName ? `${displayName}님, 안녕하세요` : "안녕하세요"}
          </h1>
          <p className="text-sm text-gray-500">
            이용하실 서비스를 선택하세요.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {services.map((service) => (
            <button
              key={service.name}
              onClick={service.onClick}
              className={`group text-left p-6 rounded-2xl bg-white border-2 border-gray-100 ${service.hoverCls} hover:shadow-lg active:scale-[0.99] transition-all`}
            >
              <div className="flex items-start gap-4">
                <div
                  className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${service.iconCls} flex items-center justify-center text-white text-xl flex-shrink-0`}
                >
                  {service.icon}
                </div>
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p
                      className={`font-bold text-gray-900 text-lg ${service.nameHoverCls} transition-colors`}
                    >
                      {service.name}
                    </p>
                    <span className="text-[10px] font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full whitespace-nowrap">
                      {service.meta}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">{service.desc}</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        <button
          onClick={() => router.push("/mypage")}
          className="w-full py-4 rounded-2xl bg-gray-900 text-white font-semibold hover:bg-gray-800 active:scale-[0.99] transition-all"
        >
          마이페이지 · 진행 상황과 결과 보기
        </button>
      </div>
    </main>
  );
}
