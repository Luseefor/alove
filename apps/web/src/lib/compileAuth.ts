import { isLocalCompileOrigin } from "@alove/protocol";
import { isPlaceholderConfigValue } from "@/lib/localStandalone";

export type CompileAuthPolicy =
  | { allowAnonymous: true; origin: string }
  | { allowAnonymous: false }
  | { error: string };

export function getCompileAuthPolicy(
  env: NodeJS.ProcessEnv = process.env,
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
): boolean {
  const expected = new URL(origin);
  const suppliedOrigin = req.headers.get("origin");
  const host = req.headers.get("host");
  const site = req.headers.get("sec-fetch-site");
  return (
    compileRequestOrigin(req) === origin &&
    (!host || host === expected.host) &&
    (!suppliedOrigin || suppliedOrigin === origin) &&
    (!site || site === "same-origin" || site === "none")
  );
}
