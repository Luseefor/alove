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

function resetStore(filesByPath: Record<string, string>, mainFile = "paper.tex") {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useWorkbenchStore.setState({
    projectId: "project-1",
    mainFile,
    activeFileId: mainFile,
    openFiles: [mainFile],
    filesByPath,
    versionsByPath: Object.fromEntries(Object.keys(filesByPath).map((p) => [p, 1])),
    dirtyByPath: Object.fromEntries(Object.keys(filesByPath).map((p) => [p, false])),
  });
}

const KNUTH_BIB = `@book{knuth,
  title = {The Art},
  author = {Knuth},
  year = {1968}
}`;

describe("workbenchStore citation diagnostics", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ jobId: "job-1" }), { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not mark knuth unused when cited in paper.tex but not preamble.tex", async () => {
    resetStore({
      "paper.tex": "\\documentclass{article}\\begin{document}\\cite{knuth}\\end{document}",
      "preamble.tex": "\\newcommand{\\foo}{bar}",
      "refs.bib": KNUTH_BIB,
    });
    pollCompileJobMock.mockResolvedValue({ phase: "ready", pdfBase64: "cGRm", log: "ok", diagnostics: [] });

    await useWorkbenchStore.getState().runCompile();
    const diagnostics = useWorkbenchStore.getState().diagnostics;
    expect(diagnostics.filter((d) => d.message.includes('"knuth"'))).toHaveLength(0);
  });

  it("does not report missing when the key is defined in the second bib", async () => {
    resetStore(
      {
        "main.tex": "\\documentclass{article}\\begin{document}\\cite{secondkey}\\end{document}",
        "a.bib": "@book{firstkey,\n title = {A}\n}",
        "b.bib": "@book{secondkey,\n title = {B}\n}",
      },
      "main.tex",
    );
    pollCompileJobMock.mockResolvedValue({ phase: "ready", pdfBase64: "cGRm", log: "ok", diagnostics: [] });

    await useWorkbenchStore.getState().runCompile();
    const diagnostics = useWorkbenchStore.getState().diagnostics;
    expect(diagnostics.filter((d) => d.message.includes('"secondkey"'))).toHaveLength(0);
  });

  it("reports a genuinely unused entry exactly once per bib", async () => {
    resetStore({
      "paper.tex": "\\documentclass{article}\\begin{document}\\cite{knuth}\\end{document}",
      "preamble.tex": "\\newcommand{\\foo}{bar}",
      "refs.bib": `${KNUTH_BIB}\n@book{ghostunused,\n title = {Ghost}\n}`,
    });
    pollCompileJobMock.mockResolvedValue({ phase: "ready", pdfBase64: "cGRm", log: "ok", diagnostics: [] });

    await useWorkbenchStore.getState().runCompile();
    const diagnostics = useWorkbenchStore.getState().diagnostics;
    const knuthUnused = diagnostics.filter((d) => d.message.includes('"knuth"'));
    expect(knuthUnused).toHaveLength(0);
    const ghost = diagnostics.filter((d) => d.message.includes('"ghostunused"'));
    expect(ghost).toHaveLength(1);
    expect(ghost[0]?.file).toBe("refs.bib");
    expect(ghost[0]?.severity).toBe("info");
  });

  it("reports a truly missing citation with the citing tex path", async () => {
    resetStore({
      "paper.tex": "\\documentclass{article}\\begin{document}\\cite{ghost}\\end{document}",
      "preamble.tex": "\\newcommand{\\foo}{bar}",
      "refs.bib": KNUTH_BIB,
    });
    pollCompileJobMock.mockResolvedValue({ phase: "ready", pdfBase64: "cGRm", log: "ok", diagnostics: [] });

    await useWorkbenchStore.getState().runCompile();
    const diagnostics = useWorkbenchStore.getState().diagnostics;
    const missing = diagnostics.filter((d) => d.message.includes('"ghost"'));
    expect(missing).toHaveLength(1);
    expect(missing[0]?.file).toBe("paper.tex");
    expect(missing[0]?.severity).toBe("warning");
  });

  it("keeps no-bib semantics with no citation diagnostics", async () => {
    resetStore(
      {
        "main.tex": "\\documentclass{article}\\begin{document}\\cite{knuth}\\end{document}",
      },
      "main.tex",
    );
    pollCompileJobMock.mockResolvedValue({ phase: "ready", pdfBase64: "cGRm", log: "ok", diagnostics: [] });

    await useWorkbenchStore.getState().runCompile();
    expect(useWorkbenchStore.getState().diagnostics).toHaveLength(0);
  });

  it("uses the captured source snapshot for citation checks", async () => {
    const initialFiles = {
      "paper.tex": "\\documentclass{article}\\begin{document}\\cite{knuth}\\end{document}",
      "refs.bib": KNUTH_BIB,
    };
    resetStore({ ...initialFiles }, "paper.tex");
    const pending = deferred<{ phase: string; pdfBase64: string; log: string; diagnostics: [] }>();
    pollCompileJobMock.mockReturnValue(pending.promise);

    const compile = useWorkbenchStore.getState().runCompile();
    await vi.waitFor(() => expect(pollCompileJobMock).toHaveBeenCalled());
    const sentFiles = JSON.parse(fetchMock.mock.calls[0][1].body).files as Record<string, string>;
    expect(sentFiles).toEqual(initialFiles);

    useWorkbenchStore.setState({
      filesByPath: {
        "paper.tex": "\\documentclass{article}\\begin{document}\\cite{ghost}\\end{document}",
        "refs.bib": KNUTH_BIB,
      },
    });
    pending.resolve({ phase: "ready", pdfBase64: "cGRm", log: "ok", diagnostics: [] });
    await compile;

    const diagnostics = useWorkbenchStore.getState().diagnostics;
    expect(diagnostics.filter((d) => d.message.includes('"ghost"'))).toHaveLength(0);
    expect(useWorkbenchStore.getState().filesByPath["paper.tex"]).toContain("ghost");
  });
});
