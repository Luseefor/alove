import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pollCompileJobMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/compilePoll", () => ({
  pollCompileJob: pollCompileJobMock,
}));

import { useWorkbenchStore } from "@/stores/workbenchStore";

const fetchMock = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
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

function postResponse(jobId: string) {
  return new Response(JSON.stringify({ jobId }), { status: 200 });
}

function deleteResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status });
}

describe("workbenchStore cancelCompile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetStore();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async () => postResponse("job-1"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cancelled queued delete aborts polling, clears job id, keeps source and PDF", async () => {
    const oldPdf = "data:application/pdf;base64,b2xk";
    useWorkbenchStore.setState({ pdfDataUrl: oldPdf });
    const sourceBefore = useWorkbenchStore.getState().filesByPath["main.tex"];

    const pending = deferred<{ phase: string; pdfBase64: string; diagnostics: never[] }>();
    pollCompileJobMock.mockReturnValue(pending.promise);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return deleteResponse({ state: "cancelled" }, 200);
      return postResponse("job-1");
    });

    const compile = useWorkbenchStore.getState().runCompile();
    await vi.waitFor(() => expect(pollCompileJobMock).toHaveBeenCalledTimes(1));
    expect(useWorkbenchStore.getState().buildStatus).toBe("running");
    expect(useWorkbenchStore.getState().activeCompileJobId).toBe("job-1");
    const pollSignal = pollCompileJobMock.mock.calls[0][1] as AbortSignal;

    await useWorkbenchStore.getState().cancelCompile();

    const deleteCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === "DELETE");
    expect(deleteCall?.[0]).toBe("/api/compile/job-1");
    expect(pollSignal.aborted).toBe(true);
    const cancelled = useWorkbenchStore.getState();
    expect(cancelled.activeCompileJobId).toBeNull();
    expect(cancelled.buildStatus).toBe("failed");
    expect(cancelled.buildMessage).toBe("Build cancelled.");
    expect(cancelled.filesByPath["main.tex"]).toBe(sourceBefore);
    expect(cancelled.pdfDataUrl).toBe(oldPdf);

    pending.resolve({ phase: "ready", pdfBase64: "bmV3", diagnostics: [] });
    await compile;
    const stale = useWorkbenchStore.getState();
    expect(stale.buildStatus).toBe("failed");
    expect(stale.buildMessage).toBe("Build cancelled.");
    expect(stale.pdfDataUrl).toBe(oldPdf);
    expect(stale.filesByPath["main.tex"]).toBe(sourceBefore);
  });

  it("active cancelling keeps polling and applies the terminal result", async () => {
    const pending = deferred<{ phase: string; pdfBase64: string; log: string; diagnostics: never[] }>();
    pollCompileJobMock.mockReturnValue(pending.promise);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return deleteResponse({ state: "cancelling" }, 202);
      return postResponse("job-2");
    });

    const compile = useWorkbenchStore.getState().runCompile();
    await vi.waitFor(() => expect(pollCompileJobMock).toHaveBeenCalledTimes(1));
    const pollSignal = pollCompileJobMock.mock.calls[0][1] as AbortSignal;

    await useWorkbenchStore.getState().cancelCompile();

    const waiting = useWorkbenchStore.getState();
    expect(waiting.activeCompileJobId).toBe("job-2");
    expect(waiting.buildStatus).toBe("running");
    expect(waiting.buildMessage).toBe("Cancellation requested. Waiting for the worker to stop…");
    expect(pollSignal.aborted).toBe(false);

    pending.resolve({ phase: "ready", pdfBase64: "bmV3", log: "done", diagnostics: [] });
    await compile;

    const done = useWorkbenchStore.getState();
    expect(done.buildStatus).toBe("ready");
    expect(done.pdfDataUrl).toBe("data:application/pdf;base64,bmV3");
    expect(done.activeCompileJobId).toBeNull();
  });

  it("refused delete keeps polling, job id, source, PDF and reports truthfully", async () => {
    const oldPdf = "data:application/pdf;base64,b2xk";
    useWorkbenchStore.setState({ pdfDataUrl: oldPdf });
    const sourceBefore = useWorkbenchStore.getState().filesByPath["main.tex"];

    const pending = deferred<{ phase: string; pdfBase64: string; log: string; diagnostics: never[] }>();
    pollCompileJobMock.mockReturnValue(pending.promise);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return deleteResponse({ error: "unavailable" }, 503);
      return postResponse("job-3");
    });

    const compile = useWorkbenchStore.getState().runCompile();
    await vi.waitFor(() => expect(pollCompileJobMock).toHaveBeenCalledTimes(1));
    const pollSignal = pollCompileJobMock.mock.calls[0][1] as AbortSignal;

    await useWorkbenchStore.getState().cancelCompile();

    const refused = useWorkbenchStore.getState();
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === "DELETE")).toBe(true);
    expect(refused.activeCompileJobId).toBe("job-3");
    expect(refused.buildStatus).toBe("running");
    expect(refused.buildMessage).toMatch(/could not cancel/i);
    expect(refused.filesByPath["main.tex"]).toBe(sourceBefore);
    expect(refused.pdfDataUrl).toBe(oldPdf);
    expect(pollSignal.aborted).toBe(false);

    pending.resolve({ phase: "ready", pdfBase64: "bmV3", log: "done", diagnostics: [] });
    await compile;
    expect(useWorkbenchStore.getState().buildStatus).toBe("ready");
    expect(useWorkbenchStore.getState().pdfDataUrl).toBe("data:application/pdf;base64,bmV3");
  });

  it("does nothing without an active job id", async () => {
    useWorkbenchStore.setState({ activeCompileJobId: null, buildStatus: "idle", buildMessage: null });
    fetchMock.mockClear();

    await useWorkbenchStore.getState().cancelCompile();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useWorkbenchStore.getState().activeCompileJobId).toBeNull();
    expect(useWorkbenchStore.getState().buildStatus).toBe("idle");
    expect(useWorkbenchStore.getState().buildMessage).toBeNull();
  });

  it("stale cancellation after a project switch cannot affect the new project", async () => {
    const oldPoll = deferred<{ phase: string; pdfBase64: string; diagnostics: never[] }>();
    pollCompileJobMock.mockReturnValueOnce(oldPoll.promise);
    const deleteGate = deferred<Response>();
    let postCount = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return deleteGate.promise;
      postCount += 1;
      return postResponse(postCount === 1 ? "job-old" : "job-new");
    });

    const oldCompile = useWorkbenchStore.getState().runCompile();
    await vi.waitFor(() => expect(pollCompileJobMock).toHaveBeenCalledTimes(1));
    expect(useWorkbenchStore.getState().activeCompileJobId).toBe("job-old");

    const cancelling = useWorkbenchStore.getState().cancelCompile();
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === "DELETE")).toBe(true),
    );

    useWorkbenchStore.getState().initializeProject({
      projectId: "project-2",
      files: [{ path: "main.tex", content: "new project source" }],
    });

    const newPoll = deferred<{ phase: string; pdfBase64: string; log: string; diagnostics: never[] }>();
    pollCompileJobMock.mockReturnValueOnce(newPoll.promise);
    const newCompile = useWorkbenchStore.getState().runCompile();
    await vi.waitFor(() => expect(pollCompileJobMock).toHaveBeenCalledTimes(2));
    expect(useWorkbenchStore.getState().activeCompileJobId).toBe("job-new");

    deleteGate.resolve(deleteResponse({ state: "cancelled" }, 200));
    await cancelling;

    const current = useWorkbenchStore.getState();
    expect(current.projectId).toBe("project-2");
    expect(current.filesByPath["main.tex"]).toBe("new project source");
    expect(current.activeCompileJobId).toBe("job-new");
    expect(current.buildStatus).toBe("running");
    expect(current.pdfDataUrl).toBeNull();

    oldPoll.resolve({ phase: "ready", pdfBase64: "b2xk", diagnostics: [] });
    await oldCompile;
    expect(useWorkbenchStore.getState().activeCompileJobId).toBe("job-new");
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toBe("new project source");

    newPoll.resolve({ phase: "ready", pdfBase64: "bmV3", log: "done", diagnostics: [] });
    await newCompile;
    expect(useWorkbenchStore.getState().buildStatus).toBe("ready");
    expect(useWorkbenchStore.getState().pdfDataUrl).toBe("data:application/pdf;base64,bmV3");
  });
});
