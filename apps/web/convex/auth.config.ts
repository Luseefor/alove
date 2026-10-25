import type { AuthConfig } from "convex/server";

// This config runs on the cloud backend. Offline mode never deploys Convex.
const domain = process.env.CLERK_JWT_ISSUER_DOMAIN?.trim() ?? "";

if (!domain) {
  throw new Error(
    "Missing required environment variable: CLERK_JWT_ISSUER_DOMAIN",
  );
}
if (
  domain.includes("placeholder") ||
  domain.includes("example.com") ||
  domain.includes("changeme")
) {
  throw new Error("Invalid CLERK_JWT_ISSUER_DOMAIN placeholder value");
}

export default {
  providers: [{ domain, applicationID: "convex" }],
} satisfies AuthConfig;
