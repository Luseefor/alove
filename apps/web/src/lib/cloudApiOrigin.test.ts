// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  authorizeCloudApiOrigin,
  getCloudApiOriginPolicy,
  isCloudApiRequestAllowed,
  isProxyTrusted,
  type CloudApiOriginPolicy,
} from "@/lib/cloudApiOrigin";

const PUBLIC = "https://papers.test";

function envOf(vars: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...vars } as NodeJS.ProcessEnv;
}

/** Portable request stub: explicit Host headers survive (unlike Request init in some runtimes). */
function fakeReq(
  url: string,
  method: string,
  headers: Record<string, string | undefined>,
): Request {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(headers)) {
    if (v !== undefined) map.set(k.toLowerCase(), v);
  }
  return {
    method,
    url,
    headers: { get: (name: string) => map.get(name.toLowerCase()) ?? null },
  } as unknown as Request;
}

function publicPolicy(): CloudApiOriginPolicy {
  return { mode: "public", origin: PUBLIC };
}

describe("cloudApiOrigin", () => {
  it("resolves the public policy from a bare HTTPS site", () => {
    expect(
      getCloudApiOriginPolicy(
        envOf({ ALOVE_SITE_URL: "https://papers.test/" }),
      ),
    ).toEqual({
      mode: "public",
      origin: "https://papers.test",
    });
    expect(
      getCloudApiOriginPolicy(envOf({ ALOVE_SITE_URL: "http://papers.test" })),
    ).toEqual({
      error: "ALOVE_SITE_URL must be an HTTPS origin",
    });
    expect(
      getCloudApiOriginPolicy(envOf({ ALOVE_SITE_URL: "not a url" })),
    ).toEqual({
      error: "ALOVE_SITE_URL must be an HTTPS origin",
    });
    expect(
      getCloudApiOriginPolicy(
        envOf({ ALOVE_SITE_URL: "https://papers.test/app" }),
      ),
    ).toEqual({
      error: "ALOVE_SITE_URL must be an HTTPS origin",
    });
    expect(getCloudApiOriginPolicy(envOf({ NODE_ENV: "production" }))).toEqual({
      error: "Missing required environment variable: ALOVE_SITE_URL",
    });
    expect(getCloudApiOriginPolicy(envOf({ NODE_ENV: "test" }))).toEqual({
      mode: "same-origin",
    });
  });

  it("reads the explicit proxy trust switch only", () => {
    expect(isProxyTrusted(envOf({ ALOVE_COMPILE_TRUST_PROXY: "true" }))).toBe(
      true,
    );
    expect(isProxyTrusted(envOf({ ALOVE_COMPILE_TRUST_PROXY: "1" }))).toBe(
      false,
    );
    expect(isProxyTrusted(envOf({}))).toBe(false);
  });

  it("fails closed on policy errors", () => {
    const bad: CloudApiOriginPolicy = {
      error: "Missing required environment variable: ALOVE_SITE_URL",
    };
    expect(
      isCloudApiRequestAllowed(
        fakeReq("http://localhost:3000/api", "POST", {}),
        bad,
        true,
      ),
    ).toBe(false);
    expect(
      isCloudApiRequestAllowed(fakeReq(PUBLIC, "GET", {}), bad, true),
    ).toBe(false);
  });

  it("keeps localhost dev behavior: exact same-origin POST, open GET", () => {
    const local = getCloudApiOriginPolicy(envOf({ NODE_ENV: "test" }));
    expect(
      isCloudApiRequestAllowed(
        fakeReq("http://localhost:3000/api", "POST", {
          origin: "http://localhost:3000",
        }),
        local,
      ),
    ).toBe(true);
    expect(
      isCloudApiRequestAllowed(
        fakeReq("https://alove.example/api", "POST", {
          origin: "https://alove.example",
        }),
        local,
      ),
    ).toBe(true);
    expect(
      isCloudApiRequestAllowed(
        fakeReq("https://alove.example/api", "POST", {
          origin: "https://other.example",
        }),
        local,
      ),
    ).toBe(false);
    expect(
      isCloudApiRequestAllowed(
        fakeReq("https://alove.example/api", "POST", {}),
        local,
      ),
    ).toBe(false);
    expect(
      isCloudApiRequestAllowed(
        fakeReq("http://localhost:3000/api", "GET", {}),
        local,
      ),
    ).toBe(true);
  });

  it("accepts the trusted proxy internal URL with the exact public origin", () => {
    const req = fakeReq("http://internal:3000/api/github/push", "POST", {
      origin: PUBLIC,
      host: "papers.test",
    });
    expect(isCloudApiRequestAllowed(req, publicPolicy(), true)).toBe(true);
    // An internal request URL requires explicit proxy trust, even with a public Origin.
    expect(isCloudApiRequestAllowed(req, publicPolicy(), false)).toBe(false);
  });

  it("rejects foreign origins and arbitrary hosts in public mode", () => {
    const policy = publicPolicy();
    // Foreign browser origin, even with an exact public Host behind the proxy.
    expect(
      isCloudApiRequestAllowed(
        fakeReq("http://internal:3000/api", "POST", {
          origin: "https://evil.test",
          host: "papers.test",
        }),
        policy,
        true,
      ),
    ).toBe(false);
    // Arbitrary Host is never trusted, proxy or not.
    expect(
      isCloudApiRequestAllowed(
        fakeReq("http://internal:3000/api", "POST", {
          origin: PUBLIC,
          host: "evil.test",
        }),
        policy,
        true,
      ),
    ).toBe(false);
    // Missing Origin to an internal URL is rejected without proxy trust…
    expect(
      isCloudApiRequestAllowed(
        fakeReq("http://internal:3000/api", "POST", { host: "papers.test" }),
        policy,
        false,
      ),
    ).toBe(false);
    // …and accepted with it only for the exact public host.
    expect(
      isCloudApiRequestAllowed(
        fakeReq("http://internal:3000/api", "POST", { host: "papers.test" }),
        policy,
        true,
      ),
    ).toBe(true);
    expect(
      isCloudApiRequestAllowed(
        fakeReq("http://internal:3000/api", "POST", { host: "internal:3000" }),
        policy,
        true,
      ),
    ).toBe(false);
    // A direct request URL already at the public origin needs no proxy trust.
    expect(
      isCloudApiRequestAllowed(
        fakeReq(`${PUBLIC}/api/github/push`, "POST", {}),
        policy,
        false,
      ),
    ).toBe(true);
  });

  it("ignores forwarded-host headers entirely", () => {
    const policy = publicPolicy();
    // Evil forwarded host changes nothing about a valid request.
    expect(
      isCloudApiRequestAllowed(
        fakeReq("http://internal:3000/api", "POST", {
          origin: PUBLIC,
          host: "papers.test",
          "x-forwarded-host": "evil.test",
        }),
        policy,
        true,
      ),
    ).toBe(true);
    // A forwarded public host grants nothing by itself.
    expect(
      isCloudApiRequestAllowed(
        fakeReq("http://internal:3000/api", "POST", {
          "x-forwarded-host": "papers.test",
        }),
        policy,
        true,
      ),
    ).toBe(false);
  });

  it("applies the GET same-origin pattern in public mode", () => {
    const policy = publicPolicy();
    // Headerless internal calls (healthchecks, SSR) stay allowed.
    expect(
      isCloudApiRequestAllowed(
        fakeReq("http://internal:3000/api", "GET", {}),
        policy,
      ),
    ).toBe(true);
    expect(
      isCloudApiRequestAllowed(
        fakeReq(`${PUBLIC}/api`, "GET", {
          origin: PUBLIC,
          host: "papers.test",
          "sec-fetch-site": "same-origin",
        }),
        policy,
      ),
    ).toBe(true);
    // Cross-site browser signals are rejected.
    expect(
      isCloudApiRequestAllowed(
        fakeReq(`${PUBLIC}/api`, "GET", { origin: "https://evil.test" }),
        policy,
      ),
    ).toBe(false);
    expect(
      isCloudApiRequestAllowed(
        fakeReq(`${PUBLIC}/api`, "GET", { host: "evil.test" }),
        policy,
      ),
    ).toBe(false);
    expect(
      isCloudApiRequestAllowed(
        fakeReq(`${PUBLIC}/api`, "GET", {
          origin: PUBLIC,
          "sec-fetch-site": "cross-site",
        }),
        policy,
      ),
    ).toBe(false);
  });

  it("authorizes end to end from env, failing closed on bad config", () => {
    const good = envOf({
      ALOVE_SITE_URL: "https://papers.test/",
      ALOVE_COMPILE_TRUST_PROXY: "true",
    });
    expect(
      authorizeCloudApiOrigin(
        fakeReq("http://internal:3000/api", "POST", {
          origin: PUBLIC,
          host: "papers.test",
        }),
        good,
      ),
    ).toBe(true);
    expect(
      authorizeCloudApiOrigin(
        fakeReq("http://internal:3000/api", "POST", {
          origin: "https://evil.test",
          host: "papers.test",
        }),
        good,
      ),
    ).toBe(false);
    const badSite = envOf({ ALOVE_SITE_URL: "http://papers.test" });
    expect(
      authorizeCloudApiOrigin(
        fakeReq("http://localhost:3000/api", "POST", {
          origin: "http://localhost:3000",
        }),
        badSite,
      ),
    ).toBe(false);
    const missingProd = envOf({ NODE_ENV: "production" });
    expect(
      authorizeCloudApiOrigin(
        fakeReq("http://localhost:3000/api", "POST", {
          origin: "http://localhost:3000",
        }),
        missingProd,
      ),
    ).toBe(false);
  });
});

describe("explicit proxy trust", () => {
  it("refuses an internal URL with a public Host and Origin unless proxy trust is enabled", () => {
    const request = new Request("http://web:3000/api/projects/invite", {
      method: "POST",
      headers: { host: "alove.example", origin: "https://alove.example" },
    });
    const policy = { mode: "public" as const, origin: "https://alove.example" };
    expect(isCloudApiRequestAllowed(request, policy, false)).toBe(false);
    expect(isCloudApiRequestAllowed(request, policy, true)).toBe(true);
  });
});
