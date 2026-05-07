import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pollCompileJobMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/compilePoll", () => ({
  pollCompileJob: pollCompileJobMock,
}));

import { useWorkbenchStore } from "@/stores/workbenchStore";

const fetchMock = vi.fn();

function resetStore() {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useWorkbenchStore.setState({
    projectId: "project-1",
    activeFileId: "main.tex",
    openFiles: ["main.tex"],
    filesByPath: {
      "main.tex": "\\documentclass{article}\\begin{document}hello\\end{document}",
    },
    versionsByPath: { "main.tex": 1 },
    dirtyByPath: { "main.tex": false },
  });
}

describe("workbenchStore compile flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ jobId: "job-1" }), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores pdf data and ready status on compile success", async () => {
    pollCompileJobMock.mockResolvedValue({
      phase: "ready",
      diagnostics: [],
      log: "ok",
      pdfBase64: "dGVzdA==",
    });

    await useWorkbenchStore.getState().runCompile();
    const state = useWorkbenchStore.getState();

    expect(state.buildStatus).toBe("ready");
    expect(state.pdfDataUrl).toBe("data:application/pdf;base64,dGVzdA==");
    expect(state.buildMessage).toBe("Compiled successfully");
  });

  it("stores diagnostics and failed status on compile failure", async () => {
    pollCompileJobMock.mockResolvedValue({
      phase: "failed",
      diagnostics: [{ severity: "error", message: "Bad TeX" }],
      log: "latex error",
      errorMessage: "latex failed",
    });

    await useWorkbenchStore.getState().runCompile();
    const state = useWorkbenchStore.getState();

    expect(state.buildStatus).toBe("failed");
    expect(state.buildMessage).toBe("latex failed");
    expect(state.diagnostics).toHaveLength(1);
    expect(state.diagnostics[0]?.message).toBe("Bad TeX");
  });
});
