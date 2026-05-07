import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getCompileAuthPolicy: vi.fn(),
  getJob: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/compileAuth", () => ({
  getCompileAuthPolicy: mocks.getCompileAuthPolicy,
}));

vi.mock("@/lib/compileQueue", () => ({
  getCompileQueue: () => ({
    getJob: mocks.getJob,
  }),
}));

import { GET } from "@/app/api/compile/[jobId]/route";

function context(jobId = "job-1") {
  return { params: Promise.resolve({ jobId }) };
}

describe("GET /api/compile/[jobId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCompileAuthPolicy.mockReturnValue({ allowAnonymous: true });
    mocks.auth.mockResolvedValue({ userId: "user-1" });
  });

  it("fails closed when auth config is invalid", async () => {
    mocks.getCompileAuthPolicy.mockReturnValue({
      error: "Missing required environment variable: CLERK_SECRET_KEY",
    });

    const res = await GET(new Request("http://localhost/api/compile/job-1"), context());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("CLERK_SECRET_KEY");
    expect(mocks.getJob).not.toHaveBeenCalled();
  });

  it("returns 401 for unauthenticated cloud polling", async () => {
    mocks.getCompileAuthPolicy.mockReturnValue({ allowAnonymous: false });
    mocks.auth.mockResolvedValue({ userId: null });

    const res = await GET(new Request("http://localhost/api/compile/job-1"), context());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("returns not found when job is missing", async () => {
    mocks.getJob.mockResolvedValue(null);

    const res = await GET(new Request("http://localhost/api/compile/missing"), context("missing"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "not found" });
  });

  it("returns completed result payload", async () => {
    mocks.getJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue("completed"),
      returnvalue: { phase: "ready", diagnostics: [], log: "", pdfBase64: "abc" },
    });

    const res = await GET(new Request("http://localhost/api/compile/job-1"), context());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.state).toBe("completed");
    expect(body.result.phase).toBe("ready");
  });

  it("returns failed state payload", async () => {
    mocks.getJob.mockResolvedValue({
      getState: vi.fn().mockResolvedValue("failed"),
      failedReason: "worker crashed",
    });

    const res = await GET(new Request("http://localhost/api/compile/job-1"), context());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ state: "failed", error: "worker crashed" });
  });
});
