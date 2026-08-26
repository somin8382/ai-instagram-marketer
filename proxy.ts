import { NextResponse, type NextRequest } from "next/server";

// Keep in sync with SIGNED_IN_COOKIE in lib/ui/auth-cookie-sync.tsx. Not
// imported: that module is "use client" and pulls the Supabase browser client
// into the proxy bundle.
const SIGNED_IN_COOKIE = "qmeet_signed_in";

/**
 * Signed-in visitors landing on `/` are sent to their dashboard instead of the
 * marketing page. A customer who already pays does not need to be sold again.
 *
 * Deliberately narrow:
 * - Only full document loads. In-app client navigations to `/` (including the
 *   `router.replace("/")` the application flow uses to clean up its query
 *   string) must not be hijacked, or the 신청 flow would bounce out mid-way.
 * - Only a bare `/`. Any query string means the app is driving the flow.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname !== "/" || search) return NextResponse.next();
  if (request.headers.get("sec-fetch-dest") !== "document") {
    return NextResponse.next();
  }
  if (request.cookies.get(SIGNED_IN_COOKIE)?.value !== "1") {
    return NextResponse.next();
  }

  return NextResponse.redirect(new URL("/mypage", request.url));
}

export const config = {
  matcher: "/",
};
