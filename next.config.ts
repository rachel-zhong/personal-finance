import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // The demo server builds into its own folder so it never clobbers the real app's build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // No floating Next.js badge over the sidebar in dev
  devIndicators: false,
};

export default nextConfig;
