import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const redisSet = vi.fn();
  const redisEval = vi.fn();
  return {
    auth: vi.fn(),
    fetchQuery: vi.fn(),
    getCompileAuthPolicy: vi.fn(),
    getJob: vi.fn(),
    release: vi.fn(),
    redisSet,
    redisEval,
    redisClient: { set: redisSet, eval: redisEval },
    toKey: vi.fn((key: string) => `bull:compile:${key}`),
    cancelKey: vi.fn((jobId: string) => `alove:compile:cancel:${jobId}`),
    queueClientPromise: null as Promise<unknown> | null,
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
}));

vi.mock("convex/nextjs", () => ({ fetchQuery: mocks.fetchQuery }));

vi.mock("@/lib/compileAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/compileAuth")>()),
  getCompileAuthPolicy: mocks.getCompileAuthPolicy,
}));

vi.mock("@alove/queue/admission", () => ({
  compileCancellationKey: mocks.cancelKey,
  releaseCompileAdmission: mocks.release,
  reserveCompileAdmission: vi.fn(),
}));

vi.mock("@/lib/compileQueue", () => ({
  getCompileQueue: () => ({
    getJob: mocks.getJob,
    client: mocks.queueClientPromise ?? Promise.resolve(mocks.redisClient),
    toKey: mocks.toKey,
  }),
}));

import { DELETE, GET } from "@/app/api/compile/[jobId]/route";

function context(jobId = "job-1") {
  return { params: Promise.resolve({ jobId }) };
}

