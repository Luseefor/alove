import { beforeEach, describe, it, expect, vi } from "vitest";
import { useWorkbenchStore } from "./workbenchStore";

beforeEach(() => {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useWorkbenchStore.getState().initializeProject({
    projectId: "local-test",
    title: "Original",
    files: [
      { path: "main.tex", content: "before TARGET after" },
      { path: "chapter.tex", content: "chapter" },
    ],
  });
});
describe("editor source controls", () => {
  it("does not jump a missing-file diagnostic into the current file", () => {
    useWorkbenchStore
      .getState()
      .jumpToDiagnostic({
        severity: "error",
        message: "missing",
        file: "missing.tex",
        line: 5,
      });
    expect(useWorkbenchStore.getState().activeFileId).toBe("main.tex");
    expect(useWorkbenchStore.getState().focusedLine).toBeNull();
  });
  it("does not open another file for a stale build diagnostic", () => {
    const diagnostic = {
      severity: "error" as const,
      message: "old build",
      file: "chapter.tex",
      line: 2,
    };
    useWorkbenchStore.setState({
      diagnostics: [diagnostic],
      diagnosticRevision: 1,
      documentRevision: 2,
    });
    useWorkbenchStore.getState().jumpToDiagnostic(diagnostic);
    expect(useWorkbenchStore.getState().activeFileId).toBe("main.tex");
    expect(useWorkbenchStore.getState().focusedLine).toBeNull();
  });

  it("inserts a citation at the selected range rather than after the document", () => {
    useWorkbenchStore.getState().setActiveSelection({ start: 7, end: 13 });
    useWorkbenchStore.getState().appendToActiveFile("\\cite{key}");
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toBe(
      "before \\cite{key} after",
    );
    expect(useWorkbenchStore.getState().nextSelection).toEqual({
      start: 17,
      end: 17,
    });
  });
  it("defaults snippets to the document body before its closing command", () => {
    useWorkbenchStore
      .getState()
      .updateActiveFileContent("\\begin{document}\nBody\n\\end{document}");
    useWorkbenchStore.getState().appendToActiveFile("\\cite{key}");
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toContain(
      "\\cite{key}\\end{document}",
    );
  });
  it("does not carry a selection from another file", () => {
    useWorkbenchStore.getState().setActiveSelection({ start: 2, end: 10 });
    useWorkbenchStore.getState().openFile("chapter.tex");
    expect(useWorkbenchStore.getState().activeSelection).toBeNull();
  });
  it("keeps the original project title when remote rename fails", async () => {
    useWorkbenchStore.getState().setPersistenceHandlers({
      renameProject: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    expect(await useWorkbenchStore.getState().setProjectTitle("Changed")).toBe(
      false,
    );
    expect(useWorkbenchStore.getState().projectTitle).toBe("Original");
    expect(useWorkbenchStore.getState().saveMessage).toMatch(/rename failed/i);
  });
  it("clears a selected range when closing the active tab", () => {
    useWorkbenchStore.getState().openFile("chapter.tex");
    useWorkbenchStore.getState().openFile("main.tex");
    useWorkbenchStore.getState().setActiveSelection({ start: 2, end: 10 });
    useWorkbenchStore.getState().closeFile("main.tex");
    expect(useWorkbenchStore.getState().activeFileId).toBe("chapter.tex");
    expect(useWorkbenchStore.getState().activeSelection).toBeNull();
  });
});
