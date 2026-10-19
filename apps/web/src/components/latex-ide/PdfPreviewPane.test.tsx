import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfPreviewPane } from "@/components/latex-ide/PdfPreviewPane";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import type { WorkbenchState } from "@/stores/workbenchStore";

const PDF_URL = "data:application/pdf;base64,dGVzdA==";

type SkeletonOverrides = {
  mainFile?: string | null;
  filesByPath?: Record<string, string>;
};

type FixtureOverrides = {
  buildStatus?: WorkbenchState["buildStatus"];
  buildMessage?: string | null;
  pdfDataUrl?: string | null;
  documentRevision?: number;
  pdfSourceRevision?: number | null;
  pdfMainFile?: string | null;
};

function seedStore(skeleton: SkeletonOverrides = {}, fixture: FixtureOverrides = {}) {
  // Step 1: reset to initial state.
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  // Step 2: seed the project skeleton FIRST. The store's project-change
  // observer clears PDF artifacts whenever projectId/files change, so the
  // project identity must settle before fixture artifacts are applied.
  useWorkbenchStore.setState({
    projectId: "project-1",
    activeFileId: "main.tex",
    openFiles: ["main.tex"],
    filesByPath: { "main.tex": "\\documentclass{article}\\begin{document}hello\\end{document}" },
    versionsByPath: { "main.tex": 1 },
    dirtyByPath: { "main.tex": false },
    mainFile: "main.tex",
    runCompile: vi.fn(async () => {}),
    ...skeleton,
  });
  // Step 3: seed PDF/build fixture state WITHOUT touching projectId,
  // filesByPath, or versions so the project-change invariant is preserved.
  // (Changing mainFile here bumps documentRevision by design; pass an
  // explicit documentRevision only when the test does not change mainFile.)
  useWorkbenchStore.setState({ ...fixture });
}

function seedReadyPdf(extraFixture: FixtureOverrides = {}, skeleton: SkeletonOverrides = {}) {
  seedStore(skeleton, {
    buildStatus: "ready",
    buildMessage: "Compiled successfully",
    pdfDataUrl: PDF_URL,
    documentRevision: 5,
    pdfSourceRevision: 5,
    pdfMainFile: "paper.tex",
    ...extraFixture,
  });
}

function findBuildButton(container: HTMLElement): HTMLButtonElement | null {
  const buttons = Array.from(container.querySelectorAll("button"));
  return (
    (buttons.find((b) =>
      /^(queued…|compiling…|rebuild|retry build|start build)$/i.test(
        b.textContent?.trim() ?? "",
      ),
    ) as HTMLButtonElement | undefined) ?? null
  );
}

describe("PdfPreviewPane", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("retains the previous PDF iframe across queued and running states", () => {
    seedReadyPdf();

    act(() => {
      root.render(<PdfPreviewPane />);
    });

    const initialFrame = container.querySelector('iframe[title="Compiled PDF"]');
    expect(initialFrame).toBeTruthy();
    expect(initialFrame?.getAttribute("src")).toBe(PDF_URL);
    expect(
      container.querySelector('[data-testid="pdf-preview-pane"]')?.getAttribute("data-status"),
    ).toBe("ready");

    act(() => {
      useWorkbenchStore.setState({ buildStatus: "queued" });
    });
    const queuedFrame = container.querySelector('iframe[title="Compiled PDF"]');
    expect(queuedFrame).toBeTruthy();
    expect(queuedFrame?.getAttribute("src")).toBe(PDF_URL);
    expect(container.textContent).toMatch(/Queued/i);
    expect(container.textContent).toMatch(/Showing last successful preview/i);

    act(() => {
      useWorkbenchStore.setState({ buildStatus: "running" });
    });
    const runningFrame = container.querySelector('iframe[title="Compiled PDF"]');
    expect(runningFrame).toBeTruthy();
    expect(runningFrame?.getAttribute("src")).toBe(PDF_URL);
    expect(container.textContent).toMatch(/Compiling/i);
  });

  it("retains the previous PDF iframe across failed state with truthful message", () => {
    seedReadyPdf();

    act(() => {
      root.render(<PdfPreviewPane />);
    });
    expect(container.querySelector('iframe[title="Compiled PDF"]')).toBeTruthy();

    act(() => {
      useWorkbenchStore.setState({
        buildStatus: "failed",
        buildMessage: "latex failed",
      });
    });

    const frame = container.querySelector('iframe[title="Compiled PDF"]');
    expect(frame).toBeTruthy();
    expect(frame?.getAttribute("src")).toBe(PDF_URL);
    expect(container.textContent).toMatch(/Build failed/i);
    expect(container.textContent).toMatch(/latex failed/i);
    expect(container.textContent).toMatch(/Showing last successful preview/i);
  });

  it("shows a stale label when documentRevision differs from pdfSourceRevision", () => {
    seedReadyPdf({ documentRevision: 6, pdfSourceRevision: 5 });

    act(() => {
      root.render(<PdfPreviewPane />);
    });

    expect(container.querySelector('iframe[title="Compiled PDF"]')).toBeTruthy();
    expect(container.textContent).toMatch(/Stale preview/i);
  });

  it("displays the real root filename with .tex replaced by .pdf", () => {
    seedReadyPdf(
      { pdfMainFile: "chapters/thesis.tex", documentRevision: 3, pdfSourceRevision: 3 },
      { mainFile: "main.tex" },
    );

    act(() => {
      root.render(<PdfPreviewPane />);
    });

    expect(container.textContent).toContain("thesis.pdf");

    act(() => {
      useWorkbenchStore.setState({
        pdfMainFile: null,
        mainFile: "report.tex",
      });
    });

    expect(container.textContent).toContain("report.pdf");
  });

  it("shows the no-PDF empty state when pdfDataUrl is null", () => {
    seedStore(
      { mainFile: "main.tex" },
      { buildStatus: "idle", buildMessage: null, pdfDataUrl: null, pdfMainFile: null },
    );

    act(() => {
      root.render(<PdfPreviewPane />);
    });

    expect(container.querySelector('iframe[title="Compiled PDF"]')).toBeNull();
    expect(container.textContent).toMatch(/Document not built/i);
    expect(container.textContent).toContain("main.pdf");
  });

  it("disables Build/Retry while queued or running", () => {
    seedReadyPdf({ buildStatus: "queued", documentRevision: 1, pdfSourceRevision: 1 });

    act(() => {
      root.render(<PdfPreviewPane />);
    });

    const queuedButton = findBuildButton(container);
    expect(queuedButton).toBeTruthy();
    expect(queuedButton?.disabled).toBe(true);

    act(() => {
      useWorkbenchStore.setState({ buildStatus: "running" });
    });
    const runningButton = findBuildButton(container);
    expect(runningButton).toBeTruthy();
    expect(runningButton?.disabled).toBe(true);

    act(() => {
      useWorkbenchStore.setState({ buildStatus: "ready" });
    });
    const readyButton = findBuildButton(container);
    expect(readyButton).toBeTruthy();
    expect(readyButton?.disabled).toBe(false);
  });

  it("provides a real Download action backed by the PDF data URL", () => {
    seedReadyPdf({ documentRevision: 2, pdfSourceRevision: 2 });

    act(() => {
      root.render(<PdfPreviewPane />);
    });

    const download = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent?.trim() === "Download",
    );
    expect(download).toBeTruthy();
    expect(download?.getAttribute("href")).toBe(PDF_URL);
    expect(download?.getAttribute("download")).toBe("paper.pdf");
  });
});
