import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@alove/editor", "@alove/protocol", "@alove/queue"],
  serverExternalPackages: ["bullmq", "ioredis"],
  // Forwarded as defaults; webpack DefinePlugin inlines at build time when source accesses process.env.NEXT_PUBLIC_* directly.
  // Turbopack does NOT inline NEXT_PUBLIC_* vars. E2E tests must use `next build` (webpack).
  env: {
    NEXT_PUBLIC_LOCAL_STANDALONE: process.env.NEXT_PUBLIC_LOCAL_STANDALONE ?? "false",
    NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR: process.env.NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR ?? "false",
  },
};

export default nextConfig;
