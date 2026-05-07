import type { AuthConfig } from "convex/server";

const localStandalone =
  process.env.NEXT_PUBLIC_LOCAL_STANDALONE === "true" ||
  process.env.NEXT_PUBLIC_LOCAL_STANDALONE === "1";
const domain = process.env.CLERK_JWT_ISSUER_DOMAIN?.trim() ?? "";

if (!localStandalone) {
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
}

export default {
  providers: domain
    ? [
        {
          domain,
          applicationID: "convex",
        },
      ]
    : [],
} satisfies AuthConfig;
