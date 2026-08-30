import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Partial Prerendering: the editor routes' static shell (frame, sidebar
  // skeleton) is prerendered at build time; auth/data-dependent content
  // streams in behind <Suspense> boundaries. See app/editor/layout.tsx,
  // app/editor/page.tsx, app/editor/[id]/page.tsx and app/page.tsx.
  cacheComponents: true,
};

export default nextConfig;
