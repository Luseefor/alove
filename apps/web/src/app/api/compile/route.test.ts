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
import { COMPILE_REQUEST_LIMITS } from "@alove/protocol";

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
    expect(body.error).toContain("file content must be a string");
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

  it.each([
    ["top-level null", "null"],
    ["top-level array", "[]"],
    ["files null", JSON.stringify({ ...validPayload(), files: null })],
    ["files array", JSON.stringify({ ...validPayload(), files: [] })],
    ["files string", JSON.stringify({ ...validPayload(), files: "main.tex" })],
  ])("rejects %s with 400 without enqueue", async (_label, raw) => {
    const req = new Request("http://localhost/api/compile", {
      method: "POST",
      body: raw,
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it.each([
    [
      "texliveImage",
      { ...validPayload(), texliveImage: "texlive/texlive:latest" },
    ],
    [
      "latexmkExtraArgs",
      { ...validPayload(), latexmkExtraArgs: ["-shell-escape"] },
    ],
    ["owner", { ...validPayload(), owner: "user-1" }],
  ])(
    "rejects unknown field %s with 400 without enqueue",
    async (field, payload) => {
      const req = new Request("http://localhost/api/compile", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "content-type": "application/json" },
      });

      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain(`unknown field: ${field}`);
      expect(mocks.add).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["engine", { ...validPayload(), engine: "pdftex" }, "engine"],
    ["cleanAux string", { ...validPayload(), cleanAux: "yes" }, "cleanAux"],
    ["cleanAux number", { ...validPayload(), cleanAux: 1 }, "cleanAux"],
    ["timeout too small", { ...validPayload(), timeoutMs: 0 }, "timeoutMs"],
    [
      "timeout too large",
      { ...validPayload(), timeoutMs: 999_999_999 },
      "timeoutMs",
    ],
    ["timeout float", { ...validPayload(), timeoutMs: 1500.5 }, "timeoutMs"],
    ["timeout string", { ...validPayload(), timeoutMs: "60000" }, "timeoutMs"],
  ])(
    "rejects invalid %s with 400 without enqueue",
    async (_label, payload, field) => {
      const req = new Request("http://localhost/api/compile", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "content-type": "application/json" },
      });

      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toContain(field);
      expect(mocks.add).not.toHaveBeenCalled();
    },
  );

  it("queues nested + unicode payload with only allowed fields", async () => {
    const payload = {
      projectId: "project-1",
      mainFile: "chapters/main.tex",
      files: {
        "chapters/main.tex":
          "\\documentclass{article}\\begin{document}日本語 🎉 café — \\input{chapters/intro}\\end{document}",
        "chapters/intro.tex": "Café naïve — こんにちは 🌍",
      },
      engine: "lualatex",
      cleanAux: true,
      timeoutMs: 60_000,
    };

    const req = new Request("http://localhost/api/compile", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ jobId: "job-123" });
    expect(mocks.add).toHaveBeenCalledTimes(1);
    const [queueName, queued] = mocks.add.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(queueName).toBe("build");
    expect(queued).toEqual(payload);
    expect(new Set(Object.keys(queued))).toEqual(
      new Set([
        "projectId",
        "mainFile",
        "files",
        "engine",
        "cleanAux",
        "timeoutMs",
      ]),
    );
  });

  it("rejects declared Content-Length over cap with 413 without queue", async () => {
    const cap = COMPILE_REQUEST_LIMITS.maxRequestBytes;
    expect(cap).toBe(22020096);
    // Body would otherwise validate; lying header must short-circuit before parsing.
    const req = new Request("http://localhost/api/compile", {
      method: "POST",
      body: JSON.stringify({ ...validPayload(), engine: "bogus" }),
      headers: {
        "content-type": "application/json",
        "content-length": String(cap + 1),
      },
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(413);
    expect(body.error).toMatch(/too large/i);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("rejects chunked stream exceeding cap with 413 and cancels stream", async () => {
    const cap = COMPILE_REQUEST_LIMITS.maxRequestBytes;
    const chunk = new Uint8Array(1024 * 1024).fill(0x61);
    const chunksNeeded = Math.floor(cap / chunk.byteLength) + 2;
    let sent = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent < chunksNeeded) {
          sent += 1;
          controller.enqueue(chunk);
        } else {
          controller.close();
        }
      },
      cancel() {
        cancelled = true;
      },
    });

    const req = new Request("http://localhost/api/compile", {
      method: "POST",
      body: stream as unknown as BodyInit,
      headers: { "content-type": "application/json" },
      duplex: "half",
    } as RequestInit);
    expect(req.headers.get("content-length")).toBeNull();

    const res = await POST(req);
    const body = await res.json();

    expect(sent).toBeGreaterThan(0);
    expect(res.status).toBe(413);
    expect(body.error).toMatch(/too large/i);
    expect(mocks.add).not.toHaveBeenCalled();
    expect(cancelled).toBe(true);
  });
});
