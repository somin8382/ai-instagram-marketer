import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export const maxDuration = 60;

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_TIMEOUT_MS = 55_000;
// 분석·아트디렉션은 텍스트 모델, 로고·명함은 이미지 특화 모델.
// 이전 구현은 텍스트 모델이 SVG 코드를 직접 작성해 품질이 낮았다. 텍스트
// 모델은 좌표 공간 추론이 약해 도형 나열 수준을 벗어나지 못한다.
const TEXT_MODEL = "openai/gpt-4o-mini";
const IMAGE_MODEL = "google/gemini-3-pro-image-preview";

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

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function extractJson(raw: string): Record<string, unknown> | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseIdentity(raw: string): {
  colors: PaletteColor[];
  typography: Typography;
} | null {
  const parsed = extractJson(raw);
  if (!parsed || !Array.isArray(parsed.colors)) return null;
  const roles = new Set(["primary", "secondary", "accent", "neutral", "surface"]);
  const colors = (parsed.colors as unknown[])
    .filter(
      (c): c is PaletteColor =>
        typeof c === "object" &&
        c !== null &&
        isHex((c as PaletteColor).hex) &&
        typeof (c as PaletteColor).name === "string" &&
        roles.has((c as PaletteColor).role) &&
        typeof (c as PaletteColor).usage === "string"
    )
    .slice(0, 5);
  const typo = parsed.typography as Typography | undefined;
  if (
    colors.length !== 5 ||
    !typo ||
    typeof typo.display !== "string" ||
    typeof typo.body !== "string" ||
    typeof typo.register !== "string" ||
    typeof typo.rationale !== "string"
  ) {
    return null;
  }
  return { colors, typography: typo };
}

type OpenRouterMessage = {
  role: "system" | "user";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

async function callOpenRouter(payload: {
  model: string;
  messages: OpenRouterMessage[];
  modalities?: Array<"text" | "image">;
  image_config?: Record<string, string>;
}) {
  const apiKey = process.env.OPENROUTER_API_KEY!;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("[/api/brand] OpenRouter status:", res.status);
      return null;
    }
    return (await res.json()) as {
      choices?: Array<{
        message?: {
          content?: unknown;
          images?: Array<{ image_url?: { url?: string } } | string>;
        };
      }>;
    };
  } catch (error) {
    console.error("[/api/brand] OpenRouter call failed:", error);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractText(data: Awaited<ReturnType<typeof callOpenRouter>>) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) =>
        typeof item === "object" && item !== null && "text" in item
          ? String((item as { text?: unknown }).text ?? "")
          : ""
      )
      .join("");
  }
  return "";
}

function extractImage(data: Awaited<ReturnType<typeof callOpenRouter>>) {
  const images = data?.choices?.[0]?.message?.images;
  if (!Array.isArray(images)) return null;
  for (const image of images) {
    if (typeof image === "string" && image.length > 0) return image;
    if (
      typeof image === "object" &&
      image !== null &&
      typeof image.image_url?.url === "string"
    ) {
      return image.image_url.url;
    }
  }
  return null;
}

/** 응답이 원격 URL이면 data URI로 변환한다. 클라이언트가 canvas로 명함을
 * 합성·다운로드하므로 원본이 반드시 same-origin 안전(data URI)이어야 한다. */
async function toDataUri(value: string): Promise<string | null> {
  if (value.startsWith("data:image/")) return value;
  if (!/^https?:\/\//.test(value)) return null;
  try {
    const res = await fetch(value);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/png";
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > 8_000_000) return null;
    return `data:${type};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

// ── 프롬프트: 참고 스킬의 프레임워크를 단계별로 반영 ──
// brand-identity: 5색 역할 체계, AA 대비, 진부한 업종색 회피
// logo-design: 마크 아키텍처 / 타이포 레지스터 / 심볼 접근법 / 적용 맥락(16px,
//   단색 재현) / 절제 원칙(실루엣·스케치 가능성)
// brandkit: 콘셉트 방법(모노그램+의미, 은유 융합, 음수 공간, 구성 기하학),
//   "리서치와 환원에서 나온 마크" 품질 기준
// creative-brief: 생성 전 브랜드 분석이 선행되어야 한다는 순서

const IDENTITY_SYSTEM = `당신은 브랜드 아이덴티티 디렉터입니다. 브랜드 정보를 받아 컬러 시스템과 타이포그래피 방향을 JSON으로만 답합니다.

작업 순서 (내부적으로 수행):
1) 브랜드 분석: 카테고리, 고객, 감정적 약속, 문화적 위치를 한 줄씩 정리
2) 그 분석에 근거해 컬러와 타이포그래피 결정

컬러 규칙 (brand-identity 프레임워크):
- 정확히 5색: primary / secondary / accent / neutral(본문용 진한 중립) / surface(배경용 밝은 중립)
- neutral은 surface 위에서 WCAG AA(4.5:1) 이상
- 업종의 진부한 기본색(카페=갈색, 병원=파랑 등)을 피하고 무드를 우선
- name은 한국어 색 이름 2~5자, usage는 쓰임새 한 문장

