"use client";

import { useEffect } from "react";
import { getSupabaseBrowserClientOrNull } from "@/lib/supabase/client";

/**
 * Mirrors "is there a session" into a plain cookie.
 *
 * Supabase keeps the session in localStorage, which the server cannot read, so
 * without this the server has no way to tell a visitor from a customer and `/`
 * would have to flash the marketing page before correcting itself.
 *
 * The cookie carries no identity and no token. It only answers "signed in?" for
 * routing, and is never trusted for authorisation: every protected route still
 * checks the real session.
 */
export const SIGNED_IN_COOKIE = "qmeet_signed_in";

function writeCookie(signedIn: boolean) {
  if (signedIn) {
    // Matches Supabase's default refresh-token lifetime closely enough; a stale
    // cookie only causes a redirect to /mypage, which re-checks the session.
    document.cookie = `${SIGNED_IN_COOKIE}=1; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
    return;
  }
  document.cookie = `${SIGNED_IN_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}

export function AuthCookieSync() {
  useEffect(() => {
    const supabase = getSupabaseBrowserClientOrNull();
    if (!supabase) return;

    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active) writeCookie(Boolean(data.session));
    });

    // Covers sign-in, sign-out, token refresh and expiry in one place, so the
    // three separate signOut() call sites do not each need to clear it.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      writeCookie(Boolean(session));
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return null;
}
