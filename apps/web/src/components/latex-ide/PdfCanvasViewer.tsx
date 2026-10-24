"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

export type CanvasHighlight = {
  page: number;
  /** Big points from the left edge (SyncTeX top-left orientation). */
  xBp: number;
  /** Big points from the top edge; flipped with the page height. */
  yTopBp: number;
  wBp: number;
  hBp: number;
  nonce: number;
} | null;

export type CanvasPointClick = {
  page: number;
  /** pdf.js PDF big points (bottom-left origin). */
  xPdf: number;
  yPdf: number;
  pageHeightBp: number;
};

export type PdfTextRun = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
};
export type PdfPageLayout = {
  page: number;
  width: number;
  height: number;
  pageWidthBp: number;
  pageHeightBp: number;
  textRuns: PdfTextRun[];
};

type Props = {
  pdfBytes: Uint8Array | null;
  page: number;
  onPageChange: (page: number) => void;
  onPageCount: (count: number) => void;
  /** Coordinate highlight; hidden while stale. */
  highlight: CanvasHighlight;
  stale: boolean;
  onCanvasDoubleClick: (click: CanvasPointClick) => void;
  onError: (message: string) => void;
  navigationLocked?: boolean;
  renderOverlay?: (layout: PdfPageLayout) => React.ReactNode;
  onCanvasClick?: (click: CanvasPointClick) => void;
};

type ViewportLike = {
  width: number;
  height: number;
  viewBox: [number, number, number, number];
  convertToViewportPoint: (x: number, y: number) => [number, number];
  convertToPdfPoint: (x: number, y: number) => [number, number];
};

function clampPage(page: number, count: number): number {
  if (!Number.isSafeInteger(count) || count < 1) return 1;
  return Math.max(1, Math.min(count, page));
}

/**
 * Interactive PDF viewer on pdf.js: renders the current page to canvas at
 * 1:1 CSS pixels (canvas size equals the viewport size, so client offsets
 * map to viewport points without extra scaling), draws the SyncTeX
 * highlight rectangle from top-based big points, and reports double-clicks
 * as PDF points with the rendered page height for reverse search.
 */