타이포그래피 규칙 (logo-design의 타이포 레지스터):
- register: geometric sans / humanist sans / neo-grotesque sans / transitional serif / old-style serif / slab serif 중 브랜드에 맞는 하나
- display: 제목용 추천 서체 1개 (한글 지원 서체, 예: Pretendard, 지마켓 산스, 에스코어드림 등)
- body: 본문용 추천 서체 1개
- rationale: 이 조합이 브랜드에 맞는 이유 한 문장 (카테고리 기본값을 따랐는지, 의도적으로 벗어났는지 명시)

출력(JSON만):
{"colors":[{"hex":"#RRGGBB","name":"...","role":"primary","usage":"..."}],"typography":{"display":"...","body":"...","register":"...","rationale":"..."}}`;

const LOGO_BRIEF_SYSTEM = `당신은 로고 아트디렉터입니다. 브랜드 정보와 컬러, 지정된 콘셉트 방법을 받아, 이미지 생성 모델에 전달할 로고 디자인 브리프를 JSON으로만 답합니다.

logo-design 프레임워크로 결정하세요:
1) 마크 아키텍처: lockup(심볼+워드마크) / letterform-as-symbol / monogram 중 하나. 브랜드명이 묘사적이면 literal 심볼, 추상적이면 기하학적 환원.
2) 심볼 접근: literal / abstract gesture / geometric reduction / letterform-derived / monogram
3) 지정된 콘셉트 방법을 심볼 아이디어에 적용
4) 절제 원칙: 실루엣만으로 구분 가능, 7세 아이가 30초 보고 그릴 수 있는 단순함, 16px에서도 형태 유지, 단색 재현 가능

출력(JSON만):
{"concept":"심볼이 무엇을 어떻게 표현하는지 2문장","imagePrompt":"영어로 된 이미지 생성 프롬프트. 다음을 반드시 포함: flat vector logo design, 심볼 형태의 구체적 묘사(도형·구성·비율), 워드마크 처리 방식, 사용할 hex 색상, pure white background, no gradients, no shadows, no mockup, no photo, centered composition"}`;

const CARD_DESIGN_DIRECTIONS = [
  "왼쪽 세로 컬러 밴드와 넓은 여백의 클래식 구성",
  "상단 가로 밴드와 중앙 정렬 구성",
  "여백 중심의 미니멀 구성, 가는 컬러 라인 포인트",
  "강조색 배경을 과감하게 쓴 듀오톤 구성",
  "모서리 기하 패턴 포인트가 있는 구성",
];

const LOGO_CONCEPT_METHODS = [
  "Monogram + Meaning: 브랜드 이니셜에 은유를 결합",
  "Metaphor Fusion: 의미 있는 두 아이디어를 하나의 환원된 마크로 융합",
  "Negative Space: 음수 공간으로 숨은 형태를 만들어 지적인 인상",
  "Construction Geometry: 명확한 기하 체계에서 나온 구조적 마크",
  "Product Action: 브랜드의 핵심 행위를 심볼로 전환",
];

export async function POST(request: Request) {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("[/api/brand] Missing OPENROUTER_API_KEY");
    return Response.json({ error: "서비스 설정을 확인해주세요." }, { status: 500 });
  }

  let body: {
    step?: string;
    accessToken?: string;
    brandName?: string;
    industry?: string;
    mood?: string;
    palette?: unknown;
    typography?: Typography;
    accentHex?: string;
    logoImage?: string;
    variantSeed?: number;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const accessToken = String(body.accessToken ?? "").trim();
  if (!accessToken) {
    return Response.json({ error: "로그인 후 이용할 수 있습니다." }, { status: 401 });
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return Response.json({ error: "서비스 설정을 확인해주세요." }, { status: 500 });
  }
  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(accessToken);
  if (authError || !user) {
    return Response.json(
      { error: "로그인 정보가 만료되었습니다. 다시 로그인해주세요." },
      { status: 401 }
    );
  }

  const brandName = String(body.brandName ?? "").trim().slice(0, 40);
  const industry = String(body.industry ?? "").trim().slice(0, 60);
  const mood = String(body.mood ?? "").trim().slice(0, 120);
  if (!brandName) {
    return Response.json({ error: "브랜드 이름을 입력해주세요." }, { status: 400 });
  }
  const brandContext = `브랜드명: ${brandName}\n업종: ${industry || "미입력"}\n원하는 느낌: ${mood || "미입력"}`;

  // ── 1단계: 브랜드 분석 → 컬러 + 타이포그래피 ──
  if (body.step === "identity") {
    const data = await callOpenRouter({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: IDENTITY_SYSTEM },
        { role: "user", content: brandContext },
      ],
    });
    const identity = data ? parseIdentity(extractText(data)) : null;
    if (!identity) {
      return Response.json(
        { error: "생성에 실패했습니다. 잠시 후 다시 시도해주세요." },
        { status: 502 }
      );
    }
    return Response.json(identity);
  }

  const palette = Array.isArray(body.palette)
    ? (body.palette as PaletteColor[]).filter((c) => isHex(c?.hex))
    : [];
  const paletteDesc = palette
    .map((c) => `${c.role}: ${c.hex} (${c.name})`)
    .join(", ");
  const seed = Number.isFinite(body.variantSeed) ? Math.abs(Number(body.variantSeed)) : 0;

  // ── 2단계: 아트디렉션 브리프 → 이미지 모델로 로고 생성 ──
  if (body.step === "logo") {
    if (palette.length < 5) {
      return Response.json({ error: "브랜드 컬러를 먼저 생성해주세요." }, { status: 400 });
    }
    const method = LOGO_CONCEPT_METHODS[seed % LOGO_CONCEPT_METHODS.length];
    const typography = body.typography;

    const briefData = await callOpenRouter({
      model: TEXT_MODEL,
      messages: [
        { role: "system", content: LOGO_BRIEF_SYSTEM },
        {
          role: "user",
          content: `${brandContext}\n팔레트: ${paletteDesc}\n타이포 레지스터: ${typography?.register ?? "미지정"}\n콘셉트 방법: ${method}`,
        },
      ],
    });
    const brief = briefData ? extractJson(extractText(briefData)) : null;
    const imagePrompt =
      brief && typeof brief.imagePrompt === "string" ? brief.imagePrompt : null;
    const concept =
      brief && typeof brief.concept === "string" ? brief.concept : "";
    if (!imagePrompt) {
      return Response.json(
        { error: "로고 콘셉트 생성에 실패했습니다. 다시 시도해주세요." },
        { status: 502 }
      );
    }

    const imageData = await callOpenRouter({
      model: IMAGE_MODEL,
      messages: [
        {
          role: "user",
          content: `Professional flat vector logo on a pure white background.

