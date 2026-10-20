// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { NextFetchEvent } from "next/server";

const mocks = vi.hoisted(() => ({
  clerkMiddleware: vi.fn(),
  createRouteMatcher: vi.fn(),
  protect: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: mocks.clerkMiddleware,
  createRouteMatcher: mocks.createRouteMatcher,
}));

import middleware from "../../middleware";

const VALID_SECRET = "sk_test_valid123abc456";

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`);
}

function makeEvent(): NextFetchEvent {
  return {} as unknown as NextFetchEvent;
}

function getHandler(): ReturnType<typeof vi.fn> {
  const result = mocks.clerkMiddleware.mock.results[0];
  if (!result || result.type !== "return") throw new Error("clerk handler was not created");
  return result.value as unknown as ReturnType<typeof vi.fn>;
}

type MiddlewareResult = Awaited<ReturnType<typeof middleware>>;

function expectPassThrough(res: MiddlewareResult): void {
  expect(res).toBeDefined();
  if (!res) throw new Error("expected a response");
  expect(res.status).toBe(200);
  expect(res.headers.get("x-middleware-next")).toBe("1");
}

async function expectNotConfigured(res: MiddlewareResult): Promise<void> {
  expect(res).toBeDefined();
  if (!res) throw new Error("expected a response");
  expect(res.status).toBe(503);
  expect(res.headers.get("x-middleware-next")).toBeNull();
  await expect(res.json()).resolves.toEqual({ error: "Authentication is not configured" });
}

async function expectUnavailable(res: MiddlewareResult): Promise<void> {
  expect(res).toBeDefined();
  if (!res) throw new Error("expected a response");
  expect(res.status).toBe(503);
  expect(res.headers.get("x-middleware-next")).toBeNull();
  await expect(res.json()).resolves.toEqual({ error: "Authentication unavailable" });
}

const ENV_KEYS = ["CLERK_SECRET_KEY", "NEXT_PUBLIC_LOCAL_STANDALONE", "ALOVE_LOCAL_COMPILE_ORIGIN"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  delete process.env.NEXT_PUBLIC_LOCAL_STANDALONE;
  delete process.env.ALOVE_LOCAL_COMPILE_ORIGIN;
  process.env.CLERK_SECRET_KEY = VALID_SECRET;

  vi.clearAllMocks();
  mocks.protect.mockResolvedValue(undefined);
  mocks.createRouteMatcher.mockImplementation(() => () => false);
  mocks.clerkMiddleware.mockImplementation((callback: unknown) => {
    const cb = callback as (auth: unknown, cReq: unknown) => Promise<void>;
    return vi.fn(async (r: NextRequest) => {
      await cb({ protect: mocks.protect }, r);
      return NextResponse.next();
    });
  });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("middleware fail-closed", () => {
  describe("missing or placeholder Clerk secret", () => {
    it("returns 503 for a protected UI path when the secret is missing", async () => {
      delete process.env.CLERK_SECRET_KEY;

      const res = await middleware(makeRequest("/projects"), makeEvent());

      await expectNotConfigured(res);
      expect(mocks.createRouteMatcher).not.toHaveBeenCalled();
      expect(mocks.clerkMiddleware).not.toHaveBeenCalled();
      expect(mocks.protect).not.toHaveBeenCalled();
    });

    it("returns 503 for a protected API path when the secret is empty", async () => {
      process.env.CLERK_SECRET_KEY = "";

      const res = await middleware(makeRequest("/api/private"), makeEvent());

      await expectNotConfigured(res);
      expect(mocks.clerkMiddleware).not.toHaveBeenCalled();
    });

    it("returns 503 for a whitespace-only secret", async () => {
      process.env.CLERK_SECRET_KEY = "   ";

      const res = await middleware(makeRequest("/projects"), makeEvent());

      await expectNotConfigured(res);
      expect(mocks.clerkMiddleware).not.toHaveBeenCalled();
    });

    it.each([
      ["placeholder word", "placeholder"],
      ["embedded placeholder", "sk_test_placeholder_key"],
      ["changeme", "sk_test_changeme_value"],
      ["example domain", "https://example.com/clerk-key"],
      ["your- prefix", "your-clerk-secret-key"],
      ["uppercase with padding", "  PLACEHOLDER  "],
    ])("returns 503 for placeholder secret (%s)", async (_label, secret) => {
      process.env.CLERK_SECRET_KEY = secret;

      const res = await middleware(makeRequest("/projects"), makeEvent());

      await expectNotConfigured(res);
      expect(mocks.clerkMiddleware).not.toHaveBeenCalled();
      expect(mocks.protect).not.toHaveBeenCalled();
    });
  });

  describe("Clerk failure", () => {
    it("returns 503 when clerkMiddleware throws", async () => {
      mocks.clerkMiddleware.mockImplementation(() => {
        throw new Error("clerk down");
      });

      const res = await middleware(makeRequest("/projects"), makeEvent());

      await expectUnavailable(res);
      expect(mocks.protect).not.toHaveBeenCalled();
    });

    it("returns 503 when createRouteMatcher throws", async () => {
      mocks.createRouteMatcher.mockImplementation(() => {
        throw new Error("matcher down");
      });

      const res = await middleware(makeRequest("/projects"), makeEvent());

      await expectUnavailable(res);
      expect(mocks.clerkMiddleware).not.toHaveBeenCalled();
      expect(mocks.protect).not.toHaveBeenCalled();
    });

    it("returns 503 when the Clerk handler rejects", async () => {
      mocks.clerkMiddleware.mockImplementation(() => {
        return vi.fn(async () => {
          throw new Error("handler rejected");
        });
      });

      const res = await middleware(makeRequest("/projects"), makeEvent());

      await expectUnavailable(res);
      expect(mocks.protect).not.toHaveBeenCalled();
    });
  });

  describe("cloud enforcement", () => {
    it("calls protect for a protected path and forwards the same request and event", async () => {
      const req = makeRequest("/projects");
      const evt = makeEvent();

      const res = await middleware(req, evt);

      expectPassThrough(res);
      expect(mocks.createRouteMatcher).toHaveBeenCalledTimes(1);
      expect(mocks.createRouteMatcher).toHaveBeenCalledWith([
        "/",
        "/sign-in(.*)",
        "/sign-up(.*)",
        "/api/webhooks(.*)",
      ]);
      expect(mocks.clerkMiddleware).toHaveBeenCalledTimes(1);
      expect(mocks.protect).toHaveBeenCalledTimes(1);
      const handler = getHandler();
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toBe(req);
      expect(handler.mock.calls[0][1]).toBe(evt);
    });

    it("allows public pages without requiring Clerk context", async () => {
      mocks.createRouteMatcher.mockImplementation(() => () => true);
      const req = makeRequest("/");
      const evt = makeEvent();

      const res = await middleware(req, evt);

      expectPassThrough(res);
      expect(mocks.clerkMiddleware).not.toHaveBeenCalled();
      expect(mocks.protect).not.toHaveBeenCalled();
    });

    it.each(["/api/compile", "/api/compile/job-123"])(
      "runs the Clerk handler without protect for compile route %s in cloud",
      async (path) => {
        const req = makeRequest(path);
        const evt = makeEvent();

        const res = await middleware(req, evt);

        expectPassThrough(res);
        expect(mocks.clerkMiddleware).toHaveBeenCalledTimes(1);
        expect(mocks.protect).not.toHaveBeenCalled();
        const handler = getHandler();
        expect(handler.mock.calls[0][0]).toBe(req);
        expect(handler.mock.calls[0][1]).toBe(evt);
      },
    );
  });

  describe("PUBLIC local flag", () => {
    it.each(["true", "1"])("passes a non-API page through without Clerk when flag is %s", async (flag) => {
      process.env.NEXT_PUBLIC_LOCAL_STANDALONE = flag;
      delete process.env.CLERK_SECRET_KEY;

      const res = await middleware(makeRequest("/editor"), makeEvent());

      expectPassThrough(res);
      expect(mocks.createRouteMatcher).not.toHaveBeenCalled();
      expect(mocks.clerkMiddleware).not.toHaveBeenCalled();
    });

    it("does not bypass the compile API with the PUBLIC flag alone when unconfigured", async () => {
      process.env.NEXT_PUBLIC_LOCAL_STANDALONE = "true";
      delete process.env.CLERK_SECRET_KEY;

      const res = await middleware(makeRequest("/api/compile"), makeEvent());

      await expectNotConfigured(res);
      expect(mocks.clerkMiddleware).not.toHaveBeenCalled();
    });

    it("still runs the Clerk handler for the compile API with the PUBLIC flag alone when configured", async () => {
      process.env.NEXT_PUBLIC_LOCAL_STANDALONE = "true";
      const req = makeRequest("/api/compile");
      const evt = makeEvent();

      const res = await middleware(req, evt);

      expectPassThrough(res);
      expect(mocks.clerkMiddleware).toHaveBeenCalledTimes(1);
      expect(mocks.protect).not.toHaveBeenCalled();
      const handler = getHandler();
      expect(handler.mock.calls[0][0]).toBe(req);
      expect(handler.mock.calls[0][1]).toBe(evt);
    });

    it("does not bypass an arbitrary API with the PUBLIC flag alone", async () => {
      process.env.NEXT_PUBLIC_LOCAL_STANDALONE = "true";
      const req = makeRequest("/api/private");
      const evt = makeEvent();

      const res = await middleware(req, evt);

      expectPassThrough(res);
      expect(mocks.protect).toHaveBeenCalledTimes(1);
      const handler = getHandler();
      expect(handler.mock.calls[0][0]).toBe(req);
      expect(handler.mock.calls[0][1]).toBe(evt);
    });
  });

  describe("server local origin", () => {
    it.each(["/api/compile", "/api/compile/job-123"])(
      "passes compile route %s through without Clerk when the server flag is set",
      async (path) => {
        process.env.ALOVE_LOCAL_COMPILE_ORIGIN = "http://localhost:3000";
        delete process.env.CLERK_SECRET_KEY;

        const res = await middleware(makeRequest(path), makeEvent());

        expectPassThrough(res);
        expect(mocks.createRouteMatcher).not.toHaveBeenCalled();
        expect(mocks.clerkMiddleware).not.toHaveBeenCalled();
      },
    );

    it("does not bypass an arbitrary API with the server flag when unconfigured", async () => {
      process.env.ALOVE_LOCAL_COMPILE_ORIGIN = "http://localhost:3000";
      delete process.env.CLERK_SECRET_KEY;

      const res = await middleware(makeRequest("/api/other"), makeEvent());

      await expectNotConfigured(res);
      expect(mocks.clerkMiddleware).not.toHaveBeenCalled();
    });

    it("still calls protect for an arbitrary API with the server flag when configured", async () => {
      process.env.ALOVE_LOCAL_COMPILE_ORIGIN = "http://localhost:3000";
      const req = makeRequest("/api/other");
      const evt = makeEvent();

      const res = await middleware(req, evt);

      expectPassThrough(res);
      expect(mocks.protect).toHaveBeenCalledTimes(1);
      const handler = getHandler();
      expect(handler.mock.calls[0][0]).toBe(req);
      expect(handler.mock.calls[0][1]).toBe(evt);
    });
  });

  describe("health", () => {
    it("passes health through without Clerk when unconfigured", async () => {
      delete process.env.CLERK_SECRET_KEY;

      const res = await middleware(makeRequest("/api/health"), makeEvent());

      expectPassThrough(res);
      expect(mocks.clerkMiddleware).not.toHaveBeenCalled();
    });

    it("passes health through with a placeholder secret", async () => {
      process.env.CLERK_SECRET_KEY = "placeholder-key";

      const res = await middleware(makeRequest("/api/health"), makeEvent());

      expectPassThrough(res);
      expect(mocks.clerkMiddleware).not.toHaveBeenCalled();
    });
  });
});
