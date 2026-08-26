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
};

export default nextConfig;
