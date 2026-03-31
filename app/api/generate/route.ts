export async function POST(request: Request) {
  let industry = "";
  let productService = "";
  let requestId = "";
  let previousResult: unknown = null;

  try {
    const body = await request.json();
    industry = String(body?.industry ?? "").trim();
    productService = String(body?.productService ?? "").trim();
    requestId = String(body?.requestId ?? "").trim();
    previousResult = body?.previousResult ?? null;
  } catch {
    return Response.json({ error: "요청 본문(JSON)이 올바르지 않습니다." }, { status: 400 });
  }

  if (!industry || !productService) {
    return Response.json(
      { error: "업종과 상품/서비스를 모두 입력해주세요." },
      { status: 400 }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("[/api/generate] Missing GEMINI_API_KEY");
    return Response.json(
      { error: "서버 환경변수 GEMINI_API_KEY가 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  const previousNames = Array.isArray((previousResult as { accountNames?: unknown[] } | null)?.accountNames)
    ? ((previousResult as { accountNames?: Array<{ name?: unknown }> }).accountNames ?? [])
        .map((item) => String(item?.name ?? ""))
        .filter(Boolean)
        .join(", ")
    : "";
  const previousPlan = (previousResult as { accountPlan?: { direction?: unknown; bio?: unknown; concept?: unknown } } | null)?.accountPlan;

  const prompt = `
당신은 한국의 인스타그램 마케팅 전문가입니다.
아래 비즈니스 정보를 바탕으로 인스타그램 계정 기획을 해주세요.

업종: ${industry}
판매하는 상품/서비스: ${productService}

중요 규칙:
- accountNames의 name은 반드시 영문 소문자만 사용, 공백 없이, 짧고 브랜드감 있게
- 업종을 직접적으로 포함하지 마세요. 창의적이고 기억하기 쉬운 이름으로
- 예시: brightnote, flowspace, sparkhub, velvetink, moonpetal
- meaning은 왜 이 이름을 추천하는지 한국어로 짧게 설명 (1문장)
- accountPlan의 모든 내용은 한국어, 이 비즈니스에 맞는 구체적 내용이어야 합니다
- bio는 인스타그램 소개란에 들어갈 2줄 매력적인 문구 (이모지 포함)
- 매번 완전히 새로운 결과를 생성하세요. 이전 결과를 반복하지 마세요.
- accountNames는 반드시 서로 달라야 하며, 정확히 3개만 제안하세요.
- generation_id(${requestId || "none"})를 참고해 이전 응답과 다른 표현을 사용하세요.

다음 JSON 형식으로만 답변하세요. 설명 없이 JSON만 출력하세요:
{
  "accountNames": [
    { "name": "영문아이디1", "meaning": "추천 이유 한국어 설명" },
    { "name": "영문아이디2", "meaning": "추천 이유 한국어 설명" },
    { "name": "영문아이디3", "meaning": "추천 이유 한국어 설명" }
  ],
  "accountPlan": {
    "direction": "추천 계정 방향 (구체적으로 2~3문장)",
    "bio": "소개글 2줄 (이모지 포함, 줄바꿈은 \\n으로)",
    "concept": "운영 컨셉 (구체적으로 2~3문장)"
  }
}
`;
  const previousSummary =
    previousNames || previousPlan
      ? `
이전 생성 결과(절대 반복 금지):
- 이전 계정명: ${previousNames || "없음"}
- 이전 방향: ${String(previousPlan?.direction ?? "없음")}
- 이전 소개글: ${String(previousPlan?.bio ?? "없음")}
- 이전 컨셉: ${String(previousPlan?.concept ?? "없음")}
`
      : "";

  try {
    console.log("[/api/generate] Calling Gemini API...");
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${prompt}\n${previousSummary}` }] }],
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("[/api/generate] Gemini API error:", res.status, errText);
      return Response.json(
        {
          error: `Gemini API 호출 실패 (${res.status})`,
          details: errText,
          source: "fallback",
        },
        { status: 502 }
      );
    }

    const data = await res.json();
    const text: string =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[/api/generate] No JSON found in response:", text);
      throw new Error("JSON not found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      accountNames?: Array<{ name?: string; meaning?: string }>;
      accountPlan?: { direction?: string; bio?: string; concept?: string };
    };

    const accountNames = parsed.accountNames ?? [];
    const isThreeNames = accountNames.length === 3;
    const allEnglishLower = accountNames.every((item) =>
      /^[a-z]+$/.test(String(item.name ?? ""))
    );
    const allDifferent = new Set(accountNames.map((item) => item.name)).size === 3;
    const hasKoreanMeaning = accountNames.every((item) =>
      /[가-힣]/.test(String(item.meaning ?? ""))
    );
    const hasPlan =
      !!parsed.accountPlan?.direction?.trim() &&
      !!parsed.accountPlan?.bio?.trim() &&
      !!parsed.accountPlan?.concept?.trim();

    if (!isThreeNames || !allEnglishLower || !allDifferent || !hasKoreanMeaning || !hasPlan) {
      console.error("[/api/generate] Validation failed:", parsed);
      return Response.json(
        { error: "Gemini 응답 형식 검증에 실패했습니다.", source: "fallback" },
        { status: 502 }
      );
    }

    console.log("[/api/generate] Success — returned API result");
    return Response.json({ ...parsed, source: "api" });
  } catch (err) {
    console.error("[/api/generate] Failed with no fallback:", err);
    return Response.json(
      { error: "AI 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.", source: "fallback" },
      { status: 500 }
    );
  }
}
