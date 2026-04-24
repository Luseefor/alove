import type { AuthConfig } from "convex/server";

const domain = process.env.CLERK_JWT_ISSUER_DOMAIN;

if (!domain) {
  console.warn(
    "[convex] CLERK_JWT_ISSUER_DOMAIN is not set. Set it to your Clerk Frontend API URL, e.g. https://YOUR-INSTANCE.clerk.accounts.dev",
  );
}

export default {
  providers: [
    {
      domain: domain ?? "https://placeholder.invalid",
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
