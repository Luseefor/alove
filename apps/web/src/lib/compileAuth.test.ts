import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import {
  getCompileAuthPolicy,
  isCompileRequestOriginAllowed,
} from "@/lib/compileAuth";

const CLOUD_ENV = {
  CLERK_SECRET_KEY: "sk_test_abc123xyz",
  NEXT_PUBLIC_CONVEX_URL: "https://abc123.convex.cloud",
};

function makeEnv(overrides: Partial<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ALOVE_LOCAL_COMPILE_ORIGIN: "",
    NEXT_PUBLIC_LOCAL_STANDALONE: "false",
    ...CLOUD_ENV,
    ...overrides,
  };
}

function makeRequest(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("getCompileAuthPolicy", () => {
  it("enables anonymous for an exact canonical localhost origin with port", () => {
    const policy = getCompileAuthPolicy(
      makeEnv({ ALOVE_LOCAL_COMPILE_ORIGIN: "http://localhost:3000" }),
    );

    expect(policy).toEqual({
      allowAnonymous: true,
      origin: "http://localhost:3000",
    });
  });

  it.each([
    "http://127.0.0.1:3001",
    "http://[::1]:3000",
    "https://localhost:3000",
  ])("enables anonymous for loopback origin %s", (origin) => {
    expect(getCompileAuthPolicy(makeEnv({ ALOVE_LOCAL_COMPILE_ORIGIN: origin }))).toEqual({
      allowAnonymous: true,
      origin,
    });
  });

  it.each([
    ["missing port", "http://localhost"],
    ["trailing slash", "http://localhost:3000/"],
    ["path suffix", "http://localhost:3000/api"],
    ["query string", "http://localhost:3000?x=1"],
    ["non-loopback host", "http://example.com:3000"],
    ["trailing-dot host", "http://localhost.:3000"],
    ["wrong protocol", "ftp://localhost:3000"],
    ["uppercase host", "http://LOCALHOST:3000"],
    ["credentials", "http://user@localhost:3000"],
    ["default port dropped", "http://localhost:80"],
    ["not a url", "not-a-url"],
  ])("rejects bad local origin (%s)", (_label, origin) => {
    expect(
      getCompileAuthPolicy(makeEnv({ ALOVE_LOCAL_COMPILE_ORIGIN: origin })),
    ).toEqual({
      error: "ALOVE_LOCAL_COMPILE_ORIGIN must be an exact loopback origin with a port",
    });
  });

  it("never authorizes from NEXT_PUBLIC_LOCAL_STANDALONE alone", () => {
    const policy = getCompileAuthPolicy(
      makeEnv({
        NEXT_PUBLIC_LOCAL_STANDALONE: "true",
        ALOVE_LOCAL_COMPILE_ORIGIN: "",
      }),
    );

    expect(policy).toEqual({ allowAnonymous: false });
  });

  it("fails closed when the standalone flag is set but cloud env is missing", () => {
    const policy = getCompileAuthPolicy(
      makeEnv({
        NEXT_PUBLIC_LOCAL_STANDALONE: "true",
        ALOVE_LOCAL_COMPILE_ORIGIN: "",
        CLERK_SECRET_KEY: "",
      }),
    );

    expect(policy).toEqual({
      error: "Missing required environment variable: CLERK_SECRET_KEY",
    });
  });

  it("requires a user when Clerk and Convex are configured", () => {
    expect(getCompileAuthPolicy(makeEnv({}))).toEqual({ allowAnonymous: false });
  });

  it("fails closed when Clerk secret is missing", () => {
    expect(
      getCompileAuthPolicy(makeEnv({ CLERK_SECRET_KEY: "" })),
    ).toEqual({
      error: "Missing required environment variable: CLERK_SECRET_KEY",
    });
  });

  it("fails closed when Convex url is missing", () => {
    expect(
      getCompileAuthPolicy(makeEnv({ NEXT_PUBLIC_CONVEX_URL: "" })),
    ).toEqual({
      error: "Missing required environment variable: NEXT_PUBLIC_CONVEX_URL",
    });
  });

  it("fails closed on placeholder Clerk secret", () => {
    expect(
      getCompileAuthPolicy(
        makeEnv({ CLERK_SECRET_KEY: "sk_test_placeholder_value" }),
      ),
    ).toEqual({ error: "Invalid CLERK_SECRET_KEY placeholder value" });
  });

  it.each([
    ["example domain", "https://example.com"],
    ["changeme", "https://changeme-convex.cloud"],
    ["your- prefix", "https://your-convex-url.convex.cloud"],
  ])("fails closed on placeholder Convex url (%s)", (_label, url) => {
    expect(
      getCompileAuthPolicy(makeEnv({ NEXT_PUBLIC_CONVEX_URL: url })),
    ).toEqual({ error: "Invalid NEXT_PUBLIC_CONVEX_URL placeholder value" });
  });
});

describe("isCompileRequestOriginAllowed", () => {
  const origin = "http://localhost:3000";

  it("allows a same-origin request with matching host and origin", () => {
    const req = makeRequest("http://localhost:3000/api/compile", {
      host: "localhost:3000",
      origin,
      "sec-fetch-site": "same-origin",
    });

    expect(isCompileRequestOriginAllowed(req, origin)).toBe(true);
  });

  it("allows requests with no optional headers when the url matches", () => {
    const req = makeRequest("http://localhost:3000/api/compile");

    expect(isCompileRequestOriginAllowed(req, origin)).toBe(true);
  });

  it("rejects a request url on another origin", () => {
    const req = makeRequest("http://evil.com:3000/api/compile");

    expect(isCompileRequestOriginAllowed(req, origin)).toBe(false);
  });

  it("rejects a mismatched host header", () => {
    const req = makeRequest("http://localhost:3000/api/compile", {
      host: "evil.com:3000",
    });

    expect(isCompileRequestOriginAllowed(req, origin)).toBe(false);
  });

  it("rejects a cross-origin Origin header in local mode", () => {
    const req = makeRequest("http://localhost:3000/api/compile", {
      origin: "http://evil.com:3000",
    });

    expect(isCompileRequestOriginAllowed(req, origin)).toBe(false);
  });

  it("rejects a cross-origin Origin header in cloud mode", () => {
    const cloudOrigin = "https://app.example.com";
    const req = makeRequest("https://app.example.com/api/compile", {
      host: "app.example.com",
      origin: "https://evil.com",
    });

    expect(isCompileRequestOriginAllowed(req, cloudOrigin)).toBe(false);
  });

  it.each(["cross-site", "same-site"])(
    "rejects sec-fetch-site %s",
    (site) => {
      const req = makeRequest("http://localhost:3000/api/compile", {
        "sec-fetch-site": site,
      });

      expect(isCompileRequestOriginAllowed(req, origin)).toBe(false);
    },
  );

  it("allows sec-fetch-site none", () => {
    const req = makeRequest("http://localhost:3000/api/compile", {
      "sec-fetch-site": "none",
    });

    expect(isCompileRequestOriginAllowed(req, origin)).toBe(true);
  });
});


describe("Next loopback normalization", () => {
  it("keeps the browser Host distinct from normalized NextRequest.url", () => {
    const req = new NextRequest("http://127.0.0.1:30128/api/compile", {
      headers: { host: "127.0.0.1:30128", origin: "http://127.0.0.1:30128", "sec-fetch-site": "same-origin" },
    });
    expect(new URL(req.url).hostname).toBe("localhost");
    expect(isCompileRequestOriginAllowed(req, "http://127.0.0.1:30128")).toBe(true);
    expect(isCompileRequestOriginAllowed(req, "http://localhost:30128")).toBe(false);
  });
  it("rejects a forged foreign Host even when the Next URL is loopback", () => {
    const req = new NextRequest("http://127.0.0.1:30128/api/compile", { headers: { host: "evil.test:30128" } });
    expect(isCompileRequestOriginAllowed(req, "http://127.0.0.1:30128")).toBe(false);
  });
});
