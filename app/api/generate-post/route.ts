export async function POST(request: Request) {
  let image = "";
  let industry = "";
  let productService = "";
  let requestId = "";
  let previousPost: unknown = null;

  try {
    const body = await request.json();
    image = String(body?.image ?? "");
    industry = String(body?.industry ?? "").trim();
    productService = String(body?.productService ?? "").trim();
    requestId = String(body?.requestId ?? "").trim();
    previousPost = body?.previousPost ?? null;
  } catch {
    return Response.json({ error: "요청 본문(JSON)이 올바르지 않습니다." }, { status: 400 });
  }

  if (!image || !industry || !productService) {
    return Response.json(
      { error: "이미지, 업종, 상품/서비스를 모두 입력해주세요." },
      { status: 400 }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("[/api/generate-post] Missing GEMINI_API_KEY");
    return Response.json(
      { error: "서버 환경변수 GEMINI_API_KEY가 설정되지 않았습니다." },
      { status: 500 }
    );
  }

  const prompt = `
당신은 한국의 인스타그램 마케팅 전문가입니다.
아래 이미지를 보고 인스타그램 게시물을 작성해 주세요.

업종: ${industry}
상품/서비스: ${productService}

중요 규칙:
- 이미지의 내용을 반영한 구체적인 게시물을 작성하세요
- 일반적인 템플릿 문구가 아닌, 이미지에 맞는 맞춤 내용이어야 합니다
- 매번 완전히 새로운 결과를 생성하세요
- 업종(${industry})과 상품/서비스(${productService}) 맥락이 반드시 드러나야 합니다
- generation_id(${requestId || "none"})를 참고해 이전 결과와 다른 문구를 작성하세요

다음 JSON 형식으로만 답변하세요. 설명 없이 JSON만 출력하세요:
{
  "topic": "게시물 주제 (한 줄)",
  "content": "게시물 본문 (3~5문장, 자연스러운 한국어, 이모지 포함)",
  "hashtags": "#해시태그1 #해시태그2 #해시태그3 #해시태그4 #해시태그5"
}
`;
  const previousSummary =
    previousPost && typeof previousPost === "object"
      ? `
이전 생성 결과(절대 반복 금지):
- 주제: ${String((previousPost as { topic?: unknown }).topic ?? "없음")}
- 본문: ${String((previousPost as { content?: unknown }).content ?? "없음")}
- 해시태그: ${String((previousPost as { hashtags?: unknown }).hashtags ?? "없음")}
`
      : "";

  try {
    console.log("[/api/generate-post] Calling Gemini API...");

    // Extract base64 data and mime type from data URL
    const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: prompt },
    ];

    if (match) {
      parts.push({
        inlineData: {
          mimeType: match[1],
          data: match[2],
        },
      });
      console.log("[/api/generate-post] Image attached, mimeType:", match[1]);
    } else {
      console.error("[/api/generate-post] Invalid image data URL");
      return Response.json(
        { error: "업로드한 이미지 형식을 인식할 수 없습니다." },
        { status: 400 }
      );
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${prompt}\n${previousSummary}` }, ...parts.slice(1)] }],
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("[/api/generate-post] Gemini API error:", res.status, errText);
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
      console.error("[/api/generate-post] No JSON found in response:", text);
      throw new Error("JSON not found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      topic?: string;
      content?: string;
      hashtags?: string;
    };

    const topic = String(parsed.topic ?? "").trim();
    const content = String(parsed.content ?? "").trim();
    const hashtags = String(parsed.hashtags ?? "").trim();
    const includesBusinessContext =
      topic.includes(industry) ||
      topic.includes(productService) ||
      content.includes(industry) ||
      content.includes(productService) ||
      hashtags.includes(industry) ||
      hashtags.includes(productService);
    const hasEnoughHashtags = hashtags.split(/\s+/).filter((tag) => tag.startsWith("#")).length >= 5;

    if (!topic || !content || !hashtags || !includesBusinessContext || !hasEnoughHashtags) {
      console.error("[/api/generate-post] Validation failed:", parsed);
      return Response.json(
        { error: "Gemini 응답 형식 검증에 실패했습니다.", source: "fallback" },
        { status: 502 }
      );
    }

    console.log("[/api/generate-post] Success — returned API result");
    return Response.json({ ...parsed, source: "api" });
  } catch (err) {
    console.error("[/api/generate-post] Failed with no fallback:", err);
    return Response.json(
      { error: "게시물 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.", source: "fallback" },
      { status: 500 }
    );
  }
}
