import { NextResponse } from "next/server";
import { isLocalStandalone, isPlaceholderConfigValue } from "@/lib/localStandalone";

export const runtime = "nodejs";

export async function GET() {
  const env = process.env;
  const isLocal = isLocalStandalone(env);

  let authStatus = "configured";
  if (isLocal) {
    authStatus = "local_bypass";
  } else {
    const clerkSecret = env.CLERK_SECRET_KEY?.trim() ?? "";
    if (!clerkSecret || isPlaceholderConfigValue(clerkSecret)) {
      authStatus = "missing";
    }
  }

  // Not strictly checking Redis connection here to avoid blocking simple health checks,
  // but we reflect its configuration.
  const redisConfigured = !!env.REDIS_HOST;

  return NextResponse.json({
    ok: true,
    service: "web",
    mode: isLocal ? "local" : "cloud",
    redis: redisConfigured ? "ok" : "unavailable",
    auth: authStatus,
    version: process.env.npm_package_version ?? "0.1.0",
  });
}
