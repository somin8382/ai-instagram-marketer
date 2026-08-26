"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowClockwise } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { DownloadSimple } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";
import { Card, SectionLabel } from "@/lib/ui/surface-card";
import { InputField, TextareaField } from "@/lib/ui/form-fields";
import { WorkspaceHeader } from "@/lib/ui/workspace-header";
import { getPrimaryActionButtonClass } from "@/lib/ui/form-feedback";

// ── 브랜드 아이덴티티 제작 ──
// UI/UX는 게시물 AI 생성기(app/tools)와 같은 부품을 그대로 가져다 쓴다:
// WorkspaceHeader, Card/SectionLabel, InputField/TextareaField(모두
// lib/ui에서 공유), 스텝별 상태 배지, 결과물 좌(이미지+다운로드)/우(재생성
// 패널) 2열 레이아웃, 버튼 내 인라인 스피너. 테마 색만 emerald.
//
// 흐름: 브랜드 분석 → 컬러+타이포 → 로고 콘셉트(아트디렉션) → 이미지 모델
// 로고 → 로고를 레퍼런스로 명함. 로고 재생성은 컬러·타이포를 유지하고
// 콘셉트만 바꾸며, 명함 재생성은 선택 색과 로고를 유지하고 구성만 바꾼다.
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

const MOOD_PRESETS = [
  "따뜻하고 편안한, 동네 단골 같은 느낌",
  "정갈하고 신뢰감 있는, 전문적인 느낌",
  "트렌디하고 감각적인, 20~30대 타깃",
  "고급스럽고 차분한, 프리미엄 느낌",
];

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

/** postgen 결과 카드의 "다시 생성" 서브패널과 같은 문법: 회색 박스 + 헤더
 * 줄(라벨/보조설명) + 버튼. */
function RegeneratePanel({
  label,
  note,
  busy,
  busyLabel,
  idleLabel,
  onClick,
  disabled,
}: {
  label: string;
  note: string;
  busy: boolean;
  busyLabel: string;
  idleLabel: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2 border border-gray-100 rounded-xl p-3 bg-gray-50">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-700">{label}</span>
        <span className="text-xs text-gray-400">{note}</span>
      </div>
      <button
        disabled={busy || disabled}
        onClick={onClick}
        className="w-full text-xs py-1.5 rounded-lg font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors inline-flex items-center justify-center gap-1.5"
      >
        {busy ? (
          <>
            <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            {busyLabel}
          </>
        ) : (
          <>
            <ArrowClockwise size={12} weight="bold" />
            {idleLabel}
          </>
        )}
      </button>
    </div>
  );
}

