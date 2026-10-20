import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  fetchQuery: vi.fn(),
  getCompileAuthPolicy: vi.fn(),
  getJob: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
}));

vi.mock("convex/nextjs", () => ({ fetchQuery: mocks.fetchQuery }));

vi.mock("@/lib/compileAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compileAuth")>()),
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
    mocks.getCompileAuthPolicy.mockReturnValue({
      allowAnonymous: true,
      origin: "http://localhost:30128",
    });
    mocks.auth.mockResolvedValue({
      userId: "user-1",
      getToken: vi.fn().mockResolvedValue("convex-jwt"),
    });
    mocks.fetchQuery.mockResolvedValue({ ownerId: "user-1" });
  });

  it("fails closed when auth config is invalid", async () => {
    mocks.getCompileAuthPolicy.mockReturnValue({
      error: "Missing required environment variable: CLERK_SECRET_KEY",
    });

    const res = await GET(
      new Request("http://localhost:30128/api/compile/job-1"),
      context(),
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("CLERK_SECRET_KEY");
    expect(mocks.getJob).not.toHaveBeenCalled();
  });

  it("returns 401 for unauthenticated cloud polling", async () => {
    mocks.getCompileAuthPolicy.mockReturnValue({ allowAnonymous: false });
    mocks.auth.mockResolvedValue({ userId: null });

    const res = await GET(
      new Request("http://localhost:30128/api/compile/job-1"),
      context(),
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns not found when job is missing", async () => {
    mocks.getJob.mockResolvedValue(null);

    const res = await GET(
      new Request("http://localhost:30128/api/compile/missing"),
      context("missing"),
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "not found" });
  });

  it("returns completed result payload", async () => {
    mocks.getJob.mockResolvedValue({
      data: {
        version: 1,
        owner: { kind: "local", origin: "http://localhost:30128" },
        request: {
          projectId: "project-1",
          mainFile: "main.tex",
          files: { "main.tex": "source" },
        },
      },
      getState: vi.fn().mockResolvedValue("completed"),
      returnvalue: {
        phase: "ready",
        diagnostics: [],
        log: "",
        pdfBase64: "abc",
      },
    });

    const res = await GET(
      new Request("http://localhost:30128/api/compile/job-1"),
      context(),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.state).toBe("completed");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(body.result.phase).toBe("ready");
  });

  it("returns failed state payload", async () => {
    mocks.getJob.mockResolvedValue({
      data: {
        version: 1,
        owner: { kind: "local", origin: "http://localhost:30128" },
        request: {
          projectId: "project-1",
          mainFile: "main.tex",
          files: { "main.tex": "source" },
        },
      },
      getState: vi.fn().mockResolvedValue("failed"),
      failedReason: "worker crashed",
    });

    const res = await GET(
      new Request("http://localhost:30128/api/compile/job-1"),
      context(),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ state: "failed", error: "worker crashed" });
  });
  function cloudJob(owner: unknown = { kind: "user", userId: "user-1" }) {
    return {
      data: {
        version: 1,
        owner,
        request: {
          projectId: "project-1",
          mainFile: "main.tex",
          files: { "main.tex": "source" },
        },
      },
      getState: vi.fn().mockResolvedValue("completed"),
      returnvalue: {
        phase: "ready",
        log: "private log",
        pdfBase64: "private-pdf",
      },
    };
  }

  it("allows the creator while their project access remains valid", async () => {
    mocks.getCompileAuthPolicy.mockReturnValue({ allowAnonymous: false });
    mocks.getJob.mockResolvedValue(cloudJob());
    const res = await GET(
      new Request("http://localhost:30128/api/compile/job-1"),
      context(),
    );
    expect(res.status).toBe(200);
    expect(mocks.fetchQuery).toHaveBeenCalledWith(
      expect.anything(),
      { projectId: "project-1" },
      expect.objectContaining({ token: "convex-jwt" }),
    );
  });

  it.each(["completed", "failed", "waiting", "active"])(
    "denies a different creator before reading %s state or output",
    async (state) => {
      mocks.getCompileAuthPolicy.mockReturnValue({ allowAnonymous: false });
      const job = cloudJob({ kind: "user", userId: "user-2" });
      job.getState.mockResolvedValue(state);
      mocks.getJob.mockResolvedValue(job);
      const res = await GET(
        new Request("http://localhost:30128/api/compile/job-1"),
        context(),
      );
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not found" });
      expect(job.getState).not.toHaveBeenCalled();
      expect(mocks.fetchQuery).not.toHaveBeenCalled();
    },
  );

  it("rechecks revoked project access before returning results", async () => {
    mocks.getCompileAuthPolicy.mockReturnValue({ allowAnonymous: false });
    mocks.fetchQuery.mockResolvedValue(null);
    const job = cloudJob();
    mocks.getJob.mockResolvedValue(job);
    const res = await GET(
      new Request("http://localhost:30128/api/compile/job-1"),
      context(),
    );
    expect(res.status).toBe(404);
    expect(job.getState).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    {
      projectId: "project-1",
      mainFile: "main.tex",
      files: { "main.tex": "source" },
    },
    { version: 1, owner: { kind: "user", userId: "user-1" } },
  ])("denies legacy or malformed unowned records", async (data) => {
    const job = { ...cloudJob(), data };
    mocks.getJob.mockResolvedValue(job);
    const res = await GET(
      new Request("http://localhost:30128/api/compile/job-1"),
      context(),
    );
    expect(res.status).toBe(404);
    expect(job.getState).not.toHaveBeenCalled();
  });

  it("local access cannot read cloud jobs", async () => {
    const job = cloudJob();
    mocks.getJob.mockResolvedValue(job);
    const res = await GET(
      new Request("http://localhost:30128/api/compile/job-1"),
      context(),
    );
    expect(res.status).toBe(404);
    expect(job.getState).not.toHaveBeenCalled();
  });

  it("denies other local origins and cross-origin polling", async () => {
    const job = cloudJob({ kind: "local", origin: "http://127.0.0.1:30128" });
    mocks.getJob.mockResolvedValue(job);
    expect(
      (
        await GET(
          new Request("http://localhost:30128/api/compile/job-1"),
          context(),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await GET(
          new Request("http://localhost:30128/api/compile/job-1", {
            headers: { origin: "https://evil.test" },
          }),
          context(),
        )
      ).status,
    ).toBe(403);
    expect(job.getState).not.toHaveBeenCalled();
  });

  it("fails closed without leaking backend errors", async () => {
    mocks.getCompileAuthPolicy.mockReturnValue({ allowAnonymous: false });
    mocks.getJob.mockResolvedValue(cloudJob());
    mocks.fetchQuery.mockRejectedValue(new Error("backend private detail"));
    const res = await GET(
      new Request("http://localhost:30128/api/compile/job-1"),
      context(),
    );
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("backend private detail");
  });
});
