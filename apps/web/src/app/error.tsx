"use client";

import { SiteFailure } from "@/components/SiteFailure";

type RouteErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function RouteError({ reset }: RouteErrorProps) {
  return (
    <SiteFailure
      eyebrow="Something went wrong"
      title="This section failed to load"
      description="The page hit an error and stopped. Retry, or go back to a safe page."
      actions={[
        { href: "/", label: "Go home" },
        { href: "/projects", label: "View projects" },
        { href: "/help", label: "Get help" },
      ]}
      onRetry={reset}
      retryLabel="Try again"
    />
  );
}
