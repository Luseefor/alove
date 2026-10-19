import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@alove/editor", "@alove/protocol", "@alove/queue"],
  serverExternalPackages: ["bullmq", "ioredis"],
  // Forwarded as defaults for client bundles. Source must still read flags via direct
  // process.env.NEXT_PUBLIC_* member access for stable build-time injection behavior.
  env: {
    NEXT_PUBLIC_LOCAL_STANDALONE: process.env.NEXT_PUBLIC_LOCAL_STANDALONE ?? "false",
    NEXT_PUBLIC_EDITOR_MODE: process.env.NEXT_PUBLIC_EDITOR_MODE ?? "",
    NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR: process.env.NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR ?? "",
  },
};

export default nextConfig;
