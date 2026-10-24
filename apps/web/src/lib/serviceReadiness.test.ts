import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCompileAuthPolicy: vi.fn(),
  getCompileQueue: vi.fn(),
  ping: vi.fn(),
  get: vi.fn(),
  snapshot: vi.fn(),
}));

vi.mock("@vercel/sandbox", () => ({ Snapshot: { get: mocks.snapshot } }));

vi.mock("@/lib/compileAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compileAuth")>()),
  getCompileAuthPolicy: mocks.getCompileAuthPolicy,
}));

vi.mock("@/lib/compileQueue", () => ({
  getCompileQueue: mocks.getCompileQueue,
}));

import { COMPILE_HEARTBEAT_KEY } from "@alove/queue/admission";
import { serviceReadiness } from "@/lib/serviceReadiness";

const NOW = 1_700_000_000_000;

function healthyQueue() {
  mocks.getCompileQueue.mockReturnValue({
    client: Promise.resolve({ ping: mocks.ping, get: mocks.get }),
  });
}

function policyOk() {
  mocks.getCompileAuthPolicy.mockReturnValue({ allowAnonymous: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("COMPILE_RUNTIME", "");
  policyOk();
  healthyQueue();
  mocks.ping.mockResolvedValue("PONG");
  mocks.get.mockResolvedValue(String(NOW - 1_000));
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("serviceReadiness", () => {
  it.each([
    ["created", undefined, true],
    ["created", new Date(NOW + 60_000), true],
    ["created", new Date(NOW - 1), false],
    ["failed", undefined, false],
  ])(
    "checks Sandbox snapshot status %s and expiry %s",
    async (status, expiresAt, healthy) => {
      vi.stubEnv("COMPILE_RUNTIME", "vercel-sandbox");
      vi.stubEnv("COMPILE_VERCEL_SNAPSHOT_ID", "snap_readiness");
      mocks.snapshot.mockResolvedValue({ status, expiresAt });
      const result = await serviceReadiness();
      expect(result.checks.worker).toBe(healthy);
      expect(mocks.get).not.toHaveBeenCalled();
      expect(mocks.snapshot).toHaveBeenCalledWith(
        expect.objectContaining({ snapshotId: "snap_readiness" }),
      );
    },
  );

  it("fails closed when auth policy reports a config error even with healthy redis/worker", async () => {
    mocks.getCompileAuthPolicy.mockReturnValue({
      error: "Missing required environment variable: CLERK_SECRET_KEY",
    });

    const result = await serviceReadiness();

    expect(result).toEqual({
      ok: false,
      checks: { configuration: false, redis: true, worker: true },
    });
    expect(mocks.get).toHaveBeenCalledWith(COMPILE_HEARTBEAT_KEY);
  });

  it("fails closed when redis ping rejects", async () => {
    mocks.ping.mockRejectedValueOnce(new Error("redis down"));

    const result = await serviceReadiness();

    expect(result).toEqual({
      ok: false,
      checks: { configuration: true, redis: false, worker: false },
    });
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("fails closed when the queue client promise rejects", async () => {
    mocks.getCompileQueue.mockReturnValueOnce({
      client: Promise.reject(new Error("redis unavailable")),
    });

    const result = await serviceReadiness();

    expect(result).toEqual({
      ok: false,
      checks: { configuration: true, redis: false, worker: false },
    });
  });

  it("fails closed when the worker heartbeat is missing", async () => {
    mocks.get.mockResolvedValueOnce(null);

    const result = await serviceReadiness();

    expect(result.checks.redis).toBe(true);
    expect(result.checks.worker).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("fails closed when the worker heartbeat is stale", async () => {
    mocks.get.mockResolvedValueOnce(String(NOW - 30_000));

    const result = await serviceReadiness();

    expect(result).toEqual({
      ok: false,
      checks: { configuration: true, redis: true, worker: false },
    });
  });

  it("fails closed on the stale boundary (exactly 15s is not fresh)", async () => {
    mocks.get.mockResolvedValueOnce(String(NOW - 15_000));

    const result = await serviceReadiness();

    expect(result.checks.worker).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("fails closed when the worker heartbeat is in the future", async () => {
    mocks.get.mockResolvedValueOnce(String(NOW + 5_000));

    const result = await serviceReadiness();

    expect(result.checks.redis).toBe(true);
    expect(result.checks.worker).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("fails closed when the worker heartbeat is not a number", async () => {
    mocks.get.mockResolvedValueOnce("not-a-heartbeat");

    const result = await serviceReadiness();

    expect(result.checks.redis).toBe(true);
    expect(result.checks.worker).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("reports ready when configuration, redis, and a fresh heartbeat are healthy", async () => {
    mocks.get.mockResolvedValueOnce(String(NOW - 1_000));

    const result = await serviceReadiness();

    expect(result).toEqual({
      ok: true,
      checks: { configuration: true, redis: true, worker: true },
    });
    expect(mocks.ping).toHaveBeenCalledTimes(1);
    expect(mocks.get).toHaveBeenCalledWith(COMPILE_HEARTBEAT_KEY);
  });

  it("times out in bounded time and a late redis success cannot mutate the returned checks", async () => {
    vi.mocked(Date.now).mockRestore();
    const realNow = Date.now.bind(Date);

    let resolvePing!: () => void;
    let resolveHeartbeat!: (value: string) => void;
    const pingGate = new Promise<void>((resolve) => {
      resolvePing = resolve;
    });
    const heartbeatGate = new Promise<string>((resolve) => {
      resolveHeartbeat = resolve;
    });
    mocks.ping.mockReturnValueOnce(pingGate.then(() => "PONG"));
    mocks.get.mockReturnValueOnce(heartbeatGate);

    const start = realNow();
    const result = await serviceReadiness();
    const elapsed = realNow() - start;

    expect(elapsed).toBeLessThan(6_000);
    expect(result).toEqual({
      ok: false,
      checks: { configuration: true, redis: false, worker: false },
    });

    resolvePing();
    await pingGate;
    resolveHeartbeat(String(realNow()));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(result).toEqual({
      ok: false,
      checks: { configuration: true, redis: false, worker: false },
    });
  }, 10_000);
});
