// @vitest-environment node
import { gzipSync } from "node:zlib";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  create: vi.fn(),
  createUser: vi.fn(),
  stop: vi.fn(),
  read: vi.fn(),
  mkdir: vi.fn(),
  write: vi.fn(),
  compile: vi.fn(),
}));
vi.mock("@vercel/sandbox", () => ({ Sandbox: { create: mock.create } }));
import { runVercelCompile } from "./vercelCompile";

const request = {
  projectId: "project",
  mainFile: "chapters/main.tex",
  files: {
    "chapters/main.tex":
      "\\documentclass{article}\\begin{document}Hello\\end{document}",
    "photo.png": "data:image/png;base64,aGVsbG8=",
    "chapters/main.pdf": "forged output",
  },
};

function artifact(data: Buffer | string | null) {
  return {
    exitCode: 0,
    stdout: async () =>
      JSON.stringify(
        data === null
          ? null
          : { data: Buffer.from(data).toString("base64"), truncated: false },
      ),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.COMPILE_VERCEL_SNAPSHOT_ID = "snap_test123";
  mock.create.mockResolvedValue({
    createUser: mock.createUser,
    stop: mock.stop,
    runCommand: mock.read,
  });
  mock.stop.mockResolvedValue(undefined);
  mock.createUser.mockResolvedValue({
    mkDir: mock.mkdir,
    writeFiles: mock.write,
    runCommand: mock.compile,
  });
  mock.compile.mockResolvedValue({ exitCode: 0 });
  mock.read.mockImplementation(async (_cmd, args: string[]) => {
    const path = args[3];
    return artifact(
      path.endsWith(".pdf")
        ? "%PDF-test"
        : path.endsWith(".gz")
          ? gzipSync(
              "SyncTeX Version:1\nInput:1:/home/texjob/project/chapters/main.tex\nContent:\n{1\nx1,1:100,200\n}1\nPostamble:\n",
            )
          : "Build succeeded",
    );
  });
});

describe("Vercel compile boundary", () => {
  it("creates a fresh offline VM without credentials, decodes assets, rejects supplied artifacts and preserves SyncTeX", async () => {
    process.env.CLERK_SECRET_KEY = "never-copy-this";
    const result = await runVercelCompile(request);
    expect(result.phase).toBe("ready");
    expect(mock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        persistent: false,
        networkPolicy: "deny-all",
        resources: { vcpus: 1 },
        source: { type: "snapshot", snapshotId: "snap_test123" },
      }),
    );
    expect(mock.create.mock.calls[0][0]).not.toHaveProperty("env");
    expect(mock.createUser).toHaveBeenCalledWith("texjob", expect.anything());
    const files = mock.write.mock.calls[0][0];
    expect(files).toHaveLength(2);
    expect(
      files
        .find((file: { path: string }) => file.path.endsWith("photo.png"))
        .content.toString(),
    ).toBe("hello");
    expect(mock.compile.mock.calls[0][0].args).toEqual(
      expect.arrayContaining([
        "-norc",
        "-no-shell-escape",
        "-latexoption=-synctex=1",
        "./chapters/main.tex",
      ]),
    );
    expect(mock.compile.mock.calls[0][0].env).not.toHaveProperty(
      "CLERK_SECRET_KEY",
    );
    expect(result.synctex?.entries[0]).toMatchObject({
      file: "chapters/main.tex",
      line: 1,
      page: 1,
    });
    expect(result.environment).toMatchObject({
      mode: "sandbox",
      runtimeId: "snap_test123",
    });
    expect(mock.stop).toHaveBeenCalledOnce();
    delete process.env.CLERK_SECRET_KEY;
  });

  it("rejects unsafe paths before allocating a VM", async () => {
    const result = await runVercelCompile({
      ...request,
      mainFile: "../main.tex",
    });
    expect(result.errorCode).toBe("VALIDATION_ERROR");
    expect(mock.create).not.toHaveBeenCalled();
  });

  it("requires an explicit immutable snapshot", async () => {
    delete process.env.COMPILE_VERCEL_SNAPSHOT_ID;
    expect((await runVercelCompile(request)).phase).toBe("failed");
    expect(mock.create).not.toHaveBeenCalled();
  });

  it("rejects a project that exceeds the Function request budget", async () => {
    const files = Object.fromEntries(
      [0, 1, 2, 3].map((n) => [`${n}.tex`, "a".repeat(800_000)]),
    );
    expect(
      (await runVercelCompile({ ...request, mainFile: "0.tex", files }))
        .errorCode,
    ).toBe("VALIDATION_ERROR");
    expect(mock.create).not.toHaveBeenCalled();
  });

  it("always stops the VM on invalid asset data", async () => {
    const result = await runVercelCompile({
      ...request,
      files: { ...request.files, "bad.png": "data:image/png;base64,invalid" },
    });
    expect(result.phase).toBe("failed");
    expect(mock.compile).not.toHaveBeenCalled();
    expect(mock.stop).toHaveBeenCalledOnce();
  });

  it("reports TeX errors without reading a partial PDF", async () => {
    mock.compile.mockResolvedValue({ exitCode: 12 });
    const result = await runVercelCompile(request);
    expect(result.errorCode).toBe("LATEX_ERROR");
    expect(mock.read).toHaveBeenCalledTimes(1);
    expect(mock.stop).toHaveBeenCalledOnce();
  });

  it("rejects invalid PDF output", async () => {
    mock.read.mockResolvedValue(artifact("not a PDF"));
    expect((await runVercelCompile(request)).errorCode).toBe("LATEX_ERROR");
    expect(mock.stop).toHaveBeenCalledOnce();
  });

  it("fails closed when an artifact reader rejects a symlink, FIFO or oversized output", async () => {
    mock.read.mockResolvedValue({ exitCode: 1 });
    expect((await runVercelCompile(request)).phase).toBe("failed");
    expect(mock.stop).toHaveBeenCalledOnce();
  });

  it("stops and returns cancellation when aborted during execution", async () => {
    const controller = new AbortController();
    mock.compile.mockImplementation(async () => {
      controller.abort();
      throw new Error("stopped");
    });
    expect((await runVercelCompile(request, controller.signal)).errorCode).toBe(
      "CANCELLED",
    );
    expect(mock.stop).toHaveBeenCalled();
  });
});
