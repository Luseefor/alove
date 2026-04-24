import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@alove/editor", "@alove/protocol", "@alove/queue"],
  serverExternalPackages: ["bullmq", "ioredis"],
};

export default nextConfig;
