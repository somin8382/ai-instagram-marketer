import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

declare global {
  var __qmeetSupabaseBrowserClient: SupabaseClient<Database> | undefined;
}

export function hasSupabaseEnv() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function getSupabaseBrowserClient() {
  if (!hasSupabaseEnv()) {
    throw new Error("Supabase 환경 변수가 설정되지 않았습니다.");
  }

  if (!globalThis.__qmeetSupabaseBrowserClient) {
    globalThis.__qmeetSupabaseBrowserClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }
    );
  }

  return globalThis.__qmeetSupabaseBrowserClient;
}

export function getSupabaseBrowserClientOrNull() {
  if (!hasSupabaseEnv()) {
    return null;
  }

  return getSupabaseBrowserClient();
}
