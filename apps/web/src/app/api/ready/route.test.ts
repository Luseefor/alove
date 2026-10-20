import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serviceReadiness: vi.fn(),
}));

vi.mock("@/lib/serviceReadiness", () => ({
  serviceReadiness: mocks.serviceReadiness,
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/ready", () => {
  it("returns 200 with no-store when all checks are ready", async () => {
    const ready = {
      ok: true,
      checks: { configuration: true, redis: true, worker: true },
    };
    mocks.serviceReadiness.mockResolvedValueOnce(ready);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual(ready);
  });

  it("returns 503 with no-store when any check fails", async () => {
    const degraded = {
      ok: false,
      checks: { configuration: true, redis: true, worker: false },
    };
    mocks.serviceReadiness.mockResolvedValueOnce(degraded);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual(degraded);
  });
});
