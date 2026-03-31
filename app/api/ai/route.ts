const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const TEXT_MODEL = "openai/gpt-4o-mini";
const IMAGE_MODEL = "google/gemini-3-pro-image-preview";

type AccountPlanResult = {
  accountNames: Array<{ name: string; meaning: string }>;
  accountPlan: {
    direction: string;
    bio: string;
    concept: string;
  };
};

type PostPlanResult = {
  title: string;
  content: string;
  hashtags: string;
  visualPrompt: string;
};

type PostImageResult = {
  title: string;
  content: string;
  hashtags: string;
  generatedImageUrl: string;
  imageModelText?: string;
  planningModel: string;
  imageModel: string;
};

type AiRequestBody = {
  type?: "planning" | "post_image";
  industry?: string;
  productService?: string;
  requestId?: string;
  previousResult?: AccountPlanResult | null;
  previousPost?: {
    title?: string;
    content?: string;
    hashtags?: string;
  } | null;
  image?: string;
  images?: string[];
  userPrompt?: string;
};

type OpenRouterMessage =
  | { role: "user"; content: string }
  | {
      role: "user";
      content: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
    };

export async function POST(request: Request) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    console.error("[/api/ai] Missing OPENROUTER_API_KEY");
    return Response.json({ error: "AI generation failed" }, { status: 500 });
  }

  let body: AiRequestBody;

  try {
    body = (await request.json()) as AiRequestBody;
  } catch {
    return Response.json({ error: "AI generation failed" }, { status: 400 });
  }

  if (body.type === "post_image") {
    return handlePostImageGeneration(body, apiKey);
  }

  return handlePlanning(body, apiKey);
}

async function handlePlanning(body: AiRequestBody, apiKey: string) {
  const industry = String(body.industry ?? "").trim();
  const productService = String(body.productService ?? "").trim();
  const requestId = String(body.requestId ?? "").trim();

  if (!industry || !productService) {
    return Response.json({ error: "AI generation failed" }, { status: 400 });
  }

  const previousNames = Array.isArray(body.previousResult?.accountNames)
    ? body.previousResult.accountNames.map((item) => item.name).filter(Boolean).join(", ")
    : "";
  const previousPlan = body.previousResult?.accountPlan;

  const userInput = `
당신은 한국의 인스타그램 마케팅 전문가입니다.
아래 비즈니스 정보를 바탕으로 인스타그램 계정 기획을 해주세요.

업종: ${industry}
판매하는 상품/서비스: ${productService}

중요 규칙:
- accountNames의 name은 반드시 영문 소문자만 사용, 공백 없이, 짧고 브랜드감 있게
- 업종을 직접적으로 포함하지 마세요. 창의적이고 기억하기 쉬운 이름으로
- meaning은 왜 이 이름을 추천하는지 한국어로 짧게 설명 (1문장)
- accountPlan의 모든 내용은 한국어, 이 비즈니스에 맞는 구체적 내용이어야 합니다
- bio는 인스타그램 소개란에 들어갈 2줄 매력적인 문구 (이모지 포함)
- 매번 완전히 새로운 결과를 생성하세요. 이전 결과를 반복하지 마세요.
- accountNames는 반드시 서로 달라야 하며, 정확히 3개만 제안하세요.
- generation_id(${requestId || "none"})를 참고해 이전 응답과 다른 표현을 사용하세요.

이전 생성 결과(절대 반복 금지):
- 이전 계정명: ${previousNames || "없음"}
- 이전 방향: ${String(previousPlan?.direction ?? "없음")}
- 이전 소개글: ${String(previousPlan?.bio ?? "없음")}
- 이전 컨셉: ${String(previousPlan?.concept ?? "없음")}

다음 JSON 형식으로만 답변하세요. 설명 없이 JSON만 출력하세요:
{
  "accountNames": [
    { "name": "englishname1", "meaning": "추천 이유 한국어 설명" },
    { "name": "englishname2", "meaning": "추천 이유 한국어 설명" },
    { "name": "englishname3", "meaning": "추천 이유 한국어 설명" }
  ],
  "accountPlan": {
    "direction": "추천 계정 방향",
    "bio": "소개글 2줄",
    "concept": "운영 컨셉"
  }
}
`;

  const response = await callOpenRouter({
    apiKey,
    model: TEXT_MODEL,
    requestType: "planning",
    messages: [{ role: "user", content: userInput }],
  });

  if (!response.ok) {
    return Response.json({ error: "AI generation failed", source: "fallback" }, { status: 502 });
  }

  const content = extractMessageContent(response.data?.choices?.[0]?.message?.content);
  const parsed = extractJson<AccountPlanResult>(content);

  if (!parsed) {
    console.error("[/api/ai] Failed to parse planning response");
    return Response.json({ error: "AI generation failed", source: "fallback" }, { status: 502 });
  }

  const accountNames = parsed.accountNames ?? [];
  const allEnglishLower = accountNames.every((item) => /^[a-z]+$/.test(String(item.name ?? "")));
  const allDifferent = new Set(accountNames.map((item) => item.name)).size === 3;
  const hasKoreanMeaning = accountNames.every((item) => /[가-힣]/.test(String(item.meaning ?? "")));
  const hasPlan =
    !!parsed.accountPlan?.direction?.trim() &&
    !!parsed.accountPlan?.bio?.trim() &&
    !!parsed.accountPlan?.concept?.trim();

  if (accountNames.length !== 3 || !allEnglishLower || !allDifferent || !hasKoreanMeaning || !hasPlan) {
    console.error("[/api/ai] Invalid planning response:", parsed);
    return Response.json({ error: "AI generation failed", source: "fallback" }, { status: 502 });
  }

  console.log("[/api/ai] Planning response from: OPENROUTER API");
  return Response.json({ ...parsed, source: "api" });
}

