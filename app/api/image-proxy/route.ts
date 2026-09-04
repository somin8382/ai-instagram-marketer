import { type NextRequest } from "next/server";

/**
 * Same-origin fetcher for the generated post images, used by the download and
 * the reroll/edit flows (which need the bytes, not just an <img> src).
 *
 * It previously fetched ANY url the caller passed and echoed the upstream
 * Content-Type back verbatim. That made it an open proxy: a crafted link
 * (`/api/image-proxy?url=https://evil.example/x.html`) served attacker HTML
 * from this site's own origin, so the script in it ran as us and could read
 * the Supabase session out of localStorage. Hence the two gates below —
 * the request must name our own Storage bucket, and the response must
 * actually be an image.
 */

const ALLOWED_HOST = (() => {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
})();

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");

  if (!url) {
    return new Response("Missing url parameter", { status: 400 });
  }

  if (!ALLOWED_HOST) {
    console.error("[/api/image-proxy] NEXT_PUBLIC_SUPABASE_URL is not set");
    return new Response("Proxy not configured", { status: 500 });
  }

  let target: URL;
  try {
    target = new URL(decodeURIComponent(url));
  } catch {
    return new Response("Invalid url", { status: 400 });
  }

  // Gate 1: only https, and only our own Supabase Storage host. Every image
  // this app produces lives there; data: URLs never reach the proxy (the
  // callers decode those in the browser).
  if (target.protocol !== "https:" || target.host !== ALLOWED_HOST) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const upstream = await fetch(target, {
      headers: { Accept: "image/*" },
      // Never chase a redirect off the allowed host.
      redirect: "error",
    });

    if (!upstream.ok) {
      return new Response("Upstream fetch failed", { status: 502 });
    }

    // Gate 2: never hand back anything the browser could treat as markup or
    // script, whatever the upstream claims. Paired with nosniff below.
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      return new Response("Not an image", { status: 415 });
    }

    const buffer = await upstream.arrayBuffer();

    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        // The only callers fetch this same-origin, so the previous
        // `Access-Control-Allow-Origin: *` bought nothing and let any site
        // read responses through us.
      },
    });
  } catch {
    return new Response("Proxy error", { status: 502 });
  }
}
