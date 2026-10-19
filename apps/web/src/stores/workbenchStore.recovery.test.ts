import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const g = globalThis as unknown as { crypto?: Crypto };
if (!g.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

const pollCompileJobMock = vi.hoisted(() => vi.fn());
const saveMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/compilePoll", () => ({
  pollCompileJob: pollCompileJobMock,
}));

vi.mock("@/lib/buildRecordRepository", () => ({
  buildRecordRepository: { save: saveMock, list: vi.fn(async () => []) },
  createBuildRecordRepository: () => ({ save: saveMock, list: vi.fn(async () => []) }),
}));

import { useWorkbenchStore } from "@/stores/workbenchStore";
import { useIdeSettingsStore } from "@/stores/ideSettingsStore";

const fetchMock = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function resetStore() {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useWorkbenchStore.setState({
    projectId: "local-1",
    mainFile: "main.tex",
    activeFileId: "main.tex",
    openFiles: ["main.tex", "chapter.tex"],
    filesByPath: { "main.tex": "root", "chapter.tex": "included" },
    versionsByPath: { "main.tex": 1, "chapter.tex": 1 },
    dirtyByPath: { "main.tex": false, "chapter.tex": false },
  });
}

function state() {
  return useWorkbenchStore.getState();
}

describe("workbenchStore recovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useIdeSettingsStore.setState(useIdeSettingsStore.getInitialState(), true);
    resetStore();
    saveMock.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ jobId: "job-1" }), { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("captures compile source/root/settings/revision despite editing during poll", async () => {
    const pending = deferred<{ phase: string; pdfBase64: string; log: string; diagnostics: [] }>();
    pollCompileJobMock.mockReturnValueOnce(pending.promise);
    const revision = state().documentRevision;
    const settings = useIdeSettingsStore.getState();
    const compile = state().runCompile();
    await vi.waitFor(() => expect(pollCompileJobMock).toHaveBeenCalled());
    state().updateActiveFileContent("edited while compiling");
    pending.resolve({ phase: "ready", pdfBase64: "cGRm", log: "ok", diagnostics: [] });
    await compile;

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.files).toEqual({ "main.tex": "root", "chapter.tex": "included" });
    expect(sent.mainFile).toBe("main.tex");
    expect(sent.engine).toBe(settings.defaultCompilerEngine);
    expect(sent.cleanAux).toBe(settings.compilerCleanAux);
    const record = state().lastBuildRecord;
    expect(record?.files).toEqual({ "main.tex": "root", "chapter.tex": "included" });
    expect(record?.mainFile).toBe("main.tex");
    expect(record?.engine).toBe(settings.defaultCompilerEngine);
    expect(record?.cleanAux).toBe(settings.compilerCleanAux);
    expect(record?.revision).toBe(revision);
    expect(state().filesByPath["main.tex"]).toBe("edited while compiling");
  });

  it("persists records without PDF bytes while preserving the environment", async () => {
    const env = { mode: "docker", runtimeId: "sha256:abc", platform: "linux/amd64" };
    pollCompileJobMock.mockResolvedValue({ phase: "ready", pdfBase64: "cGRm", log: "ok", diagnostics: [], environment: env });
    await state().runCompile();

    expect(saveMock).toHaveBeenCalledTimes(1);
    const saved = saveMock.mock.calls[0][0];
    expect(JSON.stringify(saved)).not.toContain("pdfBase64");
    expect(saved.result.environment).toEqual(env);
    expect(saved.files).toEqual({ "main.tex": "root", "chapter.tex": "included" });
    expect(state().buildHistoryError).toBeNull();
  });

  it("keeps PDF success and build status when history write fails but records the error", async () => {
    pollCompileJobMock.mockResolvedValue({ phase: "ready", pdfBase64: "cGRm", log: "ok", diagnostics: [] });
    saveMock.mockRejectedValueOnce(new Error("disk full"));
    await state().runCompile();

    const current = state();
    expect(current.buildStatus).toBe("ready");
    expect(current.pdfDataUrl).toBe("data:application/pdf;base64,cGRm");
    expect(current.lastBuildRecord).not.toBeNull();
    expect(current.buildHistoryError).toBe("disk full");
  });

  it("lets a superseding poll decide the stored last build, not an older one", async () => {
    const old = deferred<{ phase: string; pdfBase64: string; log: string; diagnostics: [] }>();
    pollCompileJobMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ phase: "ready", pdfBase64: "bmV3", log: "new result", diagnostics: [] });
    const first = state().runCompile();
    await vi.waitFor(() => expect(pollCompileJobMock).toHaveBeenCalledTimes(1));
    state().updateActiveFileContent("second source");
    const second = state().runCompile();
    await second;
    old.resolve({ phase: "ready", pdfBase64: "b2xk", log: "old result", diagnostics: [] });
    await first;

    const current = state();
    expect(current.buildLog).toBe("new result");
    expect(current.lastBuildRecord?.result.log).toBe("new result");
    expect(current.lastBuildRecord?.files["main.tex"]).toBe("second source");
  });

  it("checks current compiler settings inside the apply action", () => {
    const settings = useIdeSettingsStore.getState();
    const args = { projectId: "local-1", mainFile: "main.tex", expectedFiles: { ...state().filesByPath }, path: "chapter.tex", content: "restored",
      engine: settings.defaultCompilerEngine, cleanAux: settings.compilerCleanAux };
    useIdeSettingsStore.setState({ defaultCompilerEngine: settings.defaultCompilerEngine === "pdflatex" ? "xelatex" : "pdflatex" });
    expect(state().applyRecoveryFile(args)).toBe(false);
    useIdeSettingsStore.setState({ defaultCompilerEngine: args.engine, compilerCleanAux: !args.cleanAux });
    expect(state().applyRecoveryFile(args)).toBe(false);
    expect(state().filesByPath["chapter.tex"]).toBe("included");
  });

  it("restores exactly one file through applyRecoveryFile and marks it unsaved", () => {
    const expected = { ...state().filesByPath };
    const ok = state().applyRecoveryFile({
      projectId: "local-1",
      mainFile: "main.tex",
      engine: useIdeSettingsStore.getState().defaultCompilerEngine, cleanAux: useIdeSettingsStore.getState().compilerCleanAux, expectedFiles: expected,
      path: "chapter.tex",
      content: "restored chapter",
    });
    expect(ok).toBe(true);
    const current = state();
    expect(current.filesByPath).toEqual({ "main.tex": "root", "chapter.tex": "restored chapter" });
    expect(current.dirtyByPath["chapter.tex"]).toBe(true);
    expect(current.saveStatus).toBe("unsaved");
  });

  it("refuses recovery when expected source, project, root, busyness, or safety checks fail", () => {
    const before = { ...state().filesByPath };
    const base = { projectId: "local-1", mainFile: "main.tex", engine: useIdeSettingsStore.getState().defaultCompilerEngine, cleanAux: useIdeSettingsStore.getState().compilerCleanAux, expectedFiles: before, path: "chapter.tex", content: "restored" };

    expect(state().applyRecoveryFile({ ...base, engine: useIdeSettingsStore.getState().defaultCompilerEngine, cleanAux: useIdeSettingsStore.getState().compilerCleanAux, expectedFiles: { ...before, "chapter.tex": "stale" } })).toBe(false);
    expect(state().applyRecoveryFile({ ...base, projectId: "local-2" })).toBe(false);
    expect(state().applyRecoveryFile({ ...base, mainFile: "other.tex" })).toBe(false);
    expect(state().applyRecoveryFile({ ...base, path: "../evil.tex" })).toBe(false);
    expect(state().applyRecoveryFile({ ...base, path: "a//b.tex" })).toBe(false);

    useWorkbenchStore.setState({ buildStatus: "running" });
    expect(state().applyRecoveryFile(base)).toBe(false);
    useWorkbenchStore.setState({ buildStatus: "queued" });
    expect(state().applyRecoveryFile(base)).toBe(false);

    expect(state().filesByPath).toEqual(before);
  });

  it("reverses a store apply while preserving unrelated text", () => {
    const original = { ...state().filesByPath };
    expect(state().applyRecoveryFile({
      projectId: "local-1", mainFile: "main.tex", engine: useIdeSettingsStore.getState().defaultCompilerEngine, cleanAux: useIdeSettingsStore.getState().compilerCleanAux, expectedFiles: original, path: "chapter.tex", content: "restored chapter",
    })).toBe(true);
    const mid = { ...state().filesByPath };
    expect(state().applyRecoveryFile({
      projectId: "local-1", mainFile: "main.tex", engine: useIdeSettingsStore.getState().defaultCompilerEngine, cleanAux: useIdeSettingsStore.getState().compilerCleanAux, expectedFiles: mid, path: "chapter.tex", content: "included",
    })).toBe(true);
    expect(state().filesByPath).toEqual(original);
  });

  it("refuses recovery for cloud projects", () => {
    useWorkbenchStore.setState({ projectId: "cloud-1" });
    const before = { ...state().filesByPath };
    const ok = state().applyRecoveryFile({
      projectId: "cloud-1",
      mainFile: "main.tex",
      engine: useIdeSettingsStore.getState().defaultCompilerEngine, cleanAux: useIdeSettingsStore.getState().compilerCleanAux, expectedFiles: before,
      path: "chapter.tex",
      content: "restored",
    });
    expect(ok).toBe(false);
    expect(state().filesByPath).toEqual(before);
  });
});
