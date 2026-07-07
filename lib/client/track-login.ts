import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";

const SESSION_FLAG = "qmeet_login_event_tracked";

/**
 * Record a login/visit event for the admin-side activity history.
 * Deduped per browser session (sessionStorage): the first call wins, so an
 * explicit credential login records "login" and a returning persisted session
 * records "visit" — never both. Fire-and-forget; failures never surface to
 * the user.
 */
export function trackLoginEventOnce(
  userId: string | null | undefined,
  email: string | null | undefined,
  eventType: "login" | "visit"
): void {
  if (typeof window === "undefined" || !userId) return;

  try {
    if (window.sessionStorage.getItem(SESSION_FLAG)) return;
    window.sessionStorage.setItem(SESSION_FLAG, eventType);
  } catch {
    // sessionStorage unavailable (private mode quirks): still attempt insert
  }

  const supabase = getSupabaseBrowserClientOrNull();
  if (!supabase) return;

  void (
    supabase
      .from("login_events" as never)
      .insert({
        user_id: userId,
        email: email ?? null,
        event_type: eventType,
      } as never) as unknown as Promise<{ error: { message: string } | null }>
  ).then(({ error }) => {
    if (error) {
      console.warn("[track-login] insert failed:", error.message);
    }
  });
}
