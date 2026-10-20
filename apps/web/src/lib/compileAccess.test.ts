import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  fetchQuery: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
}));

vi.mock("convex/nextjs", () => ({
  fetchQuery: mocks.fetchQuery,
}));

import {
  authorizeCompileRequest,
  canAccessCompileProject,
  ownsCompileJob,
  type CompilePrincipal,
} from "@/lib/compileAccess";

const LOCAL_ORIGIN = "http://localhost:3000";
const CONVEX_URL = "https://abc123.convex.cloud";
const CLERK_KEY = "sk_test_abc123xyz";

function stubLocalEnv(origin = LOCAL_ORIGIN): void {
  vi.stubEnv("ALOVE_LOCAL_COMPILE_ORIGIN", origin);
  vi.stubEnv("CLERK_SECRET_KEY", CLERK_KEY);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", CONVEX_URL);
}

function stubCloudEnv(): void {
  vi.stubEnv("ALOVE_LOCAL_COMPILE_ORIGIN", "");
  vi.stubEnv("CLERK_SECRET_KEY", CLERK_KEY);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", CONVEX_URL);
}

function authedUser(userId = "user-1", token: string | null = "convex-token") {
  return {
    userId,
    getToken: vi.fn().mockResolvedValue(token),
  };
}

function localPrincipal(): CompilePrincipal {
  return { owner: { kind: "local", origin: LOCAL_ORIGIN } };
}

function userPrincipal(
  userId = "user-1",
  token = "convex-token",
): CompilePrincipal {
  return { owner: { kind: "user", userId }, token };
}

