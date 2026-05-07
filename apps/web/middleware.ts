import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isLocalStandalone } from "@/lib/localStandalone";

export default async function middleware(req: NextRequest) {
  if (isLocalStandalone()) return NextResponse.next();

  try {
    const clerk = await import("@clerk/nextjs/server");
    const isPublic = clerk.createRouteMatcher([
      "/",
      "/sign-in(.*)",
      "/sign-up(.*)",
      "/api/webhooks(.*)",
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler: any = clerk.clerkMiddleware(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (auth: any, cReq: any) => {
        if (!process.env.CLERK_SECRET_KEY) return NextResponse.next();
        if (!isPublic(cReq)) await auth.protect();
      },
    );

    return await handler(req, undefined);
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