async function handlePostImageGeneration(body: AiRequestBody, apiKey: string) {
  const industry = String(body.industry ?? "").trim();
  const productService = String(body.productService ?? "").trim();
  const requestId = String(body.requestId ?? "").trim();
  const images = Array.isArray(body.images)
    ? body.images.map((item) => String(item ?? "")).filter(Boolean).slice(0, 2)
    : body.image
      ? [String(body.image)]
      : [];
  const userPrompt = String(body.userPrompt ?? "").trim();

  if (!industry || !productService || (images.length === 0 && !userPrompt)) {
    return Response.json({ error: "Image generation failed" }, { status: 400 });
  }

  if (
    images.some((image) => !/^data:image\/[\w.+-]+;base64,/.test(image))
  ) {
    return Response.json({ error: "Image generation failed" }, { status: 400 });
  }

  const postPlan = await generatePostPlan({
    apiKey,
    industry,
    productService,
    requestId,
    previousPost: body.previousPost ?? null,
    userPrompt,
  });

  if (!postPlan.ok) {
    return Response.json({ error: "AI generation failed", source: "fallback" }, { status: 502 });
  }

  const imagePrompt = `
Create an Instagram marketing post visual.

Business context:
- Industry: ${industry}
- Product or service: ${productService}

Post plan:
- Title: ${postPlan.data.title}
- Caption summary: ${postPlan.data.content}
- Hashtags: ${postPlan.data.hashtags}

Visual direction:
${postPlan.data.visualPrompt}

Requirements:
- Output a polished square Instagram feed post image
- Prioritize strong composition, clean typography space, and premium brand presentation
- Keep it suitable for a Korean audience
- Make it feel like a real branded social media creative, not a stock photo
- Compose it in a strict 1:1 square layout suitable for the Instagram feed
- Respect the uploaded reference images for product, mood, style, or composition cues when useful
- Avoid cluttered layouts and avoid dense text overlays
- Prefer no text inside the image whenever possible
- If text is absolutely necessary, use only one very short Korean headline or at most two short lines
- Never include long Korean sentences, paragraphs, multiple text blocks, or small unreadable Korean copy
- Keep the main marketing copy outside the image; the image should be visually strong even without readable text
`;

  const imageResponse = await callOpenRouter({
    apiKey,
    model: IMAGE_MODEL,
    requestType: "post_image",
    messages: images.length > 0
      ? [
          {
            role: "user",
            content: [
              { type: "text", text: imagePrompt },
              ...images.map((image) => ({
                type: "image_url" as const,
                image_url: { url: image },
              })),
            ],
          },
        ]
      : [{ role: "user", content: imagePrompt }],
    modalities: ["image", "text"],
    imageConfig: {
      aspect_ratio: "1:1",
      image_size: "1K",
    },
  });

  if (!imageResponse.ok) {
    return Response.json({ error: "Image generation failed" }, { status: 502 });
  }

  console.log(
    "[/api/ai] OpenRouter full image response:",
    JSON.stringify(imageResponse.data)
  );

  const imageOutputs = extractImageOutputs(imageResponse.data);
  const imageModelText = extractMessageContent(
    imageResponse.data?.choices?.[0]?.message?.content
  );

  if (imageOutputs.length === 0) {
    console.error("[/api/ai] No image outputs found for post_image request");
    return Response.json({ error: "Image generation failed" }, { status: 502 });
  }

  const result: PostImageResult = {
    title: postPlan.data.title,
    content: postPlan.data.content,
    hashtags: postPlan.data.hashtags,
    generatedImageUrl: imageOutputs[0],
    planningModel: TEXT_MODEL,
    imageModel: IMAGE_MODEL,
  };

  if (imageModelText) {
    result.imageModelText = imageModelText;
  }

  console.log("[/api/ai] Post image response from: OPENROUTER API");
  return Response.json({ ...result, source: "api" });
}

