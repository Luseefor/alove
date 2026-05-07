import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getCompileAuthPolicy: vi.fn(),
  add: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
}));

vi.mock("@/lib/compileAuth", () => ({
  getCompileAuthPolicy: mocks.getCompileAuthPolicy,
}));

vi.mock("@/lib/compileQueue", () => ({
  getCompileQueue: () => ({
    add: mocks.add,
  }),
}));

import { POST } from "@/app/api/compile/route";

function validPayload() {
  return {
    projectId: "project-1",
    mainFile: "main.tex",
    files: {
      "main.tex": "\\documentclass{article}\\begin{document}Hi\\end{document}",
    },
  };
}

describe("POST /api/compile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCompileAuthPolicy.mockReturnValue({ allowAnonymous: true });
    mocks.auth.mockResolvedValue({ userId: "user-1" });
    mocks.add.mockResolvedValue({ id: "job-123" });
  });

  it("rejects invalid json", async () => {
    const req = new Request("http://localhost/api/compile", {
      method: "POST",
      body: "{invalid",
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "invalid json" });
  });

  it("rejects invalid payload shape", async () => {
    const req = new Request("http://localhost/api/compile", {
      method: "POST",
      body: JSON.stringify({
        projectId: "project-1",
        mainFile: "main.tex",
        files: { "main.tex": 123 },
      }),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("projectId, mainFile, and files");
  });

  it("fails closed when auth config is invalid", async () => {
    mocks.getCompileAuthPolicy.mockReturnValue({
      error: "Missing required environment variable: CLERK_SECRET_KEY",
    });

    const req = new Request("http://localhost/api/compile", {
      method: "POST",
      body: JSON.stringify(validPayload()),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("CLERK_SECRET_KEY");
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated cloud request", async () => {
    mocks.getCompileAuthPolicy.mockReturnValue({ allowAnonymous: false });
    mocks.auth.mockResolvedValue({ userId: null });

    const req = new Request("http://localhost/api/compile", {
      method: "POST",
      body: JSON.stringify(validPayload()),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("allows local standalone compile without auth", async () => {
    mocks.getCompileAuthPolicy.mockReturnValue({ allowAnonymous: true });

    const req = new Request("http://localhost/api/compile", {
      method: "POST",
      body: JSON.stringify(validPayload()),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ jobId: "job-123" });
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.add).toHaveBeenCalledTimes(1);
  });
});
