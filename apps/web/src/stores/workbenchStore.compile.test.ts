import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pollCompileJobMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/compilePoll", () => ({
  pollCompileJob: pollCompileJobMock,
}));

import { useWorkbenchStore } from "@/stores/workbenchStore";

const fetchMock = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

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
    vi.resetAllMocks();
    resetStore();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ jobId: "job-1" }), { status: 200 }));
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
  it("builds the configured root while an included chapter is active", async () => {
    useWorkbenchStore.setState({ mainFile: "main.tex", filesByPath: { "main.tex": "root", "chapter.tex": "included" }, activeFileId: "chapter.tex" });
    pollCompileJobMock.mockResolvedValue({ phase: "ready", pdfBase64: "cm9vdA==", log: "root", diagnostics: [] });
    await useWorkbenchStore.getState().runCompile();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).mainFile).toBe("main.tex");
    expect(useWorkbenchStore.getState().pdfMainFile).toBe("main.tex");
  });

  it("ignores a slower superseded job even if its poll resolves after abort", async () => {
    const old = deferred<{ phase: string; pdfBase64: string; log: string; diagnostics: [] }>();
    pollCompileJobMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ phase: "ready", pdfBase64: "bmV3", log: "new result", diagnostics: [] });
    const first = useWorkbenchStore.getState().runCompile();
    await vi.waitFor(() => expect(pollCompileJobMock).toHaveBeenCalledTimes(1));
    const firstSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    const second = useWorkbenchStore.getState().runCompile();
    await second;
    old.resolve({ phase: "ready", pdfBase64: "b2xk", log: "old result", diagnostics: [] });
    await first;
    expect(firstSignal.aborted).toBe(true);
    expect(useWorkbenchStore.getState().buildLog).toBe("new result");
    expect(useWorkbenchStore.getState().pdfDataUrl).toBe("data:application/pdf;base64,bmV3");
  });

  it("clears project artifacts and ignores a pending response after switching projects", async () => {
    const pending = deferred<{ phase: string; pdfBase64: string; diagnostics: [] }>();
    pollCompileJobMock.mockReturnValue(pending.promise);
    const compile = useWorkbenchStore.getState().runCompile();
    await vi.waitFor(() => expect(pollCompileJobMock).toHaveBeenCalled());
    useWorkbenchStore.getState().initializeProject({ projectId: "another", files: [{ path: "main.tex", content: "other project" }] });
    pending.resolve({ phase: "ready", pdfBase64: "b2xk", diagnostics: [] });
    await compile;
    expect(useWorkbenchStore.getState().buildStatus).toBe("idle");
    expect(useWorkbenchStore.getState().pdfDataUrl).toBeNull();
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toBe("other project");
  });

  it("keeps the last successful PDF through pending and failed rebuilds", async () => {
    pollCompileJobMock.mockResolvedValueOnce({ phase: "ready", pdfBase64: "bGFzdA==", log: "good", diagnostics: [] });
    await useWorkbenchStore.getState().runCompile();
    const oldPdf = useWorkbenchStore.getState().pdfDataUrl;
    const failure = deferred<{ phase: string; errorMessage: string; diagnostics: [] }>();
    pollCompileJobMock.mockReturnValueOnce(failure.promise);
    const rebuild = useWorkbenchStore.getState().runCompile();
    expect(useWorkbenchStore.getState().pdfDataUrl).toBe(oldPdf);
    await vi.waitFor(() => expect(pollCompileJobMock).toHaveBeenCalledTimes(2));
    failure.resolve({ phase: "failed", errorMessage: "Bad TeX", diagnostics: [] });
    await rebuild;
    expect(useWorkbenchStore.getState().buildStatus).toBe("failed");
    expect(useWorkbenchStore.getState().pdfDataUrl).toBe(oldPdf);
  });

  it("tracks the compiled source revision without making tab switches stale", async () => {
    pollCompileJobMock.mockResolvedValue({ phase: "ready", pdfBase64: "cGRm", log: "ok", diagnostics: [] });
    await useWorkbenchStore.getState().runCompile();
    const revision = useWorkbenchStore.getState().pdfSourceRevision;
    useWorkbenchStore.getState().openFile("main.tex");
    expect(useWorkbenchStore.getState().documentRevision).toBe(revision);
    useWorkbenchStore.getState().updateActiveFileContent("newer source");
    expect(useWorkbenchStore.getState().documentRevision).not.toBe(revision);
    expect(useWorkbenchStore.getState().pdfSourceRevision).toBe(revision);
  });

  it("stops watching on unmount without applying the eventual result", async () => {
    const pending = deferred<{ phase: string; pdfBase64: string; diagnostics: [] }>();
    pollCompileJobMock.mockReturnValue(pending.promise);
    const compile = useWorkbenchStore.getState().runCompile();
    await vi.waitFor(() => expect(pollCompileJobMock).toHaveBeenCalled());
    useWorkbenchStore.getState().stopCompilePolling();
    pending.resolve({ phase: "ready", pdfBase64: "bGF0ZQ==", diagnostics: [] });
    await compile;
    expect(useWorkbenchStore.getState().buildStatus).toBe("idle");
    expect(useWorkbenchStore.getState().pdfDataUrl).toBeNull();
  });

  it("opens normalized diagnostic paths and avoids stale line jumps", () => {
    const diagnostic = { file: "/work/./main.tex", line: 2, severity: "error" as const, message: "bad root" };
    useWorkbenchStore.setState({ diagnostics: [diagnostic], diagnosticRevision: useWorkbenchStore.getState().documentRevision, activeFileId: null });
    useWorkbenchStore.getState().jumpToDiagnostic(diagnostic);
    expect(useWorkbenchStore.getState().activeFileId).toBe("main.tex");
    expect(useWorkbenchStore.getState().focusedLine).toBe(2);
    useWorkbenchStore.getState().updateActiveFileContent("newer source");
    useWorkbenchStore.getState().jumpToDiagnostic(diagnostic);
    expect(useWorkbenchStore.getState().focusedLine).toBeNull();
  });

  it("supersedes pending results when a new run has no main document", async () => {
    const pending = deferred<{ phase: string; pdfBase64: string; diagnostics: [] }>();
    pollCompileJobMock.mockReturnValueOnce(pending.promise);
    const compile = useWorkbenchStore.getState().runCompile();
    await vi.waitFor(() => expect(pollCompileJobMock).toHaveBeenCalled());
    useWorkbenchStore.getState().deleteFile("main.tex");
    await useWorkbenchStore.getState().runCompile();
    pending.resolve({ phase: "ready", pdfBase64: "bGF0ZQ==", diagnostics: [] });
    await compile;
    expect(useWorkbenchStore.getState().buildStatus).toBe("failed");
    expect(useWorkbenchStore.getState().buildMessage).toContain("Choose a main");
    expect(useWorkbenchStore.getState().pdfDataUrl).toBeNull();
  });

  it("marks a snapshot completed during editing as stale without losing newer source", async () => {
    const pending = deferred<{ phase: string; pdfBase64: string; diagnostics: [] }>();
    pollCompileJobMock.mockReturnValueOnce(pending.promise);
    const revision = useWorkbenchStore.getState().documentRevision;
    const compile = useWorkbenchStore.getState().runCompile();
    await vi.waitFor(() => expect(pollCompileJobMock).toHaveBeenCalled());
    useWorkbenchStore.getState().updateActiveFileContent("newer text while compiling");
    pending.resolve({ phase: "ready", pdfBase64: "cGRm", diagnostics: [] });
    await compile;
    const state = useWorkbenchStore.getState();
    expect(state.buildStatus).toBe("ready");
    expect(state.filesByPath["main.tex"]).toBe("newer text while compiling");
    expect(state.pdfSourceRevision).toBe(revision);
    expect(state.diagnosticRevision).toBe(revision);
    expect(state.documentRevision).toBeGreaterThan(revision);
  });

});