async function generatePostPlan({
  apiKey,
  industry,
  productService,
  requestId,
  previousPost,
  userPrompt,
}: {
  apiKey: string;
  industry: string;
  productService: string;
  requestId: string;
  previousPost: AiRequestBody["previousPost"];
  userPrompt: string;
}) {
  const userInput = `
당신은 한국의 인스타그램 마케팅 전문가입니다.
인스타그램 게시물 기획을 작성해 주세요.

업종: ${industry}
상품/서비스: ${productService}
사용자 요청 방향: ${userPrompt || "없음"}

중요 규칙:
- title, content, hashtags는 모두 이 비즈니스에 맞는 구체적인 결과여야 합니다
- title은 인스타그램 피드에서 바로 사용할 수 있는 짧고 강한 한국어 제목 한 줄이어야 합니다
- content는 3~5문장, 자연스러운 한국어, 이모지 포함
- hashtags는 공백으로 구분된 해시태그 5개 이상
- visualPrompt는 이미지 생성 모델이 바로 사용할 수 있는 상세한 영어 프롬프트로 작성하세요
- visualPrompt에는 정사각형 1:1 인스타그램 피드 구도, 조명, 색감, 제품/브랜드 포인트, 인스타그램 광고 느낌을 구체적으로 포함하세요
- visualPrompt에는 텍스트 오버레이를 최소화하라고 명확히 지시하세요
- visualPrompt에는 한국어 문장은 이미지 안에 넣지 말고, 꼭 필요한 경우에도 매우 짧은 한국어 한 줄 또는 두 줄만 허용하라고 적으세요
- visualPrompt에는 긴 슬로건, 문단, 여러 개의 텍스트 박스, 복잡한 타이포그래피를 피하라고 적으세요
- visualPrompt는 시각적 완성도를 우선하고, 본문 카피는 이미지 밖 title/content/hashtags로 전달하도록 유도하세요
- 사용자가 참고 이미지는 참고용이며, 사용자 요청 방향이 있으면 반드시 그 방향을 우선 반영하세요
- 매번 완전히 새로운 결과를 생성하세요
- generation_id(${requestId || "none"})를 참고해 이전 결과와 다른 문구를 작성하세요

이전 생성 결과(절대 반복 금지):
- 제목: ${String(previousPost?.title ?? "없음")}
- 본문: ${String(previousPost?.content ?? "없음")}
- 해시태그: ${String(previousPost?.hashtags ?? "없음")}

다음 JSON 형식으로만 답변하세요. 설명 없이 JSON만 출력하세요:
{
  "title": "게시물 제목",
  "content": "게시물 본문",
  "hashtags": "#해시태그1 #해시태그2 #해시태그3 #해시태그4 #해시태그5",
  "visualPrompt": "Detailed English prompt for image generation"
}
`;

  const response = await callOpenRouter({
    apiKey,
    model: TEXT_MODEL,
    requestType: "post_plan",
    messages: [{ role: "user", content: userInput }],
  });

  if (!response.ok) {
    return { ok: false as const };
  }

  const content = extractMessageContent(response.data?.choices?.[0]?.message?.content);
  const parsed = extractJson<PostPlanResult>(content);

  if (!parsed) {
    console.error("[/api/ai] Failed to parse post plan response");
    return { ok: false as const };
  }

  const title = String(parsed.title ?? "").trim();
  const caption = String(parsed.content ?? "").trim();
  const hashtags = String(parsed.hashtags ?? "").trim();
  const visualPrompt = String(parsed.visualPrompt ?? "").trim();
  const hasEnoughHashtags = hashtags.split(/\s+/).filter((tag) => tag.startsWith("#")).length >= 5;

  if (!title || !caption || !hashtags || !visualPrompt || !hasEnoughHashtags) {
    console.error("[/api/ai] Invalid post plan response:", parsed);
    return { ok: false as const };
  }

  return { ok: true as const, data: parsed };
}

