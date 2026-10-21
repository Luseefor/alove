import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfCanvasViewer } from "@/components/latex-ide/PdfCanvasViewer";

const pdfjsMock = vi.hoisted(() => ({
  GlobalWorkerOptions: {} as { workerSrc?: string },
  getDocument: vi.fn(),
  lastViewport: null as null | {
    width: number;
    height: number;
    viewBox: [number, number, number, number];
    convertToViewportPoint: (x: number, y: number) => [number, number];
    convertToPdfPoint: (x: number, y: number) => [number, number];
  },
}));

vi.mock("pdfjs-dist", () => ({
  get GlobalWorkerOptions() {
    return pdfjsMock.GlobalWorkerOptions;
  },
  getDocument: pdfjsMock.getDocument,
}));

const SCALE = 2;

function makePage() {
  const viewport = {
    width: 612 * SCALE,
    height: 792 * SCALE,
    viewBox: [0, 0, 612, 792] as [number, number, number, number],
    convertToViewportPoint: (x: number, y: number): [number, number] => [x * SCALE, y * SCALE],
    convertToPdfPoint: (x: number, y: number): [number, number] => [x / SCALE, y / SCALE],
  };
  pdfjsMock.lastViewport = viewport;
  return {
    view: [0, 0, 612, 792] as [number, number, number, number],
    getViewport: () => viewport,
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
  };
}

function docWithPages(count: number) {
  return {
    numPages: count,
    destroy: vi.fn(async () => {}),
    getPage: vi.fn(async () => makePage()),
  };
}

describe("PdfCanvasViewer", () => {
  let container: HTMLDivElement;
  let root: Root;

  const props = () => ({
    onPageChange: vi.fn(),
    onPageCount: vi.fn(),
    onCanvasDoubleClick: vi.fn(),
    onError: vi.fn(),
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    pdfjsMock.getDocument.mockReset();
    pdfjsMock.GlobalWorkerOptions.workerSrc = undefined;
    // jsdom has no canvas backend; the mocked renderer ignores the context.
    HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  async function renderViewer(overrides: Record<string, unknown> = {}) {
    const p = { ...props(), ...overrides };
    pdfjsMock.getDocument.mockReturnValue({ promise: Promise.resolve(docWithPages(3)) });
    await act(async () => {
      root.render(
        <PdfCanvasViewer
          pdfBytes={new Uint8Array([1, 2, 3])}
          page={1}
          onPageChange={p.onPageChange}
          onPageCount={p.onPageCount}
          highlight={null}
          stale={false}
          onCanvasDoubleClick={p.onCanvasDoubleClick}
          onError={p.onError}
          {...overrides}
        />,
      );
    });
    return p;
  }

  it("loads the document and reports the page count", async () => {
    const p = await renderViewer();
    expect(pdfjsMock.getDocument).toHaveBeenCalledTimes(1);
    expect(p.onPageCount).toHaveBeenCalledWith(3);
    expect(container.querySelector("canvas")).toBeTruthy();
  });

  it("positions the SyncTeX highlight through the viewport", async () => {
    await renderViewer({
      highlight: { page: 1, xBp: 100, yTopBp: 50, wBp: 200, hBp: 10, nonce: 1 },
    });
    const box = container.querySelector('[data-testid="pdf-sync-highlight"]') as HTMLElement;
    expect(box).toBeTruthy();
    // PDF corners: (100, 792-50)=(100,742) and (300, 732); scale 2.
    expect(box.style.left).toBe(`${100 * SCALE}px`);
    expect(box.style.top).toBe(`${732 * SCALE}px`);
    expect(box.style.width).toBe(`${200 * SCALE}px`);
    expect(box.style.height).toBe(`${10 * SCALE}px`);
  });

  it("hides the highlight while stale", async () => {
    await renderViewer({
      highlight: { page: 1, xBp: 100, yTopBp: 50, wBp: 200, hBp: 10, nonce: 1 },
      stale: true,
    });
    expect(container.querySelector('[data-testid="pdf-sync-highlight"]')).toBeNull();
  });

  it("reports double-clicks as PDF points with the page height", async () => {
    const p = await renderViewer({ page: 2 });
    const canvas = container.querySelector("canvas")!;
    canvas.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 100, height: 100 }) as DOMRect;
    await act(async () => {
      const event = new MouseEvent("dblclick", { clientX: 10 + 60, clientY: 20 + 80, bubbles: true });
      canvas.dispatchEvent(event);
    });
    expect(p.onCanvasDoubleClick).toHaveBeenCalledTimes(1);
    expect(p.onCanvasDoubleClick.mock.calls[0][0]).toEqual({
      page: 2,
      xPdf: 60 / SCALE,
      yPdf: 80 / SCALE,
      pageHeightBp: 792,
    });
  });

  it("keeps keyboard page controls working", async () => {
    const p = await renderViewer({ page: 1 });
    const next = Array.from(container.querySelectorAll("button")).find((b) =>
      /next pdf page/i.test(b.getAttribute("aria-label") ?? ""),
    )!;
    await act(async () => {
      next.click();
    });
    expect(p.onPageChange).toHaveBeenCalledWith(2);
  });

  it("surfaces load failures with a retry", async () => {
    const p = { ...props() };
    pdfjsMock.getDocument.mockReturnValue({ promise: Promise.reject(new Error("boom")) });
    await act(async () => {
      root.render(
        <PdfCanvasViewer
          pdfBytes={new Uint8Array([1])}
          page={1}
          onPageChange={p.onPageChange}
          onPageCount={p.onPageCount}
          highlight={null}
          stale={false}
          onCanvasDoubleClick={p.onCanvasDoubleClick}
          onError={p.onError}
        />,
      );
    });
    expect(container.textContent).toMatch(/failed to load/);
    expect(p.onError).toHaveBeenCalled();
  });
});
