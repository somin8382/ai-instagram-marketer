import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

export const maxDuration = 60;

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_TIMEOUT_MS = 55_000;
const TEXT_MODEL = "openai/gpt-4o-mini";

// ── Brand identity generation (팔레트/로고), 명함은 클라이언트 합성 ──
//
// Palette rules follow the brand-identity skill: primary + secondary +
// neutral + surface + accent (5 roles, not a 30-color sprawl), each with a
// usage note, AA-contrast-aware. Logo rules follow svg-logo-designer: clean
// semantic SVG, viewBox only, defs-managed colors, legible at 16px,
// reproducible in single color.

type PaletteColor = {
  hex: string;
  name: string;
  role: "primary" | "secondary" | "accent" | "neutral" | "surface";
  usage: string;
};

function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function parsePalette(raw: string): PaletteColor[] | null {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as { colors?: unknown };
    if (!Array.isArray(parsed.colors)) return null;
    const roles = new Set(["primary", "secondary", "accent", "neutral", "surface"]);
    const colors = parsed.colors
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
    return colors.length === 5 ? colors : null;
  } catch {
    return null;
  }
}

// Strict allowlist-style validation: the SVG goes straight into customer
// downloads and inline previews, so anything script-shaped is rejected
// outright rather than stripped.
const SVG_FORBIDDEN =
  /<script|<foreignObject|<iframe|<embed|<object|<image|<video|<audio|\son[a-z]+\s*=|javascript:|data:text\/html|<!ENTITY|xlink:href|\shref\s*=/i;

function sanitizeLogoSvg(raw: string): string | null {
  const match = raw.match(/<svg[\s\S]*<\/svg>/i);
  if (!match) return null;
  let svg = match[0];
  svg = svg.replace(/<!--[\s\S]*?-->/g, "");
  if (svg.length > 20_000) return null;
  if (SVG_FORBIDDEN.test(svg)) return null;
  if (!/viewBox\s*=/.test(svg)) return null;
  // Force a deterministic root: strip width/height so CSS controls size.
  svg = svg.replace(
    /<svg([^>]*)>/i,
    (_, attrs: string) =>
      `<svg${attrs
        .replace(/\s(width|height)\s*=\s*"[^"]*"/gi, "")
        .replace(/\s(width|height)\s*=\s*'[^']*'/gi, "")}>`
  );
  return svg;
}

async function callTextModel(apiKey: string, system: string, user: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: TEXT_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error("[/api/brand] OpenRouter status:", res.status);
      return null;
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? null;
  } catch (error) {
    console.error("[/api/brand] OpenRouter call failed:", error);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

const PALETTE_SYSTEM = `당신은 브랜드 컬러 시스템 전문가입니다. 브랜드 정보를 받아 5색 팔레트를 JSON으로만 답합니다.

규칙 (brand-identity 프레임워크):
- 정확히 5색: primary(브랜드 대표색) 1, secondary(보조색) 1, accent(강조색) 1, neutral(본문 텍스트용 진한 중립색) 1, surface(배경용 아주 밝은 중립색) 1.
- neutral은 surface 위에서 WCAG AA(4.5:1) 이상 대비가 나야 합니다.
- primary는 흰 배경에서 버튼 텍스트가 읽히는 채도/명도로.
- 업종의 진부한 기본색(카페=갈색 등)을 피하고, 무드 키워드를 우선하세요.
- name은 한국어 색 이름(2~5자), usage는 "어디에 쓰는 색인지" 한 문장.

출력 형식(JSON만, 다른 텍스트 금지):
{"colors":[{"hex":"#RRGGBB","name":"...","role":"primary","usage":"..."}, ...]}`;

const LOGO_SYSTEM = `당신은 SVG 로고 디자이너입니다. 완성된 SVG 코드만 출력합니다 (마크다운 펜스, 설명 금지).

규칙 (svg-logo-designer):
- <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 80">로 시작하는 가로형 로고.
- 구조: <g id="icon">(심볼, 왼쪽 0~72 영역) + <g id="wordmark">(브랜드명 텍스트, 오른쪽).
- 심볼은 단순 기하 도형 2~4개의 조합. 16px로 줄여도 형태가 살아야 하므로 가는 선·복잡한 패스 금지.
- 단색 재현이 가능해야 하므로 그라데이션·필터·마스크 금지. fill만 사용.
- 색은 전달받은 팔레트의 hex만 사용 (primary를 심볼 주색으로, wordmark는 neutral).
- wordmark는 <text> 요소, font-family="system-ui, sans-serif", font-weight="700".
- <script>, <image>, href, 이벤트 속성 절대 금지.
- <title>브랜드명 로고</title> 포함.`;

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
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
    variantSeed?: number;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  // Signed-in only, same verification path as /api/ai.
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

  if (body.step === "palette") {
    const raw = await callTextModel(
      apiKey,
      PALETTE_SYSTEM,
      `브랜드명: ${brandName}\n업종: ${industry || "미입력"}\n원하는 느낌: ${mood || "미입력"}`
    );
    const colors = raw ? parsePalette(raw) : null;
    if (!colors) {
      return Response.json(
        { error: "컬러 생성에 실패했습니다. 잠시 후 다시 시도해주세요." },
        { status: 502 }
      );
    }
    return Response.json({ colors });
  }

  if (body.step === "logo") {
    const palette = Array.isArray(body.palette)
      ? (body.palette as PaletteColor[]).filter((c) => isHex(c?.hex))
      : [];
    if (palette.length < 3) {
      return Response.json({ error: "브랜드 컬러를 먼저 생성해주세요." }, { status: 400 });
    }
    const paletteDesc = palette
      .map((c) => `${c.role}: ${c.hex} (${c.name})`)
      .join(", ");
    const seed = Number.isFinite(body.variantSeed) ? Number(body.variantSeed) : 0;
    // The seed nudges the model toward a different concept on regeneration
    // while the palette stays fixed (logo regen must keep brand colors).
    const conceptHints = [
      "기하 도형의 겹침",
      "이니셜 모노그램",
      "업종을 은유하는 추상 심볼",
      "음수 공간(negative space) 활용",
      "회전 대칭 패턴",
    ];
    const hint = conceptHints[Math.abs(seed) % conceptHints.length];

    const raw = await callTextModel(
      apiKey,
      LOGO_SYSTEM,
      `브랜드명: ${brandName}\n업종: ${industry || "미입력"}\n느낌: ${mood || "미입력"}\n팔레트: ${paletteDesc}\n심볼 컨셉 방향: ${hint}`
    );
    const svg = raw ? sanitizeLogoSvg(raw) : null;
    if (!svg) {
      return Response.json(
        { error: "로고 생성에 실패했습니다. 다시 시도해주세요." },
        { status: 502 }
      );
    }
    return Response.json({ svg });
  }

  return Response.json({ error: "알 수 없는 요청입니다." }, { status: 400 });
}
