/**
 * Shared origin guard for state-changing cloud API routes (GitHub sync,
 * project invitations).
 *
 * Deployment model (see docs/release-runbook.md): production serves behind
 * Caddy with TLS while Next itself uses an internal container URL, so
 * `new URL(req.url).origin` is the container origin — never the browser's.
 * Comparing the browser `Origin` header against `req.url` therefore rejects
 * legitimate traffic in prod. The configured public site is the trust root
 * instead:
 *
 * - `ALOVE_SITE_URL` must be a bare HTTPS origin. Missing/invalid in
 *   production fails closed (every request denied); without it outside
 *   production the guard falls back to the historical exact same-origin
 *   check so localhost dev and existing tests keep working.
 * - The browser `Origin` of a state-changing call must exactly equal the
 *   public site. `X-Forwarded-Host` and friends are never read: the only
 *   Host trust is an exact match of the configured public host, and only
 *   when the explicit proxy env (`ALOVE_COMPILE_TRUST_PROXY=true`,
 *   server-only per the runbook) acknowledges the Caddy setup.
 * - GETs keep a same-origin pattern: foreign `Origin`/arbitrary `Host`
 *   signals are rejected, headerless internal calls (healthchecks, SSR)
 *   stay allowed.
 */

export type CloudApiOriginPolicy =
  | { mode: "public"; origin: string }
  | { mode: "same-origin" }
  | { error: string };

export function getCloudApiOriginPolicy(
  env: NodeJS.ProcessEnv = process.env,
): CloudApiOriginPolicy {
  const site = env.ALOVE_SITE_URL?.trim();
  if (site) {
    try {
      const parsed = new URL(site);
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        parsed.pathname !== "/"
      ) {
        throw new Error("bad site");
      }
      return { mode: "public", origin: parsed.origin };
    } catch {
      return { error: "ALOVE_SITE_URL must be an HTTPS origin" };
    }
  }
  if (env.NODE_ENV === "production") {
    return { error: "Missing required environment variable: ALOVE_SITE_URL" };
  }
  return { mode: "same-origin" };
}

export function isProxyTrusted(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ALOVE_COMPILE_TRUST_PROXY === "true";
}

function safeUrlOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function fetchSiteOk(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}

/**
 * Pure request check. `trustProxy` must come from `isProxyTrusted()` (which
 * reads the explicit server-only env); never pass `true` from client input.
 */
export function isCloudApiRequestAllowed(
  req: Request,
  policy: CloudApiOriginPolicy,
  trustProxy = false,
): boolean {
  if ("error" in policy) return false;
  const method = req.method.toUpperCase();
  const suppliedOrigin = req.headers.get("origin");
  const host = req.headers.get("host");

  if (policy.mode === "same-origin") {
    // Historical dev/test behavior: state-changing calls must carry the
    // request URL's own origin; GET stays open.
    if (method === "GET") return true;
    return suppliedOrigin !== null && suppliedOrigin === safeUrlOrigin(req.url);
  }

  const expected = policy.origin;
  let expectedHost = "";
  try {
    expectedHost = new URL(expected).host;
  } catch {
    return false;
  }
  // An arbitrary Host (including anything forwarded) is never trusted:
  // allow absent (tests, headerless callers) or the exact public host.
  if (host !== null && host !== expectedHost) return false;
  if (!fetchSiteOk(req)) return false;

  if (method === "GET") {
    return suppliedOrigin === null || suppliedOrigin === expected;
  }
  if (
    safeUrlOrigin(req.url) !== expected &&
    !(trustProxy && host === expectedHost)
  )
    return false;
  if (suppliedOrigin !== null) return suppliedOrigin === expected;
  // No browser Origin (non-browser client): allow only verifiably same-site
  // targets — the request URL itself, or (behind the acknowledged proxy)
  // the exact public Host.
  if (safeUrlOrigin(req.url) === expected) return true;
  return trustProxy && host === expectedHost;
}

/** Route entry point: resolves policy + proxy trust from env, fail-closed. */
export function authorizeCloudApiOrigin(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const policy = getCloudApiOriginPolicy(env);
  if ("error" in policy) {
    console.error(`[cloud-api] refusing request: ${policy.error}`);
    return false;
  }
  return isCloudApiRequestAllowed(req, policy, isProxyTrusted(env));
}
