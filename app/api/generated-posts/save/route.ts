import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleClient } from "@/lib/server/admin";
import type { Database } from "@/lib/supabase/types";

// Generated-post save endpoint (service role).
//
// The browser used to INSERT into generated_posts directly and read the id
// back via RETURNING — including anonymous free-trial saves (user_id null).
// With RLS enabled on generated_posts, anonymous sessions cannot see their
// own inserted row, so INSERT … RETURNING breaks (same trap as applications).
// This endpoint performs the insert with the service role and returns the id.
//
// Security model:
// - user_id is NEVER taken from the client; it comes from the verified access
//   token only. Anonymous saves store user_id null (free-trial flow).
// - Column whitelist + length caps bound what can be written.

const MAX_LENGTHS: Record<string, number> = {
  title: 500,
  content: 20000,
  hashtags: 2000,
  image_url: 500000, // may be a storage URL or, in fallback paths, a data URL
  visual_prompt: 5000,
  email: 320,
};

function capped(value: unknown, key: string): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_LENGTHS[key] ?? 2000);
}

function getMissingColumnName(errorMessage?: string | null) {
  if (!errorMessage) return null;
  const schemaCacheMatch = errorMessage.match(
    /could not find the '([^']+)' column of 'generated_posts'/i
  );
  if (schemaCacheMatch?.[1]) return schemaCacheMatch[1];
  const relationColumnMatch = errorMessage.match(
    /column\s+generated_posts\.([a-z0-9_]+)\s+does not exist/i
  );
  if (relationColumnMatch?.[1]) return relationColumnMatch[1];
  return null;
}

// Optional columns that may be missing from older schemas; dropped on retry
// (mirrors the old client-side payload-variant fallback).
const DROPPABLE_COLUMNS = new Set(["visual_prompt", "application_id", "email"]);

export async function POST(request: NextRequest) {
  let body: {
    accessToken?: string | null;
    post?: Record<string, unknown>;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 }
    );
  }

  const post = body.post;
  if (!post || typeof post !== "object") {
    return NextResponse.json(
      { error: "게시물 정보가 필요합니다." },
      { status: 400 }
    );
  }

  const title = capped(post.title, "title");
  const content = capped(post.content, "content");
  const hashtags = capped(post.hashtags, "hashtags");
  const imageUrl = capped(post.image_url, "image_url");
  if (!title || !content || !hashtags || !imageUrl) {
    return NextResponse.json(
      { error: "게시물 필수 정보가 누락되었습니다." },
      { status: 400 }
    );
  }

  // user_id comes only from a verified token (anonymous saves → null)
  let userId: string | null = null;
  const accessToken =
    typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  if (accessToken) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (supabaseUrl && supabaseAnonKey) {
      try {
        const authClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        });
        const {
          data: { user },
        } = await authClient.auth.getUser(accessToken);
        userId = user?.id ?? null;
      } catch {
        userId = null;
      }
    }
  }

  // created_at: allow the queued-post original timestamp, but never future
  let createdAt = new Date().toISOString();
  if (typeof post.created_at === "string") {
    const t = new Date(post.created_at).getTime();
    if (Number.isFinite(t) && t <= Date.now() + 60_000) {
      createdAt = new Date(t).toISOString();
    }
  }

  try {
    const db = getSupabaseServiceRoleClient();

    const applicationId =
      typeof post.application_id === "string" &&
      /^[0-9a-f-]{36}$/i.test(post.application_id.trim())
        ? post.application_id.trim()
        : null;

    let payload: Record<string, unknown> = {
      user_id: userId,
      application_id: applicationId,
      email: capped(post.email, "email")?.toLowerCase() ?? null,
      title,
      content,
      hashtags,
      image_url: imageUrl,
      is_free_trial: post.is_free_trial === true,
      visual_prompt: capped(post.visual_prompt, "visual_prompt"),
      created_at: createdAt,
    };

    for (let attempt = 0; attempt < 1 + DROPPABLE_COLUMNS.size; attempt++) {
      const response = (await (
        db
          .from("generated_posts")
          .insert(payload as never)
          .select("id")
          .single() as unknown
      )) as {
        data: { id?: string } | null;
        error: { message: string } | null;
      };

      if (!response.error) {
        return NextResponse.json({
          generatedPostId: String(response.data?.id ?? "") || null,
        });
      }

      const missing = getMissingColumnName(response.error.message);
      if (!missing || !DROPPABLE_COLUMNS.has(missing) || !(missing in payload)) {
        console.warn(
          "[/api/generated-posts/save] insert 실패:",
          JSON.stringify({ error: response.error.message, userId })
        );
        return NextResponse.json(
          { error: "게시물을 저장하지 못했습니다." },
          { status: 500 }
        );
      }
      const next = { ...payload };
      delete next[missing];
      payload = next;
    }

    return NextResponse.json(
      { error: "게시물을 저장하지 못했습니다." },
      { status: 500 }
    );
  } catch (error) {
    console.error("[/api/generated-posts/save] failed:", error);
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