describe("GET /api/compile/[jobId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queueClientPromise = null;
    mocks.toKey.mockImplementation((key: string) => `bull:compile:${key}`);
    mocks.cancelKey.mockImplementation(
      (jobId: string) => `alove:compile:cancel:${jobId}`,
    );
    mocks.release.mockResolvedValue(undefined);
    mocks.redisSet.mockResolvedValue("OK");
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

describe("DELETE /api/compile/[jobId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queueClientPromise = null;
    mocks.toKey.mockImplementation((key: string) => `bull:compile:${key}`);
    mocks.cancelKey.mockImplementation(
      (jobId: string) => `alove:compile:cancel:${jobId}`,
    );
    mocks.release.mockResolvedValue(undefined);
    mocks.redisSet.mockResolvedValue("OK");
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

  function deletableJob(
    owner: unknown = { kind: "local", origin: "http://localhost:30128" },
    state = "waiting",
    removeImpl: () => Promise<unknown> = async () => undefined,
  ) {
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
      getState: vi.fn().mockResolvedValue(state),
      remove: vi.fn(removeImpl),
    };
  }

  function cloudDeletableJob(
    owner: unknown = { kind: "user", userId: "user-1" },
    state = "waiting",
  ) {
    return deletableJob(owner, state);
  }

  it("cancels a waiting job by the creator with remove and release", async () => {
    const job = deletableJob();
    mocks.getJob.mockResolvedValue(job);
    const res = await DELETE(
      new Request("http://localhost:30128/api/compile/job-1", {
        method: "DELETE",
      }),
      context("job-1"),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ state: "cancelled" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(job.getState).toHaveBeenCalledTimes(1);
    expect(mocks.redisSet).toHaveBeenCalledWith(
      "alove:compile:cancel:job-1",
      "1",
      "EX",
      600,
    );
    expect(job.remove).toHaveBeenCalledTimes(1);
    expect(mocks.release).toHaveBeenCalledWith(
      mocks.redisClient,
      { kind: "local", origin: "http://localhost:30128" },
      "job-1",
      "bull:compile",
    );
    expect(mocks.toKey).toHaveBeenCalledWith("");
  });

  it("cancels a cloud waiting job after creator and project checks", async () => {
    mocks.getCompileAuthPolicy.mockReturnValue({ allowAnonymous: false });
    const job = cloudDeletableJob();
    mocks.getJob.mockResolvedValue(job);
    const res = await DELETE(
      new Request("http://localhost:30128/api/compile/job-1", {
        method: "DELETE",
      }),
      context("job-1"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: "cancelled" });
    expect(mocks.fetchQuery).toHaveBeenCalledWith(
      expect.anything(),
      { projectId: "project-1" },
      expect.objectContaining({ token: "convex-jwt" }),
    );
    expect(job.remove).toHaveBeenCalledTimes(1);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });

  it("marks an active job as cancelling with 202 without remove or release", async () => {
    const job = deletableJob(
      { kind: "local", origin: "http://localhost:30128" },
      "active",
    );
    mocks.getJob.mockResolvedValue(job);
    const res = await DELETE(
      new Request("http://localhost:30128/api/compile/job-1", {
        method: "DELETE",
      }),
      context("job-1"),
    );
    const body = await res.json();
    expect(res.status).toBe(202);
    expect(body).toEqual({ state: "cancelling" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.redisSet).toHaveBeenCalledWith(
      "alove:compile:cancel:job-1",
      "1",
      "EX",
      600,
    );
    expect(job.remove).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("denies a foreign creator before state, set, remove, or release", async () => {
    mocks.getCompileAuthPolicy.mockReturnValue({ allowAnonymous: false });
    const job = cloudDeletableJob({ kind: "user", userId: "user-2" }, "waiting");
    mocks.getJob.mockResolvedValue(job);
    const res = await DELETE(
      new Request("http://localhost:30128/api/compile/job-1", {
        method: "DELETE",
      }),
      context("job-1"),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(job.getState).not.toHaveBeenCalled();
    expect(mocks.redisSet).not.toHaveBeenCalled();
    expect(job.remove).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.fetchQuery).not.toHaveBeenCalled();
  });

  it("denies revoked project access before state, set, remove, or release", async () => {
    mocks.getCompileAuthPolicy.mockReturnValue({ allowAnonymous: false });
    mocks.fetchQuery.mockResolvedValue(null);
    const job = cloudDeletableJob();
    mocks.getJob.mockResolvedValue(job);
    const res = await DELETE(
      new Request("http://localhost:30128/api/compile/job-1", {
        method: "DELETE",
      }),
      context("job-1"),
    );
    expect(res.status).toBe(404);
    expect(job.getState).not.toHaveBeenCalled();
    expect(mocks.redisSet).not.toHaveBeenCalled();
    expect(job.remove).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    {
      projectId: "project-1",
      mainFile: "main.tex",
      files: { "main.tex": "source" },
    },
    { version: 1, owner: { kind: "user", userId: "user-1" } },
  ])("denies legacy or malformed records without side effects", async (data) => {
    const job = { ...deletableJob(), data };
    mocks.getJob.mockResolvedValue(job);
    const res = await DELETE(
      new Request("http://localhost:30128/api/compile/job-1", {
        method: "DELETE",
      }),
      context("job-1"),
    );
    expect(res.status).toBe(404);
    expect(job.getState).not.toHaveBeenCalled();
    expect(mocks.redisSet).not.toHaveBeenCalled();
    expect(job.remove).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it.each(["completed", "failed"])(
    "returns already terminal %s idempotently without side effects",
    async (state) => {
      const job = deletableJob(
        { kind: "local", origin: "http://localhost:30128" },
        state,
      );
      mocks.getJob.mockResolvedValue(job);
      const res = await DELETE(
        new Request("http://localhost:30128/api/compile/job-1", {
          method: "DELETE",
        }),
        context("job-1"),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ state });
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(mocks.redisSet).not.toHaveBeenCalled();
      expect(job.remove).not.toHaveBeenCalled();
      expect(mocks.release).not.toHaveBeenCalled();
    },
  );

  it("falls back to cancelling when a waiting job turns active during remove", async () => {
    const job = deletableJob(
      { kind: "local", origin: "http://localhost:30128" },
      "waiting",
      async () => {
        throw new Error("job is now active");
      },
    );
    mocks.getJob.mockResolvedValue(job);
    const res = await DELETE(
      new Request("http://localhost:30128/api/compile/job-1", {
        method: "DELETE",
      }),
      context("job-1"),
    );
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ state: "cancelling" });
    expect(mocks.redisSet).toHaveBeenCalledTimes(1);
  });

  it("fails closed with 503 without leaking when Redis state read fails", async () => {
    const job = deletableJob();
    job.getState.mockRejectedValueOnce(new Error("redis state secret"));
    mocks.getJob.mockResolvedValue(job);
    const res = await DELETE(
      new Request("http://localhost:30128/api/compile/job-1", {
        method: "DELETE",
      }),
      context("job-1"),
    );
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("redis state secret");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("fails closed with 503 without leaking when cancel flag write fails", async () => {
    const job = deletableJob();
    mocks.getJob.mockResolvedValue(job);
    mocks.redisSet.mockRejectedValueOnce(new Error("redis set secret"));
    const res = await DELETE(
      new Request("http://localhost:30128/api/compile/job-1", {
        method: "DELETE",
      }),
      context("job-1"),
    );
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("redis set secret");
    expect(job.remove).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("requires authentication for cloud cancellation", async () => {
    mocks.getCompileAuthPolicy.mockReturnValue({ allowAnonymous: false });
    mocks.auth.mockResolvedValue({ userId: null });
    const res = await DELETE(
      new Request("http://localhost:30128/api/compile/job-1", {
        method: "DELETE",
      }),
      context("job-1"),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getJob).not.toHaveBeenCalled();
    expect(mocks.redisSet).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("denies local access to cloud jobs", async () => {
    const job = cloudDeletableJob();
    mocks.getJob.mockResolvedValue(job);
    const res = await DELETE(
      new Request("http://localhost:30128/api/compile/job-1", {
        method: "DELETE",
      }),
      context("job-1"),
    );
    expect(res.status).toBe(404);
    expect(job.getState).not.toHaveBeenCalled();
    expect(mocks.redisSet).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });
});
