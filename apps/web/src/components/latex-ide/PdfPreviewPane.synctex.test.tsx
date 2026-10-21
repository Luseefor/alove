import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useIdeSettingsStore } from "@/stores/ideSettingsStore";
import { PdfPreviewPane } from "@/components/latex-ide/PdfPreviewPane";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import type { SyncTexMapping } from "@alove/protocol";

const pdfjsMock = vi.hoisted(() => ({
  GlobalWorkerOptions: {} as { workerSrc?: string },
  getDocument: vi.fn(),
}));

vi.mock("pdfjs-dist", () => ({
  get GlobalWorkerOptions() {
    return pdfjsMock.GlobalWorkerOptions;
  },
  getDocument: pdfjsMock.getDocument,
}));

const PDF_URL = "data:application/pdf;base64,dGVzdA==";
const SCALE = 2;

function makePage() {
  return {
    view: [0, 0, 612, 792] as [number, number, number, number],
    getViewport: () => ({
      width: 612 * SCALE,
      height: 792 * SCALE,
      viewBox: [0, 0, 612, 792] as [number, number, number, number],
      convertToViewportPoint: (x: number, y: number): [number, number] => [x * SCALE, y * SCALE],
      convertToPdfPoint: (x: number, y: number): [number, number] => [x / SCALE, y / SCALE],
    }),
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
  };
}

function mapping(): SyncTexMapping {
  return {
    version: 1,
    truncated: false,
    preamble: { magnification: 1000, unit: 1, xOffset: 0, yOffset: 0 },
    entries: [
      { file: "main.tex", line: 3, page: 1, x: 8799518, y: 8865054, width: 983040 },
      { file: "main.tex", line: 10, page: 2, x: 300, y: 400 },
      { file: "sections/chap.tex", line: 1, page: 2, x: 100, y: 200 },
    ],
  };
}

function seedReady(mappingValue: SyncTexMapping | null, revision = 5) {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useWorkbenchStore.setState({
    projectId: "project-1",
    activeFileId: "main.tex",
    openFiles: ["main.tex", "sections/chap.tex"],
    filesByPath: {
      "main.tex": "root",
      "sections/chap.tex": "chapter",
    },
    versionsByPath: { "main.tex": 1, "sections/chap.tex": 1 },
    dirtyByPath: { "main.tex": false, "sections/chap.tex": false },
    mainFile: "main.tex",
    cursor: { line: 10, column: 1 },
    runCompile: vi.fn(async () => {}),
  });
  useWorkbenchStore.setState({
    buildStatus: "ready",
    buildMessage: "Compiled successfully",
    pdfDataUrl: PDF_URL,
    documentRevision: revision,
    pdfSourceRevision: revision,
    pdfMainFile: "main.tex",
    synctexMapping: mappingValue,
    synctexRevision: mappingValue ? revision : null,
    synctexMainFile: mappingValue ? "main.tex" : null,
    pdfPage: 1,
    pdfPageCount: 3,
  });
}

function syncButtons(container: HTMLElement) {
  return {
    toPdf: Array.from(container.querySelectorAll("button")).find((b) =>
      /go to pdf for cursor/i.test(b.textContent ?? ""),
    ) as HTMLButtonElement | undefined,
    toSource: Array.from(container.querySelectorAll("button")).find((b) =>
      /go to source for page/i.test(b.textContent ?? ""),
    ) as HTMLButtonElement | undefined,
  };
}

function pinDefaultViewer(container: HTMLElement) {
  const def = Array.from(container.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "Default",
  ) as HTMLButtonElement | undefined;
  act(() => {
    def?.click();
  });
}