async function callOpenRouter({
  apiKey,
  model,
  requestType,
  messages,
  modalities,
  imageConfig,
}: {
  apiKey: string;
  model: string;
  requestType: string;
  messages: OpenRouterMessage[];
  modalities?: Array<"text" | "image" | "audio">;
  imageConfig?: Record<string, string>;
}) {
  const payload: {
    model: string;
    messages: OpenRouterMessage[];
    modalities?: Array<"text" | "image" | "audio">;
    image_config?: Record<string, string>;
  } = {
    model,
    messages,
  };

  if (modalities) {
    payload.modalities = modalities;
  }

  if (imageConfig) {
    payload.image_config = imageConfig;
  }

  try {
    const res = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const rawBody = await res.text();

    if (!res.ok) {
      console.error("[/api/ai] OpenRouter API error");
      console.error("[/api/ai] request type:", requestType);
      console.error("[/api/ai] model:", model);
      console.error("[/api/ai] response status:", res.status);
      console.error("[/api/ai] raw response body:", rawBody);
      return { ok: false as const, data: null };
    }

    const data = JSON.parse(rawBody);
    return { ok: true as const, data };
  } catch (error) {
    console.error("[/api/ai] OpenRouter request failed");
    console.error("[/api/ai] request type:", requestType);
    console.error("[/api/ai] model:", model);
    console.error("[/api/ai] raw response body:", "");
    console.error(error);
    return { ok: false as const, data: null };
  }
}

function extractMessageContent(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "text" &&
          "text" in item &&
          typeof item.text === "string"
        ) {
          return item.text;
        }

        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
}

function extractImageOutputs(data: unknown) {
  const message =
    typeof data === "object" &&
    data !== null &&
    "choices" in data &&
    Array.isArray(data.choices) &&
    data.choices[0] &&
    typeof data.choices[0] === "object" &&
    data.choices[0] !== null &&
    "message" in data.choices[0]
      ? data.choices[0].message
      : null;

  const urls: string[] = [];

  if (message && typeof message === "object" && "images" in message && Array.isArray(message.images)) {
    for (const image of message.images) {
      if (
        typeof image === "object" &&
        image !== null &&
        "image_url" in image &&
        typeof image.image_url === "object" &&
        image.image_url !== null &&
        "url" in image.image_url &&
        typeof image.image_url.url === "string"
      ) {
        urls.push(image.image_url.url);
      }

      if (
        typeof image === "object" &&
        image !== null &&
        "imageUrl" in image &&
        typeof image.imageUrl === "object" &&
        image.imageUrl !== null &&
        "url" in image.imageUrl &&
        typeof image.imageUrl.url === "string"
      ) {
        urls.push(image.imageUrl.url);
      }
    }
  }

  if (message && typeof message === "object" && "content" in message && Array.isArray(message.content)) {
    for (const item of message.content) {
      if (
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "image_url" &&
        "image_url" in item &&
        typeof item.image_url === "object" &&
        item.image_url !== null &&
        "url" in item.image_url &&
        typeof item.image_url.url === "string"
      ) {
        urls.push(item.image_url.url);
      }
    }
  }

  return [...new Set(urls)];
}

function extractJson<T>(text: string) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    return null;
  }

  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return null;
  }
}
