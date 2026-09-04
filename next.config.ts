import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // `next dev` and `next build` share .next by default, so a production build
  // run while the dev server is up leaves the dev cache inconsistent and the
  // browser keeps serving stale pages no matter how often you refresh.
  // Verification builds set NEXT_DIST_DIR to write somewhere else instead.
  // Unset everywhere else (including Vercel), so the default stays .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",

  // Baseline security headers. Deliberately conservative: only directives that
  // cannot break a normal Next.js App Router page are set here. A full
  // script-src/style-src CSP needs nonce plumbing and page-by-page testing, so
  // it is left as a follow-up rather than shipped untested.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Never let a response be re-interpreted as a type it did not declare.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Clickjacking: nothing here is meant to be embedded elsewhere.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // frame-ancestors is the modern X-Frame-Options; object-src and
          // base-uri close off plugin and <base> injection. No script-src yet
          // (see note above), so this cannot break existing pages.
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
