import { type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");

  if (!url) {
    return new Response("Missing url parameter", { status: 400 });
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(url);
    new URL(decoded);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }

  try {
    const upstream = await fetch(decoded, {
      headers: { Accept: "image/*" },
    });

    if (!upstream.ok) {
      return new Response("Upstream fetch failed", { status: 502 });
    }

    const contentType = upstream.headers.get("content-type") ?? "image/png";
    const buffer = await upstream.arrayBuffer();

    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new Response("Proxy error", { status: 502 });
  }
}
