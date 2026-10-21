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

vi.mock("@alove/queue/admission", () => ({
  compileCancellationKey: (jobId: string) => `alove:compile:cancel:${jobId}`,
  releaseCompileAdmission: vi.fn(),
  reserveCompileAdmission: vi.fn(),
}));

vi.mock("@/lib/compileQueue", () => ({
  getCompileQueue: () => ({
    getJob: mocks.getJob,
    client: Promise.resolve({ set: vi.fn(), eval: vi.fn() }),
    toKey: (key: string) => `bull:compile:${key}`,
  }),
}));

import { GET } from "@/app/api/compile/[jobId]/route";
import { COMPILE_SYNCTEX_LIMITS } from "@alove/protocol";

describe("GET /api/compile/[jobId] synctex transport", () => {
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

  it("forwards a bounded synctex mapping with the completed result", async () => {
    const synctex = {
      version: 1,
      truncated: false,
      entries: [
        { file: "main.tex", line: 3, page: 1, x: 100, y: 200 },
        { file: "sections/chap.tex", line: 1, page: 2, x: 100, y: 200 },
      ],
    };
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
        synctex,
      },
    });
    const res = await GET(
      new Request("http://localhost:30128/api/compile/job-1"),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.state).toBe("completed");
    expect(body.result.synctex).toEqual(synctex);
    expect(body.result.synctex.entries.length).toBeLessThanOrEqual(
      COMPILE_SYNCTEX_LIMITS.maxEntries,
    );
  });

  it("omits synctex on results without a mapping", async () => {
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
      returnvalue: { phase: "failed", diagnostics: [], log: "bad" },
    });
    const res = await GET(
      new Request("http://localhost:30128/api/compile/job-1"),
      { params: Promise.resolve({ jobId: "job-1" }) },
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.result.synctex).toBeUndefined();
  });
});
