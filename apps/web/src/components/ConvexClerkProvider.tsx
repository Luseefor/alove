"use client";

import Link from "next/link";
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { type ReactNode, useMemo } from "react";
import {
  isLocalStandalone,
  isPlaceholderConfigValue,
} from "@/lib/localStandalone";

const CLERK_PUBLISHABLE_PLACEHOLDER = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";

function isProtectedRoute(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === "/editor" || pathname.startsWith("/editor/")) return true;
  if (pathname === "/projects" || pathname.startsWith("/projects/"))
    return true;
  if (pathname === "/sign-in" || pathname.startsWith("/sign-in/")) return true;
  if (pathname === "/sign-up" || pathname.startsWith("/sign-up/")) return true;
  return false;
}

function isValidConvexUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function ConvexClerkProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (isLocalStandalone() || !isProtectedRoute(pathname)) {
    return <>{children}</>;
  }
  return <CloudClerkConvexProvider>{children}</CloudClerkConvexProvider>;
}

function CloudClerkConvexProvider({ children }: { children: ReactNode }) {
  const publishableKey =
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim() ?? "";
  const configErrors: string[] = [];

  if (!publishableKey) {
    configErrors.push(
      "Missing required environment variable: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    );
  } else if (
    publishableKey === CLERK_PUBLISHABLE_PLACEHOLDER ||
    isPlaceholderConfigValue(publishableKey)
  ) {
    configErrors.push(
      "Invalid NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY placeholder value",
    );
  }

  let convexUrlUsable = false;
  if (!url) {
    configErrors.push(
      "Missing required environment variable: NEXT_PUBLIC_CONVEX_URL",
    );
  } else if (isPlaceholderConfigValue(url)) {
    configErrors.push("Invalid NEXT_PUBLIC_CONVEX_URL placeholder value");
  } else if (!isValidConvexUrl(url)) {
    configErrors.push("Invalid NEXT_PUBLIC_CONVEX_URL value");
  } else {
    convexUrlUsable = true;
  }

  const convex = useMemo(() => {
    if (!convexUrlUsable) return null;
    try {
      return new ConvexReactClient(url);
    } catch {
      return null;
    }
  }, [convexUrlUsable, url]);

  if (convexUrlUsable && !convex) {
    configErrors.push("Invalid NEXT_PUBLIC_CONVEX_URL value");
  }

  if (configErrors.length > 0) {
    return (
      <div
        role="alert"
        className="m-4 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
      >
        <p className="font-semibold">Cloud auth configuration error</p>
        <ul className="mt-2 list-disc pl-5">
          {configErrors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
        <p className="mt-3">
          <Link className="underline" href="/">
            Go home
          </Link>{" "}
          <Link className="underline" href="/help">
            Get help
          </Link>
        </p>
      </div>
    );
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/projects"
      signUpFallbackRedirectUrl="/projects"
    >
      {convex ? (
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
          {children}
        </ConvexProviderWithClerk>
      ) : (
        children
      )}
    </ClerkProvider>
  );
}
