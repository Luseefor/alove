import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfCanvasViewer } from "@/components/latex-ide/PdfCanvasViewer";

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

const SCALE = 2;
const pdfBytes = new Uint8Array([1, 2, 3]);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makePage() {
  const viewport = {
    width: 612 * SCALE,
    height: 792 * SCALE,
    viewBox: [0, 0, 612, 792] as [number, number, number, number],
    convertToViewportPoint: (x: number, y: number): [number, number] => [
      x * SCALE,
      y * SCALE,
    ],
    convertToPdfPoint: (x: number, y: number): [number, number] => [
      x / SCALE,
      y / SCALE,
    ],
  };
  return {
    view: [0, 0, 612, 792] as [number, number, number, number],
    getViewport: () => viewport,
    render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
  };
}

function docWithPages(count: number, seenPages: number[]) {
  return {
    numPages: count,
    destroy: vi.fn(async () => {}),
    getPage: vi.fn(async (n: number) => {
      seenPages.push(n);
      return makePage();
    }),
  };
}

// Parent navigation retains the requested page/highlight verbatim,
// even when requested before the new document reports its page count.
function EarlySyncHarness({
  onReady,
}: {
  onReady: (api: { forwardSyncToPage3: () => void }) => void;
}) {
  const [page, setPage] = React.useState(1);
  const [highlight, setHighlight] =
    React.useState<React.ComponentProps<typeof PdfCanvasViewer>["highlight"]>(
      null,
    );

  const forwardSyncToPage3 = React.useCallback(() => {
    setPage(3);
    setHighlight((prev) => ({
      page: 3,
      xBp: 100,
      yTopBp: 50,
      wBp: 200,
      hBp: 10,
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  }, []);

  React.useEffect(() => {
    onReady({ forwardSyncToPage3 });
  }, [forwardSyncToPage3, onReady]);

  return (
    <PdfCanvasViewer
      pdfBytes={pdfBytes}
      page={page}
      onPageChange={setPage}
      onPageCount={() => {}}
      highlight={highlight}
      stale={false}
      onCanvasDoubleClick={() => {}}
      onError={() => {}}
    />
  );
}

describe("PdfCanvasViewer early forward-sync seam", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    pdfjsMock.getDocument.mockReset();
    pdfjsMock.GlobalWorkerOptions.workerSrc = undefined;
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => null,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView =
        vi.fn() as unknown as typeof Element.prototype.scrollIntoView;
    }
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("retains page=3/highlight=3 requested before load and renders the highlight after numPages=3 lands", async () => {
    const seenPages: number[] = [];
    const docGate = deferred<ReturnType<typeof docWithPages>>();
    pdfjsMock.getDocument.mockReturnValue({ promise: docGate.promise });
    let api: { forwardSyncToPage3: () => void } | null = null;

    await act(async () => {
      root.render(
        <EarlySyncHarness
          onReady={(a) => {
            api = a;
          }}
        />,
      );
    });
    expect(api).toBeTruthy();

    // Request lands BEFORE getDocument resolves (deferred load contract).
    await act(async () => {
      api!.forwardSyncToPage3();
    });

    // Page prop is retained verbatim while the doc is still pending.
    const earlyInput = container.querySelector(
      'input[aria-label="Current PDF page"]',
    ) as HTMLInputElement | null;
    expect(earlyInput?.value).toBe("1");

    // Load resolves to the matching 3-page document.
    const doc = docWithPages(3, seenPages);
    await act(async () => {
      docGate.resolve(doc);
      await docGate.promise;
    });
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      await Promise.resolve();
    });

    const pageInput = container.querySelector(
      'input[aria-label="Current PDF page"]',
    ) as HTMLInputElement | null;
    expect(pageInput?.value).toBe("3");
    expect(container.textContent).toMatch(/of 3/);
    expect(pdfjsMock.getDocument).toHaveBeenCalledTimes(1);
    expect(seenPages).toContain(3);
    const highlight = container.querySelector(
      '[data-testid="pdf-sync-highlight"]',
    ) as HTMLElement | null;
    expect(highlight).toBeTruthy();
  });
});
