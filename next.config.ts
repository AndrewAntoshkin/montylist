import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
  // External packages for server components (moved from experimental in Next.js 16)
  serverExternalPackages: ['fluent-ffmpeg', '@ffmpeg-installer/ffmpeg'],
  // Turbopack configuration for Next.js 16
  turbopack: {
    // Specify workspace root to silence warning
    root: process.cwd(),
    // Allow external packages
    resolveAlias: {
      'fluent-ffmpeg': 'fluent-ffmpeg',
      '@ffmpeg-installer/ffmpeg': '@ffmpeg-installer/ffmpeg',
    },
  },
};

export default nextConfig;