describe("PdfPreviewPane synctex controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useIdeSettingsStore.setState({ pdfViewerStyle: "embedded" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    pdfjsMock.getDocument.mockReset();
    pdfjsMock.GlobalWorkerOptions.workerSrc = undefined;
    pdfjsMock.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 3,
        destroy: vi.fn(async () => {}),
        getPage: vi.fn(async () => makePage()),
      }),
    });
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("auto-enables the interactive canvas when a fresh mapping exists", async () => {
    seedReady(mapping());
    await act(async () => {
      root.render(<PdfPreviewPane />);
    });
    expect(container.querySelector('[data-testid="pdf-canvas-viewer"]')).toBeTruthy();
    expect(container.querySelector('iframe[title="Compiled PDF"]')).toBeNull();
  });

  it("jumps the iframe to the PDF page for the current cursor", () => {
    seedReady(mapping());
    act(() => {
      root.render(<PdfPreviewPane />);
    });
    pinDefaultViewer(container);
    const { toPdf } = syncButtons(container);
    expect(toPdf?.disabled).toBe(false);
    act(() => {
      toPdf?.click();
    });
    // Cursor is main.tex:10 -> page 2 via the real mapping.
    expect(container.textContent).toMatch(/PDF page 2 for main\.tex:10/);
    expect(
      container.querySelector('iframe[title="Compiled PDF"]')?.getAttribute("src"),
    ).toBe(`${PDF_URL}#page=2`);
    expect(useWorkbenchStore.getState().pdfPage).toBe(2);
  });

  it("stores a coordinate highlight on source->PDF", () => {
    seedReady(mapping());
    act(() => {
      root.render(<PdfPreviewPane />);
    });
    const { toPdf } = syncButtons(container);
    act(() => {
      toPdf?.click();
    });
    const highlight = useWorkbenchStore.getState().pdfHighlight;
    expect(highlight?.page).toBe(2);
    // Raw (300, 400) sp converted at 65781.76 sp per big point.
    expect(highlight?.xBp).toBeCloseTo(300 / 65781.76, 8);
    expect(highlight?.yTopBp).toBeCloseTo(400 / 65781.76, 8);
    expect(highlight?.hBp).toBe(10);
  });

  it("opens the mapped source for a PDF page", () => {
    seedReady(mapping());
    act(() => {
      root.render(<PdfPreviewPane />);
    });
    pinDefaultViewer(container);
    const input = container.querySelector(
      'input[aria-label="PDF page for reverse sync"]',
    ) as HTMLInputElement;
    const { toSource } = syncButtons(container);
    // Native value setter + input event for React controlled input.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    act(() => {
      setter?.call(input, "2");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => {
      toSource?.click();
    });
    // Page 2 top-of-page entry is sections/chap.tex:1 (smallest line).
    expect(container.textContent).toMatch(
      /Source sections\/chap\.tex:1 for PDF page 2/,
    );
    expect(useWorkbenchStore.getState().activeFileId).toBe(
      "sections/chap.tex",
    );
    expect(useWorkbenchStore.getState().focusedLine).toBe(1);
  });

  it("maps a canvas double-click to the nearest source line", async () => {
    seedReady(mapping());
    await act(async () => {
      root.render(<PdfPreviewPane />);
    });
    // Interactive viewer is auto-enabled; jump to page 2 first.
    const { toPdf } = syncButtons(container);
    await act(async () => {
      toPdf?.click();
    });
    const canvas = container.querySelector(
      '[data-testid="pdf-canvas-viewer"] canvas',
    ) as HTMLCanvasElement;
    expect(canvas).toBeTruthy();
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
    await act(async () => {
      // Click near the sections/chap.tex:1 anchor (100,200 sp -> bp).
      const x = (100 / 65781.76) * SCALE;
      const y = ((792 - 200 / 65781.76) / 792) * 792 * SCALE;
      canvas.dispatchEvent(
        new MouseEvent("dblclick", { clientX: x, clientY: y, bubbles: true }),
      );
    });
    // Nearest anchor on page 2 in big points is sections/chap.tex:1.
    expect(useWorkbenchStore.getState().activeFileId).toBe("sections/chap.tex");
    expect(useWorkbenchStore.getState().focusedLine).toBe(1);
    expect(container.textContent).toMatch(/Source sections\/chap\.tex:1 for PDF page 2/);
  });

  it("blocks navigation with a stale-source message after edits", () => {
    seedReady(mapping(), 5);
    act(() => {
      root.render(<PdfPreviewPane />);
    });
    act(() => {
      useWorkbenchStore.setState({ documentRevision: 6 });
    });
    expect(container.textContent).toMatch(/SyncTeX stale/);
    const { toPdf, toSource } = syncButtons(container);
    expect(toPdf?.disabled).toBe(true);
    expect(toSource?.disabled).toBe(true);
    // Stale mapping falls back to the default iframe viewer.
    expect(container.querySelector('iframe[title="Compiled PDF"]')).toBeTruthy();
  });

  it("reports unavailable mapping without breaking the preview", () => {
    seedReady(null);
    act(() => {
      root.render(<PdfPreviewPane />);
    });
    expect(container.textContent).toMatch(/SyncTeX unavailable/);
    expect(
      container.querySelector('iframe[title="Compiled PDF"]'),
    ).toBeTruthy();
    const { toPdf } = syncButtons(container);
    expect(toPdf?.disabled).toBe(true);
  });

  it("marks truncated mappings honestly", () => {
    seedReady({ ...mapping(), truncated: true });
    act(() => {
      root.render(<PdfPreviewPane />);
    });
    expect(container.textContent).toMatch(/truncated to transport limits/);
  });
});
