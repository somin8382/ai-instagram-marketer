"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { Megaphone } from "@phosphor-icons/react/dist/csr/Megaphone";
import { MagicWand } from "@phosphor-icons/react/dist/csr/MagicWand";
import { Browser } from "@phosphor-icons/react/dist/csr/Browser";
import { Palette } from "@phosphor-icons/react/dist/csr/Palette";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";
import { clearSignedInCookie } from "@/lib/ui/auth-cookie-sync";
import { AppSurface, ThemeToggle } from "@/lib/ui/theme";

// 아직 공개하지 않는 서비스. 카드 정의는 그대로 두고 노출만 막는다 -
// 다시 열 때는 hidden 을 지우면 된다.
const HIDDEN_SERVICES = new Set(["브랜드 아이덴티티", "랜딩페이지 개발 AI"]);

const AUTH_STORAGE_KEY = "qmeet-auth-state";

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
    // Cookie first, synchronously: the landing guard reads it, so leaving it
    // until onAuthStateChange fires would bounce `/` right back here.
    clearSignedInCookie();
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
    const supabase = getSupabaseBrowserClientOrNull();
    if (supabase) {
      await supabase.auth.signOut();
    }
    router.push("/");
  }

  const services = [
    {
      Icon: Megaphone,
      chipCls: "bg-rose-50 text-rose-500",
      hoverCls: "hover:border-rose-300",
      nameHoverCls: "group-hover:text-rose-600",
      name: "AI 마케터",
      desc: "계정 기획부터 콘텐츠 운영, 마케팅 전략까지 맡깁니다.",
      meta: "월 33만원부터",
      onClick: () => router.push("/?screen=apply"),
    },
    {
      Icon: MagicWand,
      chipCls: "bg-violet-50 text-violet-500",
      hoverCls: "hover:border-violet-300",
      nameHoverCls: "group-hover:text-violet-600",
      name: "게시물 AI 생성기",
      desc: "프롬프트를 넣으면 게시물 문구와 이미지가 함께 나옵니다.",
      meta: "월 2만 2천원",
      onClick: () => router.push("/tools"),
    },
    {
      Icon: Palette,
      chipCls: "bg-emerald-50 text-emerald-500",
      hoverCls: "hover:border-emerald-300",
      nameHoverCls: "group-hover:text-emerald-600",
      name: "브랜드 아이덴티티",
      desc: "브랜드 컬러, 로고, 명함을 순서대로 만들어 드립니다.",
      meta: "베타",
      onClick: () => router.push("/brand"),
    },
    {
      Icon: Browser,
      chipCls: "bg-blue-50 text-blue-500",
      hoverCls: "hover:border-blue-300",
      nameHoverCls: "group-hover:text-blue-600",
      name: "랜딩페이지 개발 AI",
      desc: "한 문장으로 인스타 프로필에 걸 페이지 한 장을 만듭니다.",
      meta: "준비 중",
      onClick: () => router.push("/landing-ai"),
    },
  ];

  return (
    <AppSurface>
    <main className="relative min-h-screen px-4 py-12">
      <div className="max-w-xl mx-auto space-y-10">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-bold tracking-tight text-gray-900">
            큐밋
          </span>
          <div className="flex items-center gap-4">
            <ThemeToggle className="text-sm text-gray-500 hover:text-gray-700 transition-colors" />
            <button
              onClick={() => router.push("/preview/home")}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              서비스 소개
            </button>
            <button
              onClick={() => router.push("/pricing")}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              가격 안내
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
          <p className="text-sm text-gray-500">이용하실 서비스를 선택하세요.</p>
        </div>

        <div className="grid grid-cols-1 gap-3">
          {services
            .filter((service) => !HIDDEN_SERVICES.has(service.name))
            .map((service) => (
            <button
              key={service.name}
              onClick={service.onClick}
              className={`group text-left p-5 rounded-2xl bg-white border-2 border-gray-100 ${service.hoverCls} hover:shadow-lg active:scale-[0.99] transition-all`}
            >
              <div className="flex items-start gap-4">
                <div
                  className={`w-11 h-11 rounded-xl ${service.chipCls} flex items-center justify-center flex-shrink-0`}
                >
                  <service.Icon size={22} weight="duotone" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={`font-bold text-gray-900 text-lg ${service.nameHoverCls} transition-colors`}
                    >
                      {service.name}
                    </p>
                    <span className="text-[11px] font-semibold text-gray-400 whitespace-nowrap">
                      {service.meta}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 flex items-center justify-between gap-2">
                    {service.desc}
                    <ArrowRight
                      size={16}
                      weight="bold"
                      className="shrink-0 text-gray-300 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all"
                    />
                  </p>
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
    </AppSurface>
  );
}
