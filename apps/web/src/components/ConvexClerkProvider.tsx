"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { type ReactNode, useMemo } from "react";

/** Well-formed `pk_test` string so `next build` and CI can prerender without your real Clerk app. Replace with `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in every deployed environment. */
const CLERK_PUBLISHABLE_PLACEHOLDER = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";

export function ConvexClerkProvider({ children }: { children: ReactNode }) {
  const fromEnv = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
  const publishableKey = fromEnv || CLERK_PUBLISHABLE_PLACEHOLDER;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";

  const convex = useMemo(() => {
    if (!url) return null;
    return new ConvexReactClient(url);
  }, [url]);

  const showClerkKeyBanner = !fromEnv;
  const showConvexBanner = !url;

  return (
    <>
      {(showClerkKeyBanner || showConvexBanner) && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          {showClerkKeyBanner && (
            <span>
              Set a real{" "}
              <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">
                NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
              </code>{" "}
              in <code className="rounded px-1">apps/web/.env.local</code> for
              sign-in.
            </span>
          )}
          {showClerkKeyBanner && showConvexBanner ? " · " : null}
          {showConvexBanner && (
            <span>
              Set{" "}
              <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">
                NEXT_PUBLIC_CONVEX_URL
              </code>{" "}
              (run <code className="rounded px-1">bun run convex:dev</code> from the repo root).
            </span>
          )}
        </div>
      )}
      <ClerkProvider publishableKey={publishableKey}>
        {convex ? (
          <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
            {children}
          </ConvexProviderWithClerk>
        ) : (
          children
        )}
      </ClerkProvider>
    </>
  );
}