${imagePrompt}

Hard requirements:
- Brand name in the wordmark must read exactly "${brandName}" with no spelling errors
- The brand name appears exactly ONCE. No tagline, no subtitle, no repeated or partial text anywhere else
- Flat solid colors only, use only these hex colors: ${palette.map((c) => c.hex).join(", ")}
- No gradients, no drop shadows, no 3D, no photo, no mockup, no background texture
- The mark must stay legible when scaled down to 16px (simple silhouette, bold shapes)
- Must work in single color reproduction
- Centered, generous margin around the logo`,
        },
      ],
      modalities: ["image", "text"],
      image_config: { aspect_ratio: "1:1", image_size: "1K" },
    });
    const rawImage = imageData ? extractImage(imageData) : null;
    const image = rawImage ? await toDataUri(rawImage) : null;
    if (!image) {
      return Response.json(
        { error: "로고 생성에 실패했습니다. 다시 시도해주세요." },
        { status: 502 }
      );
    }
    return Response.json({ image, concept });
  }

  // ── 3단계: 로고 이미지를 레퍼런스로 명함 디자인 생성 ──
  if (body.step === "card") {
    const logoImage = String(body.logoImage ?? "");
    if (!logoImage.startsWith("data:image/") || logoImage.length > 8_000_000) {
      return Response.json({ error: "로고를 먼저 생성해주세요." }, { status: 400 });
    }
    const accentHex = isHex(body.accentHex)
      ? body.accentHex
      : palette.find((c) => c.role === "primary")?.hex ?? "#333333";
    const surfaceHex = palette.find((c) => c.role === "surface")?.hex ?? "#ffffff";
    const direction = CARD_DESIGN_DIRECTIONS[seed % CARD_DESIGN_DIRECTIONS.length];

    // 연락처 텍스트는 이미지에 넣지 않는다. 이미지 모델의 글자 오타 위험을
    // 원천 차단하기 위해 텍스트 영역만 비워 받고, 클라이언트가 정확한
    // 텍스트를 오버레이한다 (미리보기 CSS, 다운로드 canvas 합성).
    const imageData = await callOpenRouter({
      model: IMAGE_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Design the FRONT of a premium business card (16:9 landscape).

Brand identity reference: the attached image is this brand's logo. Place this exact logo tastefully on the card (do not redraw or alter it).

Design direction: ${direction}

Color rules:
- Card base color: ${surfaceHex}
- Accent color: ${accentHex}
- You may also use: ${palette.map((c) => c.hex).join(", ")}
- Flat, printed look. No gradients, no photo textures, no mockup scene, no hands, no table. Render ONLY the flat card face filling the entire frame edge to edge.

Text rules (critical):
- Do NOT render any names, phone numbers, emails, or placeholder text
- The ONLY text allowed is whatever already exists inside the logo
- Keep the lower-left area (about 45% width, 35% height) visually quiet and clean so contact text can be overlaid there later`,
            },
            { type: "image_url", image_url: { url: logoImage } },
          ],
        },
      ],
      modalities: ["image", "text"],
      image_config: { aspect_ratio: "16:9", image_size: "1K" },
    });
    const rawImage = imageData ? extractImage(imageData) : null;
    const image = rawImage ? await toDataUri(rawImage) : null;
    if (!image) {
      return Response.json(
        { error: "명함 생성에 실패했습니다. 다시 시도해주세요." },
        { status: 502 }
      );
    }
    return Response.json({ image });
  }

  return Response.json({ error: "알 수 없는 요청입니다." }, { status: 400 });
}
