import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest } from "next/server";
import {
  isLocalStandalone,
  isPlaceholderConfigValue,
} from "@/lib/localStandalone";

export default async function middleware(
  req: NextRequest,
  event: NextFetchEvent,
) {
  const path = req.nextUrl.pathname;
  const compile = path === "/api/compile" || path.startsWith("/api/compile/");
  // Compile routes enforce their own origin, identity and project checks.
  if (compile && process.env.ALOVE_LOCAL_COMPILE_ORIGIN)
    return NextResponse.next();
  // Account-free local writing is independent of permission to run compute.
  if (!path.startsWith("/api/") && isLocalStandalone())
    return NextResponse.next();
  if (path === "/api/health") return NextResponse.next();

  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret || isPlaceholderConfigValue(secret))
    return NextResponse.json(
      { error: "Authentication is not configured" },
      { status: 503 },
    );
  try {
    const clerk = await import("@clerk/nextjs/server");
    const isPublic = clerk.createRouteMatcher([
      "/",
      "/sign-in(.*)",
      "/sign-up(.*)",
      "/api/webhooks(.*)",
    ]);
    const handler = clerk.clerkMiddleware(async (auth, cReq) => {
      // auth() in compile route handlers needs Clerk middleware context.
      if (!compile && !isPublic(cReq)) await auth.protect();
    });
    return await handler(req, event);
  } catch {
    return NextResponse.json(
      { error: "Authentication unavailable" },
      { status: 503 },
    );
  }
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