export default function BrandIdentityPage() {
  const router = useRouter();

  const [brandName, setBrandName] = useState("");
  const [industry, setIndustry] = useState("");
  const [mood, setMood] = useState("");
  const [colorHint, setColorHint] = useState("");

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

  const stepIndex = cardImage ? 3 : logoImage ? 2 : palette ? 1 : 0;

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
          colorHint,
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
    [brandName, industry, mood, colorHint, router]
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
    return {
      name,
      roleLine,
      contacts,
      any: Boolean(name || roleLine || contacts.length),
    };
  }, [cardInfo, brandName]);

  return (
    <main className="min-h-screen bg-[#f8f9fb] px-4 py-12">
      <div className="max-w-2xl mx-auto space-y-4">
        <WorkspaceHeader
          onBack={() => router.push("/home")}
          onHome={() => router.push("/home")}
          onMyPage={() => router.push("/mypage")}
          progress={{ current: stepIndex, total: 3 }}
          progressLabel="아이덴티티 제작 단계"
          progressBarClassName="bg-gradient-to-r from-emerald-500 to-teal-500"
        />

        <div className="space-y-2 px-1">
          <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-600 text-xs font-semibold px-4 py-1.5 rounded-full border border-emerald-100">
            브랜드 아이덴티티
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
            컬러, 로고, 명함까지 한 번에
          </h1>
          <p className="text-sm text-gray-500 leading-relaxed">
            브랜드를 분석해 컬러와 타이포그래피를 정하고, 그 위에서 로고를,
            로고를 기준으로 명함을 만듭니다. 각 단계는 따로 다시 만들 수
            있습니다.
          </p>
        </div>

        {/* STEP 1. 컬러 + 타이포그래피 */}
        <Card className="space-y-5">
          <div className="flex items-center justify-between">
            <SectionLabel>1. 브랜드 컬러 · 타이포그래피</SectionLabel>
            {palette && (
              <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">
                완료
              </span>
            )}
          </div>

          <InputField
            label="브랜드 이름"
            value={brandName}
            onChange={setBrandName}
            placeholder="예: 온기제빵소"
            theme="emerald"
          />
          <InputField
            label="업종"
            value={industry}
            onChange={setIndustry}
            placeholder="예: 베이커리 카페"
            theme="emerald"
          />

          <div className="space-y-2">
            <TextareaField
              label="원하는 느낌"
              value={mood}
              onChange={setMood}
              placeholder="예: 따뜻하지만 세련된, 수제 감성"
              rows={2}
              theme="emerald"
            />
            <div className="grid grid-cols-1 gap-2">
              {MOOD_PRESETS.map((preset) => {
                const isSelected = mood.trim() === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setMood(preset)}
                    className={`text-left rounded-xl border px-4 py-2.5 transition-all ${
                      isSelected
                        ? "border-emerald-400 bg-emerald-50 shadow-sm"
                        : "border-gray-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/40"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p
                        className={`text-sm leading-relaxed ${
                          isSelected
                            ? "text-emerald-700 font-medium"
                            : "text-gray-700"
                        }`}
                      >
                        {preset}
                      </p>
                      <span
                        className={`text-[10px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${
                          isSelected
                            ? "bg-emerald-100 text-emerald-600"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {isSelected ? "선택됨" : "빠른 선택"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <InputField
            label="메인 컬러 (선택)"
            value={colorHint}
            onChange={setColorHint}
            placeholder="예: 깊은 남색 / #1B3A6B · 비워두면 알아서 제안"
            theme="emerald"
          />

          <button
            onClick={generateIdentity}
            disabled={busy !== null}
            aria-disabled={busy !== null}
            className={`${getPrimaryActionButtonClass({
              theme: "emerald",
              isInactive: busy !== null,
            })} py-3`}
          >
            {busy === "identity" ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                브랜드를 분석하고 있습니다...
              </span>
            ) : palette ? (
              "컬러 · 타이포 다시 만들기"
            ) : (
              "컬러 · 타이포 만들기"
            )}
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
        </Card>

        {/* STEP 2. 로고 */}
        <Card
          className={`space-y-4 ${palette ? "" : "opacity-50 pointer-events-none"}`}
        >
          <div className="flex items-center justify-between">
            <SectionLabel>2. 로고</SectionLabel>
            {logoImage && (
              <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">
                완료
              </span>
            )}
          </div>

          {!logoImage ? (
            <>
              <p className="text-sm text-gray-500 leading-relaxed">
                아트디렉션을 거쳐 이미지 생성 모델이 로고를 그립니다. 위 브랜드
                컬러를 그대로 사용합니다.
              </p>
              <button
                onClick={generateLogo}
                disabled={busy !== null || !palette}
                aria-disabled={busy !== null || !palette}
                className={`${getPrimaryActionButtonClass({
                  theme: "emerald",
                  isInactive: busy !== null || !palette,
                })} py-3`}
              >
                {busy === "logo" ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    로고를 그리고 있습니다...
                  </span>
                ) : (
                  "로고 만들기"
                )}
              </button>
            </>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-[260px,1fr] gap-4 items-start">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900">로고</p>
                  <button
                    onClick={downloadLogo}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                  >
                    <DownloadSimple size={14} weight="bold" />
                    다운로드
                  </button>
                </div>
                <div className="relative max-w-[260px] w-full rounded-xl overflow-hidden border border-gray-100 aspect-square bg-white mx-auto md:mx-0 shadow-sm">
                  <img
                    src={logoImage}
                    alt="생성된 로고"
                    className="absolute inset-0 w-full h-full object-contain p-3"
                  />
                </div>
              </div>
              <div className="space-y-3">
                {logoConcept && (
                  <div className="p-3 bg-gray-50 rounded-xl">
                    <p className="text-xs text-gray-600 leading-relaxed">
                      {logoConcept}
                    </p>
                  </div>
                )}
                <RegeneratePanel
                  label="다른 콘셉트로 다시"
                  note="컬러 유지"
                  busy={busy === "logo"}
                  busyLabel="그리는 중…"
                  idleLabel="로고 다시 만들기"
                  onClick={generateLogo}
                  disabled={!palette}
                />
              </div>
            </div>
          )}
        </Card>

        {/* STEP 3. 명함 */}
        <Card
          className={`space-y-4 ${logoImage ? "" : "opacity-50 pointer-events-none"}`}
        >
          <div className="flex items-center justify-between">
            <SectionLabel>3. 명함</SectionLabel>
            {cardImage && (
              <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">
                완료
              </span>
            )}
          </div>

          <p className="text-sm text-gray-500 leading-relaxed">
            로고와 선택한 강조색을 그대로 반영해 명함을 디자인합니다. 이름과
            연락처는 이미지에 맡기지 않고 정확한 위치에 직접 얹습니다.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <InputField
              label="이름"
              value={cardInfo.personName}
              onChange={(v) => setCardInfo((s) => ({ ...s, personName: v }))}
              placeholder="이름"
              theme="emerald"
            />
            <InputField
              label="직함"
              value={cardInfo.role}
              onChange={(v) => setCardInfo((s) => ({ ...s, role: v }))}
              placeholder="예: 대표"
              theme="emerald"
            />
            <InputField
              label="전화번호"
              value={cardInfo.phone}
              onChange={(v) => setCardInfo((s) => ({ ...s, phone: v }))}
              placeholder="전화번호"
              theme="emerald"
            />
            <InputField
              label="이메일"
              value={cardInfo.email}
              onChange={(v) => setCardInfo((s) => ({ ...s, email: v }))}
              placeholder="이메일"
              theme="emerald"
            />
          </div>

          {!cardImage ? (
            <button
              onClick={generateCard}
              disabled={busy !== null || !logoImage}
              aria-disabled={busy !== null || !logoImage}
              className={`${getPrimaryActionButtonClass({
                theme: "emerald",
                isInactive: busy !== null || !logoImage,
              })} py-3`}
            >
              {busy === "card" ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  명함을 디자인하고 있습니다...
                </span>
              ) : (
                "명함 만들기"
              )}
            </button>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-[300px,1fr] gap-4 items-start">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900">명함</p>
                  <button
                    onClick={downloadCard}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                  >
                    <DownloadSimple size={14} weight="bold" />
                    다운로드
                  </button>
                </div>
                <div className="relative w-full rounded-xl overflow-hidden border border-gray-100 shadow-sm">
                  <img
                    src={cardImage}
                    alt="생성된 명함 디자인"
                    className="w-full h-auto"
                  />
                  {overlayLines.any && (
                    <div
                      className="absolute left-[5.5%] bottom-[8%] max-w-[46%] rounded-lg px-3 py-2.5"
                      style={{ background: "rgba(255,255,255,0.88)" }}
                    >
                      {overlayLines.name && (
                        <p
                          className="text-sm font-bold leading-tight"
                          style={{ color: neutralHex }}
                        >
                          {overlayLines.name}
                        </p>
                      )}
                      {overlayLines.roleLine && (
                        <p
                          className="text-[10px] font-medium mt-0.5"
                          style={{ color: neutralHex, opacity: 0.8 }}
                        >
                          {overlayLines.roleLine}
                        </p>
                      )}
                      {overlayLines.contacts.map((line) => (
                        <p
                          key={line}
                          className="text-[10px] mt-0.5"
                          style={{ color: neutralHex }}
                        >
                          {line}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <RegeneratePanel
                label="다른 구성으로 다시"
                note="로고 · 강조색 유지"
                busy={busy === "card"}
                busyLabel="디자인 중…"
                idleLabel="명함 다시 만들기"
                onClick={generateCard}
                disabled={!logoImage}
              />
            </div>
          )}
        </Card>

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
