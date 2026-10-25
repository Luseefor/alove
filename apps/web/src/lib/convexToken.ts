type TokenSource = {
  sessionClaims?: unknown;
  getToken: (options?: { template?: string }) => Promise<string | null>;
};

/** Matches ConvexProviderWithClerk, including existing JWT-template setups. */
export function getConvexToken(session: TokenSource): Promise<string | null> {
  const claims = session.sessionClaims;
  const audience = claims !== null && typeof claims === "object" && "aud" in claims ? claims.aud : undefined;
  const native = audience === "convex" || (Array.isArray(audience) && audience.includes("convex"));
  return native ? session.getToken() : session.getToken({ template: "convex" });
}