describe("authorizeCompileRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("authorizes local requests without touching Clerk auth", async () => {
    stubLocalEnv();
    const req = new Request(`${LOCAL_ORIGIN}/api/compile`, {
      headers: { host: "localhost:3000" },
    });

    const result = await authorizeCompileRequest(req);

    expect(result.ok).toBe(true);
    expect(result.ok && result.principal).toEqual({
      owner: { kind: "local", origin: LOCAL_ORIGIN },
    });
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("rejects local cross-origin requests with 403", async () => {
    stubLocalEnv();
    const req = new Request(`${LOCAL_ORIGIN}/api/compile`, {
      headers: { origin: "http://evil.com:3000" },
    });

    const result = await authorizeCompileRequest(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
      expect(await result.response.json()).toEqual({ error: "Forbidden origin" });
    }
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("fails closed with 500 on a bad local origin", async () => {
    stubLocalEnv("http://example.com:3000");
    const req = new Request("http://example.com:3000/api/compile");

    const result = await authorizeCompileRequest(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(500);
      const body = await result.response.json();
      expect(body.error).toContain("ALOVE_LOCAL_COMPILE_ORIGIN");
    }
  });

  it("authorizes a cloud user and returns the Convex token", async () => {
    stubCloudEnv();
    const session = authedUser("user-1", "convex-token");
    mocks.auth.mockResolvedValue(session);
    const req = new Request("https://app.example.com/api/compile", {
      headers: { host: "app.example.com" },
    });

    const result = await authorizeCompileRequest(req);

    expect(result.ok).toBe(true);
    expect(result.ok && result.principal).toEqual({
      owner: { kind: "user", userId: "user-1" },
      token: "convex-token",
    });
    expect(session.getToken).toHaveBeenCalledWith({ template: "convex" });
  });

  it("rejects cloud cross-origin requests with 403 before auth", async () => {
    stubCloudEnv();
    mocks.auth.mockResolvedValue(authedUser());
    const req = new Request("https://app.example.com/api/compile", {
      headers: { host: "app.example.com", origin: "https://evil.com" },
    });

    const result = await authorizeCompileRequest(req);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("returns 401 when Clerk has no user", async () => {
    stubCloudEnv();
    mocks.auth.mockResolvedValue({ userId: null });
    const req = new Request("https://app.example.com/api/compile");

    const result = await authorizeCompileRequest(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      expect(await result.response.json()).toEqual({ error: "Unauthorized" });
    }
  });

  it("returns 401 when the Convex token is missing", async () => {
    stubCloudEnv();
    mocks.auth.mockResolvedValue(authedUser("user-1", null));
    const req = new Request("https://app.example.com/api/compile");

    const result = await authorizeCompileRequest(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      expect(await result.response.json()).toEqual({
        error: "Convex authentication required",
      });
    }
  });

  it("returns 503 when auth() throws", async () => {
    stubCloudEnv();
    mocks.auth.mockRejectedValue(new Error("clerk down"));
    const req = new Request("https://app.example.com/api/compile");

    const result = await authorizeCompileRequest(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(503);
      expect(await result.response.json()).toEqual({
        error: "Authentication unavailable",
      });
    }
  });

  it("returns 503 when getToken() throws", async () => {
    stubCloudEnv();
    mocks.auth.mockResolvedValue({
      userId: "user-1",
      getToken: vi.fn().mockRejectedValue(new Error("convex down")),
    });
    const req = new Request("https://app.example.com/api/compile");

    const result = await authorizeCompileRequest(req);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(503);
  });

  it("fails closed with 500 when cloud env is missing", async () => {
    vi.stubEnv("ALOVE_LOCAL_COMPILE_ORIGIN", "");
    vi.stubEnv("CLERK_SECRET_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", CONVEX_URL);
    const req = new Request("https://app.example.com/api/compile");

    const result = await authorizeCompileRequest(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(500);
      const body = await result.response.json();
      expect(body.error).toContain("CLERK_SECRET_KEY");
    }
    expect(mocks.auth).not.toHaveBeenCalled();
  });
});

describe("canAccessCompileProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", CONVEX_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lets local principals through without a Convex read", async () => {
    await expect(
      canAccessCompileProject(localPrincipal(), "project-1"),
    ).resolves.toBe(true);
    expect(mocks.fetchQuery).not.toHaveBeenCalled();
  });

  it("passes the user token and Convex url to projects.get", async () => {
    mocks.fetchQuery.mockResolvedValue({ ownerId: "user-1" });

    await expect(
      canAccessCompileProject(userPrincipal("user-1", "tok-123"), "project-1"),
    ).resolves.toBe(true);

    expect(mocks.fetchQuery).toHaveBeenCalledTimes(1);
    const [, args, opts] = mocks.fetchQuery.mock.calls[0] as [
      unknown,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(args).toEqual({ projectId: "project-1" });
    expect(opts).toEqual({ token: "tok-123", url: CONVEX_URL });
  });

  it("denies projects owned by another user", async () => {
    mocks.fetchQuery.mockResolvedValue({ ownerId: "someone-else" });

    await expect(
      canAccessCompileProject(userPrincipal("user-1"), "project-1"),
    ).resolves.toBe(false);
  });

  it("denies missing or revoked projects", async () => {
    mocks.fetchQuery.mockResolvedValue(null);

    await expect(
      canAccessCompileProject(userPrincipal("user-1"), "missing"),
    ).resolves.toBe(false);
  });
});

describe("ownsCompileJob", () => {
  it("matches a local job only on the same origin", () => {
    expect(
      ownsCompileJob(localPrincipal(), { kind: "local", origin: LOCAL_ORIGIN }),
    ).toBe(true);
    expect(
      ownsCompileJob(localPrincipal(), {
        kind: "local",
        origin: "http://127.0.0.1:3000",
      }),
    ).toBe(false);
  });

  it("matches a user job only on the same userId", () => {
    expect(
      ownsCompileJob(userPrincipal("user-1"), { kind: "user", userId: "user-1" }),
    ).toBe(true);
    expect(
      ownsCompileJob(userPrincipal("user-1"), { kind: "user", userId: "user-2" }),
    ).toBe(false);
  });

  it("never mixes local and user owners", () => {
    expect(
      ownsCompileJob(localPrincipal(), { kind: "user", userId: "user-1" }),
    ).toBe(false);
    expect(
      ownsCompileJob(userPrincipal("user-1"), {
        kind: "local",
        origin: LOCAL_ORIGIN,
      }),
    ).toBe(false);
  });
});