export function PdfCanvasViewer({
  pdfBytes,
  page,
  onPageChange,
  onPageCount,
  highlight,
  stale,
  onCanvasDoubleClick,
  onError,
  renderOverlay,
  navigationLocked = false,
  onCanvasClick,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<ViewportLike | null>(null);
  const pageHeightRef = useRef<number>(0);
  const [viewportSize, setViewportSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [highlightBox, setHighlightBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [pageLayout, setPageLayout] = useState<PdfPageLayout | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      setContainerWidth(element.clientWidth),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const [numPages, setNumPages] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const docRef = useRef<{ destroy: () => Promise<void> } | null>(null);
  const shownHighlightNonce = useRef(0);
  // Parent callbacks are inline arrows; keep them in refs so document
  // load/render effects never re-run on callback identity changes.
  const callbacksRef = useRef({
    onPageChange,
    onPageCount,
    onCanvasDoubleClick,
    onError,
    onCanvasClick,
  });
  callbacksRef.current = {
    onPageChange,
    onPageCount,
    onCanvasDoubleClick,
    onError,
    onCanvasClick,
  };

  const fail = useCallback((message: string) => {
    setFailed(message);
    setLoading(false);
    callbacksRef.current.onError(message);
  }, []);

  // Load the document. getDocument transfers the buffer, so hand it a copy.
  useEffect(() => {
    if (!pdfBytes) return;
    let cancelled = false;
    setLoading(true);
    setFailed(null);
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (cancelled) return;
        try {
          const workerOptions = pdfjs.GlobalWorkerOptions as unknown as {
            workerSrc?: string;
          };
          if (!workerOptions.workerSrc) {
            workerOptions.workerSrc = new URL(
              "pdfjs-dist/build/pdf.worker.min.mjs",
              import.meta.url,
            ).toString();
          }
        } catch {
          // Worker URL resolution is best-effort; getDocument still runs and
          // reports a usable error when the worker cannot start.
        }
        const task = pdfjs.getDocument({ data: pdfBytes.slice() });
        const doc = (await task.promise) as unknown as {
          numPages: number;
          destroy: () => Promise<void>;
        };
        if (cancelled) {
          await doc.destroy();
          return;
        }
        await docRef.current?.destroy().catch(() => {});
        docRef.current = doc;
        setNumPages(doc.numPages);
        callbacksRef.current.onPageCount(doc.numPages);
        setLoading(false);
      } catch (error) {
        if (!cancelled)
          fail(
            error instanceof Error
              ? `Interactive PDF failed to load: ${error.message}`
              : "Interactive PDF failed to load.",
          );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfBytes, reloadNonce, fail]);

  useEffect(
    () => () => {
      void docRef.current?.destroy().catch(() => {});
      docRef.current = null;
    },
    [],
  );

  const extractText = Boolean(renderOverlay);

  // Render the current page. Canvas CSS size equals viewport size 1:1.
  useEffect(() => {
    const doc = docRef.current as unknown as {
      getPage: (n: number) => Promise<{
        view: [number, number, number, number];
        getTextContent?: () => Promise<{
          items: Array<{
            str?: string;
            transform?: number[];
            width?: number;
            height?: number;
          }>;
        }>;
        getViewport: (args: { scale: number }) => ViewportLike;
        render: (args: { canvasContext: unknown; viewport: ViewportLike }) => {
          promise: Promise<void>;
          cancel: () => void;
        };
      }>;
    } | null;
    const canvas = canvasRef.current;
    const scroller = scrollRef.current;
    if (!doc || !canvas || !scroller) return;
    setPageLayout(null);
    const target = clampPage(page, numPages);
    let cancelled = false;
    let renderTask: { promise: Promise<void>; cancel: () => void } | null =
      null;
    (async () => {
      try {
        const pdfPage = await doc.getPage(target);
        if (cancelled) return;
        const [x0, y0, x1, y1] = pdfPage.view;
        const pageWidthBp = Math.max(1, x1 - x0);
        const pageHeightBp = Math.max(1, y1 - y0);
        const available = Math.max(80, (scroller.clientWidth || 600) - 24);
        const scale = Math.max(0.2, (available / pageWidthBp) * zoom);
        const viewport = pdfPage.getViewport({ scale });
        viewportRef.current = viewport;
        pageHeightRef.current = pageHeightBp;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const context = canvas.getContext("2d");
        renderTask = pdfPage.render({ canvasContext: context, viewport });
        await renderTask.promise;
        if (cancelled) return;
        setViewportSize({ width: viewport.width, height: viewport.height });
        if (extractText) {
          const content = await pdfPage
            .getTextContent?.()
            .catch(() => ({ items: [] }));
          if (cancelled) return;
          const textRuns: PdfTextRun[] = [];
          for (const item of content?.items ?? []) {
            const t = item.transform;
            if (
              !item.str?.trim() ||
              !t ||
              t.length < 6 ||
              Math.abs(t[1]) > 0.01 ||
              Math.abs(t[2]) > 0.01
            )
              continue;
            const [left, baseline] = viewport.convertToViewportPoint(
              t[4],
              t[5],
            );
            const [right, top] = viewport.convertToViewportPoint(
              t[4] + (item.width ?? 0),
              t[5] + (item.height || Math.abs(t[3])),
            );
            if (![left, top, right, baseline].every(Number.isFinite)) continue;
            textRuns.push({
              text: item.str,
              left: Math.min(left, right),
              top: Math.min(top, baseline),
              width: Math.abs(right - left),
              height: Math.abs(baseline - top),
            });
          }
          setPageLayout({
            page: target,
            width: viewport.width,
            height: viewport.height,
            pageWidthBp,
            pageHeightBp,
            textRuns,
          });
        }
      } catch (error) {
        if (cancelled) return;
        const cancelledRender =
          error instanceof Error &&
          (error.name === "RenderingCancelledException" ||
            error.message.includes("cancelled"));
        if (!cancelledRender)
          fail(
            error instanceof Error
              ? `Interactive PDF failed to render: ${error.message}`
              : "Interactive PDF failed to render.",
          );
      }
    })();
    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // Ignore cancellation races on unmount or page change.
      }
      viewportRef.current = null;
    };
  }, [
    page,
    numPages,
    zoom,
    loading,
    failed,
    reloadNonce,
    fail,
    extractText,
    containerWidth,
  ]);

  // Position the highlight rectangle from top-based big points.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (
      !viewport ||
      !highlight ||
      stale ||
      highlight.page !== clampPage(page, numPages)
    ) {
      setHighlightBox(null);
      return;
    }
    const pageHeightBp = pageHeightRef.current;
    if (!(pageHeightBp > 0)) {
      setHighlightBox(null);
      return;
    }
    // PDF corners (bottom-left origin), then to viewport points.
    const [ax, ay] = viewport.convertToViewportPoint(
      highlight.xBp,
      pageHeightBp - highlight.yTopBp,
    );
    const [bx, by] = viewport.convertToViewportPoint(
      highlight.xBp + highlight.wBp,
      pageHeightBp - (highlight.yTopBp + highlight.hBp),
    );
    setHighlightBox({
      left: Math.min(ax, bx),
      top: Math.min(ay, by),
      width: Math.max(2, Math.abs(bx - ax)),
      height: Math.max(2, Math.abs(by - ay)),
    });
  }, [highlight, stale, page, numPages, viewportSize]);

  // Scroll the highlight into view once per navigation.
  useEffect(() => {
    if (!highlight || stale || highlight.nonce === shownHighlightNonce.current)
      return;
    shownHighlightNonce.current = highlight.nonce;
    highlightRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [highlight, stale, highlightBox]);

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>, single = false) => {
      const viewport = viewportRef.current;
      const canvas = canvasRef.current;
      if (!viewport || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const [xPdf, yPdf] = viewport.convertToPdfPoint(
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      if (!Number.isFinite(xPdf) || !Number.isFinite(yPdf)) return;
      const callback = single
        ? callbacksRef.current.onCanvasClick
        : callbacksRef.current.onCanvasDoubleClick;
      callback?.({
        page: clampPage(page, numPages),
        xPdf,
        yPdf,
        pageHeightBp: pageHeightRef.current,
      });
    },
    [numPages, page],
  );

  if (!pdfBytes) return null;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="pdf-canvas-viewer"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-1.5">
        <button
          type="button"
          aria-label="Previous PDF page"
          disabled={navigationLocked || page <= 1}
          onClick={() => onPageChange(clampPage(page - 1, numPages))}
          className="rounded border border-border px-2 py-0.5 text-xs disabled:opacity-50"
        >
          ←
        </button>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Page
          <input
            aria-label="Current PDF page"
            disabled={navigationLocked}
            inputMode="numeric"
            value={String(clampPage(page, numPages))}
            onChange={(e) => {
              const next = Number.parseInt(e.target.value, 10);
              if (Number.isSafeInteger(next)) onPageChange(next);
            }}
            className="w-12 rounded border border-border bg-background px-1 py-0.5 text-xs"
          />
          <span aria-label="Total PDF pages">of {numPages}</span>
        </label>
        <button
          type="button"
          aria-label="Next PDF page"
          disabled={navigationLocked || page >= numPages}
          onClick={() => onPageChange(clampPage(page + 1, numPages))}
          className="rounded border border-border px-2 py-0.5 text-xs disabled:opacity-50"
        >
          →
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          disabled={navigationLocked}
          onClick={() =>
            setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))
          }
          className="rounded border border-border px-2 py-0.5 text-xs"
        >
          −
        </button>
        <button
          type="button"
          aria-label="Zoom in"
          disabled={navigationLocked}
          onClick={() =>
            setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))
          }
          className="rounded border border-border px-2 py-0.5 text-xs"
        >
          +
        </button>
      </div>
      <div
        ref={scrollRef}
        className="relative min-h-0 flex-1 overflow-auto bg-muted/60 p-3"
      >
        {loading && (
          <p className="text-xs text-muted-foreground" role="status">
            Rendering PDF…
          </p>
        )}
        {failed && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-xs text-muted-foreground" role="alert">
              {failed}
            </p>
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="rounded border border-border px-2 py-1 text-xs"
            >
              Retry
            </button>
          </div>
        )}
        <div className="relative inline-block">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`PDF page ${clampPage(page, numPages)}`}
            onDoubleClick={onCanvasClick ? undefined : handleDoubleClick}
            onClick={
              onCanvasClick
                ? (event) => handleDoubleClick(event, true)
                : undefined
            }
            className="block bg-white shadow"
          />
          {pageLayout && !loading && !failed && renderOverlay?.(pageLayout)}
          {highlightBox && (
            <div
              ref={highlightRef}
              data-testid="pdf-sync-highlight"
              role="status"
              aria-label="SyncTeX match"
              className="pointer-events-none absolute rounded-sm bg-primary/25 ring-2 ring-primary/70"
              style={{
                left: highlightBox.left,
                top: highlightBox.top,
                width: highlightBox.width,
                height: highlightBox.height,
              }}
            />
          )}
        </div>
        {!onCanvasClick && (
          <p className="mt-2 text-xs text-muted-foreground">
            Double-click a point to jump to its source line.
          </p>
        )}
      </div>
    </div>
  );
}
