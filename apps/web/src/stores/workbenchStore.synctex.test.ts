import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pollCompileJobMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/compilePoll", () => ({
  pollCompileJob: pollCompileJobMock,
}));

import { useWorkbenchStore } from "@/stores/workbenchStore";
import type { SyncTexMapping } from "@alove/protocol";

const fetchMock = vi.fn();

function mapping(): SyncTexMapping {
  return {
    version: 1,
    truncated: false,
    entries: [
      { file: "main.tex", line: 2, page: 1, x: 100, y: 200 },
      { file: "main.tex", line: 9, page: 3, x: 300, y: 400 },
    ],
  };
}

function resetStore() {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useWorkbenchStore.setState({
    projectId: "project-1",
    activeFileId: "main.tex",
    openFiles: ["main.tex"],
    filesByPath: {
      "main.tex": "line1\nline2\nline3",
    },
    versionsByPath: { "main.tex": 1 },
    dirtyByPath: { "main.tex": false },
    cursor: { line: 9, column: 1 },
  });
}

describe("workbenchStore synctex provenance and navigation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetStore();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ jobId: "job-1" }), { status: 200 }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores the mapping with per-run provenance on success", async () => {
    const revision = useWorkbenchStore.getState().documentRevision;
    pollCompileJobMock.mockResolvedValue({
      phase: "ready",
      diagnostics: [],
      log: "ok",
      pdfBase64: "dGVzdA==",
      synctex: mapping(),
    });
    await useWorkbenchStore.getState().runCompile();
    const state = useWorkbenchStore.getState();
    expect(state.synctexMapping).toEqual(mapping());
    expect(state.synctexRevision).toBe(revision);
    expect(state.synctexMainFile).toBe("main.tex");
    expect(state.pdfSourceRevision).toBe(revision);
  });

  it("preserves the last good mapping through a failed rebuild", async () => {
    pollCompileJobMock.mockResolvedValueOnce({
      phase: "ready",
      diagnostics: [],
      log: "ok",
      pdfBase64: "bGFzdA==",
      synctex: mapping(),
    });
    await useWorkbenchStore.getState().runCompile();
    const good = useWorkbenchStore.getState().synctexMapping;
    pollCompileJobMock.mockResolvedValueOnce({
      phase: "failed",
      diagnostics: [],
      log: "bad",
      errorMessage: "latex failed",
    });
    await useWorkbenchStore.getState().runCompile();
    expect(useWorkbenchStore.getState().buildStatus).toBe("failed");
    expect(useWorkbenchStore.getState().synctexMapping).toEqual(good);
  });

  it("navigates source->PDF and PDF->source at the compiled revision", () => {
    const revision = useWorkbenchStore.getState().documentRevision;
    useWorkbenchStore.setState({
      synctexMapping: mapping(),
      synctexRevision: revision,
      synctexMainFile: "main.tex",
      pdfPageCount: 5,
    });
    expect(useWorkbenchStore.getState().goToPdfForCursor()).toBe(3);
    expect(useWorkbenchStore.getState().pdfPage).toBe(3);
    const highlight = useWorkbenchStore.getState().pdfHighlight;
    expect(highlight?.page).toBe(3);
    // Raw (300, 400) sp converted at 65781.76 sp per big point.
    expect(highlight?.xBp).toBeCloseTo(300 / 65781.76, 8);
    expect(highlight?.yTopBp).toBeCloseTo(400 / 65781.76, 8);
    const target = useWorkbenchStore.getState().goToSourceForPdfPage(1);
    expect(target).toEqual({ file: "main.tex", line: 2 });
    expect(useWorkbenchStore.getState().focusedLine).toBe(2);
  });

  it("navigates PDF point clicks with the rendered page height", () => {
    const revision = useWorkbenchStore.getState().documentRevision;
    useWorkbenchStore.setState({
      synctexMapping: mapping(),
      synctexRevision: revision,
      synctexMainFile: "main.tex",
    });
    // Letter page: line-9 anchor (300,400 sp) sits near the top.
    const hit = useWorkbenchStore.getState().goToSourceForPdfPoint({
      page: 3,
      xPdf: 300 / 65781.76,
      yPdf: 792 - 400 / 65781.76,
      pageHeightBp: 792,
    });
    expect(hit).toEqual({ file: "main.tex", line: 9 });
    expect(useWorkbenchStore.getState().focusedLine).toBe(9);
    // Stale source blocks point navigation too.
    useWorkbenchStore.getState().updateActiveFileContent("newer source");
    expect(
      useWorkbenchStore.getState().goToSourceForPdfPoint({
        page: 3,
        xPdf: 300 / 65781.76,
        yPdf: 792 - 400 / 65781.76,
        pageHeightBp: 792,
      }),
    ).toBeNull();
  });

  it("refuses navigation once the source moves past the mapping revision", () => {
    const revision = useWorkbenchStore.getState().documentRevision;
    useWorkbenchStore.setState({
      synctexMapping: mapping(),
      synctexRevision: revision,
      synctexMainFile: "main.tex",
    });
    useWorkbenchStore.getState().updateActiveFileContent("newer source");
    expect(useWorkbenchStore.getState().goToPdfForCursor()).toBeNull();
    expect(useWorkbenchStore.getState().goToSourceForPdfPage(1)).toBeNull();
  });

  it("captures the request revision when edits land mid-compile", async () => {
    let resolvePoll!: (value: unknown) => void;
    const gate = new Promise((res) => {
      resolvePoll = res;
    });
    pollCompileJobMock.mockReturnValueOnce(gate);
    const revision = useWorkbenchStore.getState().documentRevision;
    const compile = useWorkbenchStore.getState().runCompile();
    await vi.waitFor(() => expect(pollCompileJobMock).toHaveBeenCalled());
    useWorkbenchStore.getState().updateActiveFileContent("newer text");
    resolvePoll({
      phase: "ready",
      diagnostics: [],
      log: "ok",
      pdfBase64: "cGRm",
      synctex: mapping(),
    });
    await compile;
    const state = useWorkbenchStore.getState();
    expect(state.synctexRevision).toBe(revision);
    expect(state.documentRevision).toBeGreaterThan(revision);
    // Stale guard applies to the just-stored mapping by design.
    expect(state.goToPdfForCursor()).toBeNull();
  });

  it("clears mapping provenance on project switch", () => {
    useWorkbenchStore.setState({
      synctexMapping: mapping(),
      synctexRevision: 1,
      synctexMainFile: "main.tex",
      pdfHighlight: { page: 1, xBp: 1, yTopBp: 2, wBp: 3, hBp: 4, nonce: 1 },
      pdfDataUrl: "data:application/pdf;base64,b2xk",
    });
    useWorkbenchStore.getState().initializeProject({
      projectId: "another",
      files: [{ path: "main.tex", content: "other" }],
    });
    // initializeProject swaps identity; the subscriber clears artifacts.
    const state = useWorkbenchStore.getState();
    expect(state.synctexMapping).toBeNull();
    expect(state.synctexRevision).toBeNull();
    expect(state.pdfHighlight).toBeNull();
    expect(state.pdfDataUrl).toBeNull();
  });
});
