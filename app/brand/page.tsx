"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowClockwise } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { DownloadSimple } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";

// ── 브랜드 아이덴티티 제작 ──
// 브랜드 분석 → 컬러+타이포 → 로고 콘셉트(아트디렉션) → 이미지 모델 로고 →
// 로고를 레퍼런스로 명함 디자인. 로고 재생성은 컬러·타이포를 유지하고 콘셉트
// 방법만 바꾸며, 명함 재생성은 선택 색과 로고를 유지하고 구성만 바꾼다.
// 연락처 텍스트는 이미지 모델에 맡기지 않고 클라이언트가 오버레이한다.

type PaletteColor = {
  hex: string;
  name: string;
  role: "primary" | "secondary" | "accent" | "neutral" | "surface";
  usage: string;
};

type Typography = {
  display: string;
  body: string;
  register: string;
  rationale: string;
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

async function dataUriToBlob(uri: string) {
  return await (await fetch(uri)).blob();
}

/**
 * 명함 최종 합성: 생성된 디자인 이미지 위에 연락처 텍스트를 정확한 위치에
 * 그린다. 좌하단 텍스트 존은 생성 프롬프트에서 비워두도록 지시한 영역이며,
 * 판독성 보장을 위해 반투명 패널을 깐다.
 */
async function composeCardPng(input: {
  cardImage: string;
  info: CardInfo;
  brandName: string;
  neutralHex: string;
}): Promise<Blob | null> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("card image load failed"));
    image.src = input.cardImage;
  });

  const W = 1600;
  const H = Math.round((W / image.width) * image.height);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, W, H);

  const name = input.info.personName.trim();
  const roleLine = [input.info.role.trim(), input.brandName.trim()]
    .filter(Boolean)
    .join(" · ");
  const contacts = [input.info.phone.trim(), input.info.email.trim()].filter(
    Boolean
  );
  const lines = [name, roleLine, ...contacts].filter(Boolean);
  if (lines.length > 0) {
    const x = W * 0.055;
    const panelTop = H * 0.62;
    const lineHeights = [64, 40, ...contacts.map(() => 38)];
    const totalTextHeight = lines.reduce(
      (sum, _, i) => sum + (lineHeights[i] ?? 38) + 10,
      0
    );
    const panelPad = 34;
    // 판독성 패널: 디자인이 지시를 어겨 텍스트 존에 그래픽을 넣었어도
    // 연락처가 항상 읽히도록 보장한다.
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.beginPath();
    ctx.roundRect(
      x - panelPad,
      panelTop - panelPad,
      W * 0.46,
      totalTextHeight + panelPad * 2,
      20
    );
    ctx.fill();

    let y = panelTop;
    lines.forEach((line, i) => {
      const size = i === 0 ? 52 : i === 1 ? 30 : 28;
      ctx.font = `${i === 0 ? "700" : "500"} ${size}px system-ui, -apple-system, sans-serif`;
      ctx.fillStyle = i === 1 ? input.neutralHex + "cc" : input.neutralHex;
      ctx.textBaseline = "top";
      ctx.fillText(line, x, y);
      y += (lineHeights[i] ?? 38) + 10;
    });
  }

  return await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png")
  );
}

