import { isLocalCompileOrigin } from "@alove/protocol";
import { isPlaceholderConfigValue } from "@/lib/localStandalone";

export type CompileAuthPolicy =
  | { allowAnonymous: true; origin: string }
  | { allowAnonymous: false; origin?: string }
  | { error: string };

export function getCompileAuthPolicy(
  env: NodeJS.ProcessEnv = {
    ...process.env,
    // Convex supplies this public URL to the nested Next build. Direct member
    // access lets Next inline it into Functions where it is not a runtime env.
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
  },
): CompileAuthPolicy {
  const origin = env.ALOVE_LOCAL_COMPILE_ORIGIN;
  if (origin) {
    if (!isLocalCompileOrigin(origin))
      return {
        error:
          "ALOVE_LOCAL_COMPILE_ORIGIN must be an exact loopback origin with a port",
      };
    return { allowAnonymous: true, origin };
  }

  for (const name of ["CLERK_SECRET_KEY", "NEXT_PUBLIC_CONVEX_URL"] as const) {
    const value = env[name]?.trim() ?? "";
    if (!value)
      return { error: `Missing required environment variable: ${name}` };
    if (isPlaceholderConfigValue(value))
      return { error: `Invalid ${name} placeholder value` };
  }
  const site = env.ALOVE_SITE_URL?.trim();
  if (site) {
    try {
      const parsed = new URL(site);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") throw new Error();
      return { allowAnonymous: false, origin: parsed.origin };
    } catch { return { error: "ALOVE_SITE_URL must be an HTTPS origin" }; }
  }
  if (env.NODE_ENV === "production" || env.ALOVE_COMPILE_TRUST_PROXY === "true")
    return { error: "Missing required environment variable: ALOVE_SITE_URL" };
  return { allowAnonymous: false };
}

/** NextURL normalizes loopback names. Host preserves the browser's address. */
export function compileRequestOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("host");
  if (url.hostname === "localhost" && host) {
    try {
      const supplied = new URL(`${url.protocol}//${host}`);
      if (["localhost", "127.0.0.1", "[::1]"].includes(supplied.hostname) &&
        supplied.port === url.port && supplied.host === host)
        return supplied.origin;
    } catch {
      // The exact Host check below rejects malformed headers.
    }
  }
  return url.origin;
}

/** Header checks limit browser access. The listener must also bind to loopback. */
export function isCompileRequestOriginAllowed(
  req: Request,
  origin: string,
  trustHostHeader = false,
): boolean {
  const expected = new URL(origin);
  const suppliedOrigin = req.headers.get("origin");
  const host = req.headers.get("host");
  const site = req.headers.get("sec-fetch-site");
  return (
    (compileRequestOrigin(req) === origin || (trustHostHeader && host === expected.host)) &&
    (!host || host === expected.host) &&
    (!suppliedOrigin || suppliedOrigin === origin) &&
    (!site || site === "same-origin" || site === "none")
  );
}
