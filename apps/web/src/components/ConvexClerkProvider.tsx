"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { type ReactNode, useMemo } from "react";
import {
  isLocalStandalone,
  isPlaceholderConfigValue,
} from "@/lib/localStandalone";

const CLERK_PUBLISHABLE_PLACEHOLDER = "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k";

export function ConvexClerkProvider({ children }: { children: ReactNode }) {
  const localStandalone = isLocalStandalone();
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim() ?? "";
  const url = process.env.NEXT_PUBLIC_CONVEX_URL?.trim() ?? "";
  const configErrors: string[] = [];

  if (!localStandalone) {
    if (!publishableKey) {
      configErrors.push(
        "Missing required environment variable: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
      );
    }
    if (
      publishableKey === CLERK_PUBLISHABLE_PLACEHOLDER ||
      isPlaceholderConfigValue(publishableKey)
    ) {
      configErrors.push(
        "Invalid NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY placeholder value",
      );
    }
    if (!url) {
      configErrors.push("Missing required environment variable: NEXT_PUBLIC_CONVEX_URL");
    }
    if (isPlaceholderConfigValue(url)) {
      configErrors.push("Invalid NEXT_PUBLIC_CONVEX_URL placeholder value");
    }
  }

  const convex = useMemo(() => {
    if (!url) return null;
    return new ConvexReactClient(url);
  }, [url]);

  if (configErrors.length > 0) {
    return (
      <div className="m-4 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        <p className="font-semibold">Cloud auth configuration error</p>
        <ul className="mt-2 list-disc pl-5">
          {configErrors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <ClerkProvider publishableKey={publishableKey}>
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