export default function BrandIdentityPage() {
  const router = useRouter();

  const [brandName, setBrandName] = useState("");
  const [industry, setIndustry] = useState("");
  const [mood, setMood] = useState("");

  const [palette, setPalette] = useState<PaletteColor[] | null>(null);
  const [typography, setTypography] = useState<Typography | null>(null);
  const [selectedHex, setSelectedHex] = useState<string | null>(null);

  const [logoImage, setLogoImage] = useState<string | null>(null);
  const [logoConcept, setLogoConcept] = useState<string>("");
  const [logoSeed, setLogoSeed] = useState(0);

  const [cardImage, setCardImage] = useState<string | null>(null);
  const [cardSeed, setCardSeed] = useState(0);
  const [cardInfo, setCardInfo] = useState<CardInfo>({
    personName: "",
    role: "",
    phone: "",
    email: "",
  });

  const [busy, setBusy] = useState<"identity" | "logo" | "card" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const accentHex = useMemo(
    () =>
      selectedHex ?? palette?.find((c) => c.role === "primary")?.hex ?? null,
    [palette, selectedHex]
  );
  const neutralHex =
    palette?.find((c) => c.role === "neutral")?.hex ?? "#1f2430";

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
        | {
            error?: string;
            colors?: PaletteColor[];
            typography?: Typography;
            image?: string;
            concept?: string;
          }
        | null;
      if (!res.ok || !data) {
        setMessage(data?.error ?? "요청에 실패했습니다. 잠시 후 다시 시도해주세요.");
        return null;
      }
      return data;
    },
    [brandName, industry, mood, router]
  );

  async function generateIdentity() {
    if (!brandName.trim()) {
      setMessage("브랜드 이름을 입력해주세요.");
      return;
    }
    setBusy("identity");
    setMessage(null);
    const data = await callBrandApi({ step: "identity" });
    if (data?.colors && data.typography) {
      setPalette(data.colors);
      setTypography(data.typography);
      setSelectedHex(null);
      // 하위 산출물은 아이덴티티가 바뀌면 무효.
      setLogoImage(null);
      setLogoConcept("");
      setCardImage(null);
    }
    setBusy(null);
  }

  async function generateLogo() {
    if (!palette) return;
    setBusy("logo");
    setMessage(null);
    const seed = logoImage ? logoSeed + 1 : logoSeed;
    const data = await callBrandApi({
      step: "logo",
      palette,
      typography,
      variantSeed: seed,
    });
    if (data?.image) {
      setLogoImage(data.image);
      setLogoConcept(data.concept ?? "");
      setLogoSeed(seed);
      // 명함은 로고에 종속: 로고가 바뀌면 다시 만들어야 한다.
      setCardImage(null);
    }
    setBusy(null);
  }

  async function generateCard() {
    if (!palette || !logoImage) return;
    setBusy("card");
    setMessage(null);
    const seed = cardImage ? cardSeed + 1 : cardSeed;
    const data = await callBrandApi({
      step: "card",
      palette,
      accentHex,
      logoImage,
      variantSeed: seed,
    });
    if (data?.image) {
      setCardImage(data.image);
      setCardSeed(seed);
    }
    setBusy(null);
  }

  async function downloadLogo() {
    if (!logoImage) return;
    download(`${brandName || "brand"}-로고.png`, await dataUriToBlob(logoImage));
  }

  async function downloadCard() {
    if (!cardImage) return;
    const blob = await composeCardPng({
      cardImage,
      info: cardInfo,
      brandName,
      neutralHex,
    });
    if (blob) download(`${brandName || "brand"}-명함.png`, blob);
  }

  const overlayLines = useMemo(() => {
    const name = cardInfo.personName.trim();
    const roleLine = [cardInfo.role.trim(), brandName.trim()]
      .filter(Boolean)
      .join(" · ");
    const contacts = [cardInfo.phone.trim(), cardInfo.email.trim()].filter(
      Boolean
    );
    return { name, roleLine, contacts, any: Boolean(name || roleLine || contacts.length) };
  }, [cardInfo, brandName]);

  const inputCls =
    "w-full px-4 py-3 border border-gray-200 bg-white rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-300 transition-colors placeholder:text-gray-400";

  return (
    <main className="min-h-screen bg-[#f8f9fb] px-4 py-12">
      <div className="max-w-xl mx-auto space-y-10">
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
            브랜드를 분석해 컬러와 타이포그래피를 정하고, 그 위에서 로고를,
            로고를 기준으로 명함을 만듭니다. 각 단계는 따로 다시 만들 수
            있습니다.
          </p>
        </div>

        {/* STEP 1. 컬러 + 타이포그래피 */}
        <section className="p-6 rounded-2xl bg-white border-2 border-gray-100 space-y-4">
          <div className="flex items-center justify-between">
            <p className="font-bold text-gray-900">1. 브랜드 컬러 · 타이포그래피</p>
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
            onClick={generateIdentity}
            disabled={busy !== null}
            className="w-full py-3.5 rounded-xl font-semibold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99] transition-all"
          >
            {busy === "identity"
              ? "브랜드를 분석하고 있습니다..."
              : palette
                ? "컬러 · 타이포 다시 만들기"
                : "컬러 · 타이포 만들기"}
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
                    <span className="block h-14" style={{ background: color.hex }} />
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
              {typography && (
                <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-1">
                  <p className="text-xs font-semibold text-gray-500">
                    추천 타이포그래피
                  </p>
                  <p className="text-sm text-gray-900">
                    <span className="font-bold">{typography.display}</span>
                    <span className="text-gray-400"> (제목) · </span>
                    <span className="font-medium">{typography.body}</span>
                    <span className="text-gray-400"> (본문)</span>
                  </p>
                  <p className="text-xs text-gray-500 leading-relaxed">
                    {typography.rationale}
                  </p>
                </div>
              )}
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
            {logoImage && (
              <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">
                완료
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">
            아트디렉션을 거쳐 이미지 모델이 로고를 그립니다. 다시 만들면
            컬러는 유지되고 콘셉트가 바뀝니다.
          </p>

          {logoImage && (
            <div className="space-y-2">
              <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                <img src={logoImage} alt="생성된 로고" className="w-full h-auto" />
              </div>
              {logoConcept && (
                <p className="text-xs text-gray-500 leading-relaxed">
                  {logoConcept}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={generateLogo}
              disabled={busy !== null || !palette}
              className="flex-1 py-3.5 rounded-xl font-semibold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99] transition-all inline-flex items-center justify-center gap-2"
            >
              {busy === "logo" ? (
                "로고를 그리고 있습니다... (1~2분)"
              ) : logoImage ? (
                <>
                  <ArrowClockwise size={16} weight="bold" /> 다른 콘셉트로 다시
                </>
              ) : (
                "로고 만들기"
              )}
            </button>
            {logoImage && (
              <button
                onClick={downloadLogo}
                className="px-4 rounded-xl border-2 border-gray-100 text-gray-600 hover:border-emerald-300 hover:text-emerald-600 transition-all"
                title="PNG 다운로드"
              >
                <DownloadSimple size={18} weight="bold" />
              </button>
            )}
          </div>
        </section>

        {/* STEP 3. 명함 */}
        <section
          className={`p-6 rounded-2xl bg-white border-2 border-gray-100 space-y-4 ${
            logoImage ? "" : "opacity-50 pointer-events-none"
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="font-bold text-gray-900">3. 명함</p>
            {cardImage && (
              <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full">
                완료
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">
            로고와 선택한 강조색을 그대로 반영해 명함을 디자인합니다.
            이름·연락처는 이미지에 맡기지 않고 정확한 위치에 직접 얹습니다.
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
              onChange={(e) => setCardInfo((v) => ({ ...v, role: e.target.value }))}
              maxLength={20}
              placeholder="직함 (예: 대표)"
              className={inputCls}
            />
            <input
              value={cardInfo.phone}
              onChange={(e) => setCardInfo((v) => ({ ...v, phone: e.target.value }))}
              maxLength={20}
              placeholder="전화번호"
              className={inputCls}
            />
            <input
              value={cardInfo.email}
              onChange={(e) => setCardInfo((v) => ({ ...v, email: e.target.value }))}
              maxLength={40}
              placeholder="이메일"
              className={inputCls}
            />
          </div>

          {cardImage && (
            <div className="relative rounded-xl border border-gray-100 overflow-hidden shadow-sm">
              <img src={cardImage} alt="생성된 명함 디자인" className="w-full h-auto" />
              {overlayLines.any && (
                <div
                  className="absolute left-[5.5%] bottom-[8%] max-w-[46%] rounded-lg px-3 py-2.5"
                  style={{ background: "rgba(255,255,255,0.88)" }}
                >
                  {overlayLines.name && (
                    <p
                      className="text-base sm:text-lg font-bold leading-tight"
                      style={{ color: neutralHex }}
                    >
                      {overlayLines.name}
                    </p>
                  )}
                  {overlayLines.roleLine && (
                    <p
                      className="text-[11px] sm:text-xs font-medium mt-0.5"
                      style={{ color: neutralHex, opacity: 0.8 }}
                    >
                      {overlayLines.roleLine}
                    </p>
                  )}
                  {overlayLines.contacts.map((line) => (
                    <p
                      key={line}
                      className="text-[11px] sm:text-xs mt-0.5"
                      style={{ color: neutralHex }}
                    >
                      {line}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={generateCard}
              disabled={busy !== null || !logoImage}
              className="flex-1 py-3.5 rounded-xl font-semibold text-white bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99] transition-all inline-flex items-center justify-center gap-2"
            >
              {busy === "card" ? (
                "명함을 디자인하고 있습니다... (1~2분)"
              ) : cardImage ? (
                <>
                  <ArrowClockwise size={16} weight="bold" /> 다른 구성으로 다시
                </>
              ) : (
                "명함 만들기"
              )}
            </button>
            {cardImage && (
              <button
                onClick={downloadCard}
                className="px-4 rounded-xl border-2 border-gray-100 text-gray-600 hover:border-emerald-300 hover:text-emerald-600 transition-all"
                title="PNG 다운로드 (연락처 포함)"
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
