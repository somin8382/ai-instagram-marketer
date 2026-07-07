import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";

// Mirrors the option sets accepted by /api/ai (post_image handler).
export type ContentTone = "friendly" | "informative" | "story" | "witty";
export type EmojiUsage = "rich" | "minimal" | "off";
export type ImageStyle = "photoreal" | "webtoon" | "mood" | "3d";

export type GenerationPrefs = {
  contentTone: ContentTone;
  emojiUsage: EmojiUsage;
  imageStyle: ImageStyle;
};

export const CONTENT_TONE_OPTIONS: Array<{ value: ContentTone; label: string }> = [
  { value: "friendly", label: "친근한 말투" },
  { value: "informative", label: "정보·전문형" },
  { value: "story", label: "스토리텔링" },
  { value: "witty", label: "위트있게" },
];

export const EMOJI_USAGE_OPTIONS: Array<{ value: EmojiUsage; label: string }> = [
  { value: "minimal", label: "이모지 최소" },
  { value: "rich", label: "이모지 풍부" },
  { value: "off", label: "이모지 없음" },
];

export const IMAGE_STYLE_OPTIONS: Array<{ value: ImageStyle; label: string }> = [
  { value: "photoreal", label: "실사 사진" },
  { value: "webtoon", label: "웹툰·일러스트" },
  { value: "mood", label: "감성 무드" },
  { value: "3d", label: "3D 그래픽" },
];

const CONTENT_TONES = new Set(CONTENT_TONE_OPTIONS.map((o) => o.value));
const EMOJI_USAGES = new Set(EMOJI_USAGE_OPTIONS.map((o) => o.value));
const IMAGE_STYLES = new Set(IMAGE_STYLE_OPTIONS.map((o) => o.value));

/** Load saved prefs; unknown/missing values come back as null fields. */
export async function loadGenerationPrefs(
  userId: string
): Promise<Partial<GenerationPrefs>> {
  const supabase = getSupabaseBrowserClientOrNull();
  if (!supabase || !userId) return {};
  try {
    const { data } = (await (supabase
      .from("profiles")
      .select("generation_prefs")
      .eq("id", userId)
      .maybeSingle() as unknown as Promise<{
      data: { generation_prefs: unknown } | null;
      error: { message: string } | null;
    }>)) as { data: { generation_prefs: unknown } | null };
    const raw = data?.generation_prefs;
    if (!raw || typeof raw !== "object") return {};
    const prefs = raw as Record<string, unknown>;
    const result: Partial<GenerationPrefs> = {};
    if (CONTENT_TONES.has(prefs.contentTone as ContentTone)) {
      result.contentTone = prefs.contentTone as ContentTone;
    }
    if (EMOJI_USAGES.has(prefs.emojiUsage as EmojiUsage)) {
      result.emojiUsage = prefs.emojiUsage as EmojiUsage;
    }
    if (IMAGE_STYLES.has(prefs.imageStyle as ImageStyle)) {
      result.imageStyle = prefs.imageStyle as ImageStyle;
    }
    return result;
  } catch {
    return {};
  }
}

/** Persist prefs; fire-and-forget (failures never surface to the user). */
export function saveGenerationPrefs(
  userId: string,
  prefs: GenerationPrefs
): void {
  const supabase = getSupabaseBrowserClientOrNull();
  if (!supabase || !userId) return;
  void (
    supabase
      .from("profiles")
      .update({ generation_prefs: prefs } as never)
      .eq("id", userId) as unknown as Promise<{
      error: { message: string } | null;
    }>
  ).then(({ error }) => {
    if (error) {
      console.warn("[generation-prefs] save failed:", error.message);
    }
  });
}
