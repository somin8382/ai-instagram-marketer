"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowClockwise } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { DownloadSimple } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";

// ── 브랜드 아이덴티티 제작: 컬러 → 로고 → 명함 ──
// 컬러·로고는 /api/brand(LLM), 명함은 팔레트+로고를 재료로 한 클라이언트
// 합성이다. brand-identity 스킬의 일관성 원칙에 따라 로고 재생성은 팔레트를,
// 명함 재생성은 현재 선택 색과 로고를 그대로 유지한 채 레이아웃만 바꾼다.

type PaletteColor = {
  hex: string;
  name: string;
  role: "primary" | "secondary" | "accent" | "neutral" | "surface";
  usage: string;
};

type CardInfo = {
  personName: string;
  role: string;
  phone: string;
  email: string;
};

const ROLE_LABELS: Record<PaletteColor["role"], string> = {
  primary: "대표색",
  secondary: "보조색",
  accent: "강조색",
  neutral: "텍스트",
  surface: "배경",
};

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function svgBlob(svg: string) {
  return new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
}

/** SVG 문자열 → PNG Blob (2x). 외부 리소스가 없는 SVG만 들어온다. */
async function svgToPngBlob(svg: string, width: number, height: number) {
  const url = URL.createObjectURL(svgBlob(svg));
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("svg load failed"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas context");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 명함 SVG 합성 (90×54mm 비율, 1000×600).
 * variant 0: 좌측 컬러 밴드 / 1: 상단 밴드 + 중앙 정렬 / 2: 미니멀 라인.
 * 로고는 data URI <image>로 임베드해 별도 파일 없이 한 장으로 내려받는다.
 */
function composeCardSvg(input: {
  variant: number;
  accentHex: string;
  palette: PaletteColor[];
  logoSvg: string;
  brandName: string;
  info: CardInfo;
}) {
  const { variant, accentHex, palette, logoSvg, brandName, info } = input;
  const neutral = palette.find((c) => c.role === "neutral")?.hex ?? "#1f2430";
  const surface = palette.find((c) => c.role === "surface")?.hex ?? "#ffffff";
  const logoUri = `data:image/svg+xml;base64,${btoa(
    unescape(encodeURIComponent(logoSvg))
  )}`;
  const name = escapeXml(info.personName || "홍길동");
  const role = escapeXml(info.role || "대표");
  const phone = escapeXml(info.phone);
  const email = escapeXml(info.email);
  const brand = escapeXml(brandName);

  const contactLines = [phone, email].filter(Boolean);
  const contactText = (x: number, anchor: string, startY: number) =>
    contactLines
      .map(
        (line, i) =>
          `<text x="${x}" y="${startY + i * 34}" text-anchor="${anchor}" font-family="system-ui, sans-serif" font-size="24" fill="${neutral}" opacity="0.75">${line}</text>`
      )
      .join("");

  if (input.variant % 3 === 1) {
    // 상단 밴드 + 중앙 정렬
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600">
<rect width="1000" height="600" fill="${surface}"/>
<rect width="1000" height="120" fill="${accentHex}"/>
<image href="${logoUri}" x="330" y="170" width="340" height="113"/>
<text x="500" y="360" text-anchor="middle" font-family="system-ui, sans-serif" font-size="44" font-weight="700" fill="${neutral}">${name}</text>
<text x="500" y="404" text-anchor="middle" font-family="system-ui, sans-serif" font-size="26" fill="${accentHex}" font-weight="600">${role} · ${brand}</text>
${contactText(500, "middle", 470)}
</svg>`;
  }

  if (variant % 3 === 2) {
    // 미니멀 라인
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600">
<rect width="1000" height="600" fill="${surface}"/>
<image href="${logoUri}" x="80" y="80" width="300" height="100"/>
<line x1="80" y1="250" x2="920" y2="250" stroke="${accentHex}" stroke-width="4"/>
<text x="80" y="340" font-family="system-ui, sans-serif" font-size="46" font-weight="700" fill="${neutral}">${name}</text>
<text x="80" y="386" font-family="system-ui, sans-serif" font-size="26" fill="${neutral}" opacity="0.8">${role} · ${brand}</text>
${contactText(80, "start", 460)}
</svg>`;
  }

  // 기본: 좌측 컬러 밴드
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600">
<rect width="1000" height="600" fill="${surface}"/>
<rect width="24" height="600" fill="${accentHex}"/>
<image href="${logoUri}" x="90" y="90" width="320" height="107"/>
<text x="90" y="330" font-family="system-ui, sans-serif" font-size="46" font-weight="700" fill="${neutral}">${name}</text>
<text x="90" y="378" font-family="system-ui, sans-serif" font-size="26" fill="${accentHex}" font-weight="600">${role} · ${brand}</text>
${contactText(90, "start", 450)}
</svg>`;
}

export default function BrandIdentityPage() {
  const router = useRouter();

  const [brandName, setBrandName] = useState("");
  const [industry, setIndustry] = useState("");
  const [mood, setMood] = useState("");

  const [palette, setPalette] = useState<PaletteColor[] | null>(null);
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [logoSvg, setLogoSvg] = useState<string | null>(null);
  const [logoSeed, setLogoSeed] = useState(0);
  const [cardVariant, setCardVariant] = useState<number | null>(null);
  const [cardInfo, setCardInfo] = useState<CardInfo>({
    personName: "",
    role: "",
    phone: "",
    email: "",
  });

  const [busy, setBusy] = useState<"palette" | "logo" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const accentHex = useMemo(() => {
    if (selectedHex) return selectedHex;
    return palette?.find((c) => c.role === "primary")?.hex ?? null;
  }, [palette, selectedHex]);

  const callBrandApi = useCallback(
    async (payload: Record<string, unknown>) => {
      const supabase = getSupabaseBrowserClientOrNull();
      const session = supabase
        ? (await supabase.auth.getSession()).data.session
        : null;
      if (!session) {
        setMessage("로그인 후 이용할 수 있습니다.");
        router.push("/auth?tab=login");
        return null;
      }
      const res = await fetch("/api/brand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          accessToken: session.access_token,
          brandName,
          industry,
          mood,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string; colors?: PaletteColor[]; svg?: string }
        | null;
      if (!res.ok || !data) {
        setMessage(data?.error ?? "요청에 실패했습니다. 잠시 후 다시 시도해주세요.");
        return null;
      }
      return data;
    },
    [brandName, industry, mood, router]
  );

  async function generatePalette() {
    if (!brandName.trim()) {
      setMessage("브랜드 이름을 입력해주세요.");
      return;
    }
    setBusy("palette");
    setMessage(null);
    const data = await callBrandApi({ step: "palette" });
    if (data?.colors) {
      setPalette(data.colors);
      setSelectedHex(null);
      // 하위 산출물은 팔레트가 바뀌면 무효.
      setLogoSvg(null);
      setCardVariant(null);
    }
    setBusy(null);
  }

  async function generateLogo() {
    if (!palette) return;
    setBusy("logo");
    setMessage(null);
    const seed = logoSvg ? logoSeed + 1 : logoSeed;
    const data = await callBrandApi({ step: "logo", palette, variantSeed: seed });
    if (data?.svg) {
      setLogoSvg(data.svg);
      setLogoSeed(seed);
      setCardVariant((v) => (v === null ? null : v));
    }
    setBusy(null);
  }

  const cardSvg = useMemo(() => {
    if (cardVariant === null || !palette || !logoSvg || !accentHex) return null;
    return composeCardSvg({
      variant: cardVariant,
      accentHex,
      palette,
      logoSvg,
      brandName: brandName || "브랜드",
      info: cardInfo,
    });
  }, [cardVariant, palette, logoSvg, accentHex, brandName, cardInfo]);

  async function downloadCardPng() {
    if (!cardSvg) return;
    const blob = await svgToPngBlob(cardSvg, 1000, 600);
    if (blob) download(`${brandName || "brand"}-명함.png`, blob);
  }

  const inputCls =
    "w-full px-4 py-3 border border-gray-200 bg-white rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300 transition-colors placeholder:text-gray-400";

  return (
    <main className="min-h-screen bg-[#f8f9fb] px-4 py-12">
      <div className="max-w-xl mx-auto space-y-10">
        {/* 허브와 같은 헤더 문법 */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/home")}
              className="text-sm font-bold tracking-tight text-gray-900"
            >
              큐밋
            </button>
            <button
              onClick={() => router.push("/home")}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              ← 홈
            </button>
          </div>
          <button
            onClick={() => router.push("/mypage")}
            className="text-sm font-medium text-rose-600 hover:text-rose-700 transition-colors"
          >
            마이페이지
          </button>
        </div>

        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-600 text-xs font-semibold px-4 py-1.5 rounded-full border border-emerald-100">
            브랜드 아이덴티티
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-gray-900">
            컬러, 로고, 명함까지
            <br />한 번에 만듭니다
          </h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            브랜드 컬러를 먼저 정하고, 그 컬러로 로고를, 그 둘로 명함을
            만듭니다. 각 단계는 따로 다시 만들 수 있습니다.
          </p>
        </div>

        {/* STEP 1. 브랜드 컬러 */}
        <section className="p-6 rounded-2xl bg-white border-2 border-gray-100 space-y-4">
          <div className="flex items-center justify-between">
            <p className="font-bold text-gray-900">1. 브랜드 컬러</p>
            {palette && (
              <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">
                완료
              </span>
            )}
          </div>
          <input
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            maxLength={40}
            placeholder="브랜드 이름 (예: 온기제빵소)"
            className={inputCls}
          />
          <input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            maxLength={60}
            placeholder="업종 (예: 베이커리 카페)"
            className={inputCls}
          />
          <input
            value={mood}
            onChange={(e) => setMood(e.target.value)}
            maxLength={120}
            placeholder="원하는 느낌 (예: 따뜻하지만 세련된, 수제 감성)"
            className={inputCls}
          />
          <button
            onClick={generatePalette}
            disabled={busy !== null}
            className="w-full py-3.5 rounded-xl font-semibold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99] transition-all"
          >
            {busy === "palette"
              ? "컬러를 뽑고 있습니다..."
              : palette
                ? "브랜드 컬러 다시 만들기"
                : "브랜드 컬러 만들기"}
          </button>

          {palette && (
            <div className="space-y-3 pt-2">
              <p className="text-xs text-gray-500">
                색을 누르면 명함의 강조색으로 선택됩니다.
              </p>
              <div className="grid grid-cols-5 gap-2">
                {palette.map((color) => (
                  <button
                    key={color.hex}
                    onClick={() => setSelectedHex(color.hex)}
                    className={`rounded-xl overflow-hidden border-2 text-left transition-all ${
                      accentHex === color.hex
                        ? "border-gray-900 shadow-md"
                        : "border-transparent hover:border-gray-300"
                    }`}
                    title={color.usage}
                  >
                    <span
                      className="block h-14"
                      style={{ background: color.hex }}
                    />
                    <span className="block px-1.5 py-1 bg-white">
                      <span className="block text-[10px] font-semibold text-gray-700 truncate">
                        {color.name}
                      </span>
                      <span className="block text-[9px] text-gray-400">
                        {ROLE_LABELS[color.role]}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* STEP 2. 로고 */}
        <section
          className={`p-6 rounded-2xl bg-white border-2 border-gray-100 space-y-4 ${
            palette ? "" : "opacity-50 pointer-events-none"
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="font-bold text-gray-900">2. 로고</p>
            {logoSvg && (
              <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">
                완료
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">
            위 브랜드 컬러를 사용해 로고를 만듭니다. 다시 만들어도 컬러는
            유지됩니다.
          </p>

          {logoSvg && (
            <div
              className="rounded-xl border border-gray-100 bg-white p-6 [&_svg]:w-full [&_svg]:h-auto"
              dangerouslySetInnerHTML={{ __html: logoSvg }}
            />
          )}

          <div className="flex gap-2">
            <button
              onClick={generateLogo}
              disabled={busy !== null || !palette}
              className="flex-1 py-3.5 rounded-xl font-semibold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99] transition-all inline-flex items-center justify-center gap-2"
            >
              {busy === "logo" ? (
                "로고를 그리고 있습니다..."
              ) : logoSvg ? (
                <>
                  <ArrowClockwise size={16} weight="bold" /> 로고 다시 만들기
                </>
              ) : (
                "로고 만들기"
              )}
            </button>
            {logoSvg && (
              <button
                onClick={() =>
                  download(`${brandName || "brand"}-로고.svg`, svgBlob(logoSvg))
                }
                className="px-4 rounded-xl border-2 border-gray-100 text-gray-600 hover:border-emerald-300 hover:text-emerald-600 transition-all"
                title="SVG 다운로드"
              >
                <DownloadSimple size={18} weight="bold" />
              </button>
            )}
          </div>
        </section>

        {/* STEP 3. 명함 */}
        <section
          className={`p-6 rounded-2xl bg-white border-2 border-gray-100 space-y-4 ${
            logoSvg ? "" : "opacity-50 pointer-events-none"
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="font-bold text-gray-900">3. 명함</p>
            {cardSvg && (
              <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">
                완료
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">
            선택한 강조색과 로고로 명함을 만듭니다. 다시 만들면 배치만
            바뀝니다.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <input
              value={cardInfo.personName}
              onChange={(e) =>
                setCardInfo((v) => ({ ...v, personName: e.target.value }))
              }
              maxLength={20}
              placeholder="이름"
              className={inputCls}
            />
            <input
              value={cardInfo.role}
              onChange={(e) =>
                setCardInfo((v) => ({ ...v, role: e.target.value }))
              }
              maxLength={20}
              placeholder="직함 (예: 대표)"
              className={inputCls}
            />
            <input
              value={cardInfo.phone}
              onChange={(e) =>
                setCardInfo((v) => ({ ...v, phone: e.target.value }))
              }
              maxLength={20}
              placeholder="전화번호"
              className={inputCls}
            />
            <input
              value={cardInfo.email}
              onChange={(e) =>
                setCardInfo((v) => ({ ...v, email: e.target.value }))
              }
              maxLength={40}
              placeholder="이메일"
              className={inputCls}
            />
          </div>

          {cardSvg && (
            <div
              className="rounded-xl border border-gray-100 overflow-hidden shadow-sm [&_svg]:w-full [&_svg]:h-auto"
              dangerouslySetInnerHTML={{ __html: cardSvg }}
            />
          )}

          <div className="flex gap-2">
            <button
              onClick={() =>
                setCardVariant((v) => (v === null ? 0 : v + 1))
              }
              disabled={!logoSvg}
              className="flex-1 py-3.5 rounded-xl font-semibold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99] transition-all inline-flex items-center justify-center gap-2"
            >
              {cardSvg ? (
                <>
                  <ArrowClockwise size={16} weight="bold" /> 명함 다시 만들기
                </>
              ) : (
                "명함 만들기"
              )}
            </button>
            {cardSvg && (
              <button
                onClick={downloadCardPng}
                className="px-4 rounded-xl border-2 border-gray-100 text-gray-600 hover:border-emerald-300 hover:text-emerald-600 transition-all"
                title="PNG 다운로드"
              >
                <DownloadSimple size={18} weight="bold" />
              </button>
            )}
          </div>
        </section>

        <p
          aria-live="polite"
          className={`text-sm text-center ${message ? "text-rose-600" : "text-transparent"}`}
        >
          {message ?? "-"}
        </p>
      </div>
    </main>
  );
}
