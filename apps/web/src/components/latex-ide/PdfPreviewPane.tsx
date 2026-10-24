"use client";

import React, { useEffect, useMemo, useState, type RefObject } from "react";
import { useIdeSettingsStore } from "@/stores/ideSettingsStore";
import { FileText, Loader2, Play } from "lucide-react";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import { isBlankPdfSource } from "@/lib/pdfEditBridge";
import { PdfVisualBlankPage } from "./PdfVisualBlankPage";
import type { PdfEditBridge } from "@/lib/pdfEditBridge";
import { findSourceForPdf, syncTexEntryToBp } from "@/lib/synctex";
import { parseVisualObjects } from "@/lib/visualObjects";
import { PdfVisualEditor, type PdfTextDraft } from "./PdfVisualEditor";
import { PdfCanvasViewer } from "./PdfCanvasViewer";

export function PdfPreviewPane({
  visualEditing = false,
  pdfEditBridge,
  onRequestSource,
}: {
  visualEditing?: boolean;
  pdfEditBridge?: RefObject<PdfEditBridge | null>;
  onRequestSource?: () => void;
} = {}) {
  const {
    pdfDataUrl,
    buildStatus,
    buildMessage,
    runCompile,
    mainFile,
    activeFileId,
    cursor,
    documentRevision,
    pdfSourceRevision,
    pdfMainFile,
    pdfPage,
    setPdfPage,
    setPdfPageCount,
    synctexMapping,
    synctexRevision,
    pdfHighlight,
    goToPdfForCursor,
    goToSourceForPdfPage,
    goToSourceForPdfPoint,
    setBuildRecoveryOpen,
  } = useWorkbenchStore();
  const blankSource = useWorkbenchStore((s) =>
    s.mainFile ? s.filesByPath[s.mainFile] : undefined,
  );
  const showBlankPage =
    visualEditing &&
    !!pdfEditBridge &&
    !pdfDataUrl &&
    isBlankPdfSource(blankSource);
  const [pdfDraftOpen, setPdfDraftOpen] = useState(false);
  const [pdfTextDraft, setPdfTextDraft] = useState<PdfTextDraft | null>(null);
  const [blankDraftText, setBlankDraftText] = useState("");
  const projectId = useWorkbenchStore((s) => s.projectId);
  useEffect(() => {
    setPdfTextDraft(null);
    setBlankDraftText("");
  }, [projectId, mainFile]);
  useEffect(() => {
    if (!pdfTextDraft && !blankDraftText.trim()) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [pdfTextDraft, blankDraftText]);
  const viewerStyle = useIdeSettingsStore((s) => s.pdfViewerStyle);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  const [syncedPage, setSyncedPage] = useState<number | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [reversePage, setReversePage] = useState<string>("");
  const [viewerMode, setViewerMode] = useState<
    "auto" | "iframe" | "interactive"
  >("auto");
  useEffect(() => {
    if (!pdfDataUrl || typeof URL.createObjectURL !== "function") {
      setBrowserUrl(null);
      return;
    }
    const encoded = pdfDataUrl.split(",")[1];
    if (!encoded) return;
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    const url = URL.createObjectURL(
      new Blob([bytes], { type: "application/pdf" }),
    );
    setBrowserUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pdfDataUrl]);
  // A new build invalidates the last sync jump; stale-source guard below
  // blocks navigation until the next successful compile.
  useEffect(() => {
    setSyncedPage(null);
    setSyncMessage(null);
  }, [pdfDataUrl, synctexRevision]);
  // Decode once for the interactive canvas viewer. The iframe and browser
  // flows keep using the data URL untouched.
  const pdfBytes = useMemo(() => {
    if (!pdfDataUrl) return null;
    const encoded = pdfDataUrl.split(",")[1];
    if (!encoded) return null;
    try {
      return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    } catch {
      return null;
    }
  }, [pdfDataUrl]);
  const busy = buildStatus === "queued" || buildStatus === "running";
  const failed = buildStatus === "failed";
  const stale =
    Boolean(pdfDataUrl) &&
    pdfSourceRevision !== null &&
    documentRevision !== pdfSourceRevision;
  const synctexStale =
    synctexRevision === null || documentRevision !== synctexRevision;
  const hasSynctex =
    Boolean(synctexMapping) && (synctexMapping?.entries.length ?? 0) > 0;
  const syncDisabled = busy || !pdfDataUrl || !hasSynctex || synctexStale;
  // The interactive canvas viewer needs decoded bytes plus a fresh mapping.
  // Auto mode enables it exactly then; the browser-object-URL flow stays on
  // the native viewer. Without a mapping the default iframe render is
  // byte-for-byte what the existing tests assert.
  const interactiveAvailable =
    hasSynctex &&
    !synctexStale &&
    viewerStyle !== "browser" &&
    pdfBytes !== null;
  const interactiveActive =
    pdfDataUrl !== null &&
    (visualEditing ||
      (viewerMode !== "iframe" &&
        (viewerMode === "interactive" ||
          (viewerMode === "auto" && interactiveAvailable))));
  const filename = (pdfMainFile ?? mainFile ?? "main.tex")
    .split("/")
    .at(-1)!
    .replace(/\.tex$/i, ".pdf");
  const status = busy
    ? buildStatus === "queued"
      ? "Queued…"
      : "Compiling…"
    : failed
      ? "Build failed"
      : stale
        ? "Stale preview"
        : pdfDataUrl
          ? "Ready"
          : "Not built";

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-muted/40"
      data-testid="pdf-preview-pane"
      data-status={buildStatus}
      aria-label="PDF preview"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
        <FileText size={15} className="shrink-0 text-muted-foreground" />
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium"
          title={filename}
        >
          {filename}
        </span>
        {pdfDataUrl && (
          <a
            href={pdfDataUrl}
            download={filename}
            className="shrink-0 rounded px-2 py-1 text-xs text-primary hover:bg-muted"
          >
            Download
          </a>
        )}
      </div>
      {visualEditing && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-panel-header px-3 py-2 text-xs">
          <span className="min-w-0 flex-1">
            {!pdfDataUrl
              ? showBlankPage
                ? "Write your first paragraph on the page."
                : "Build your document to edit the PDF page."
              : synctexStale
                ? "Rebuild to continue editing this page."
                : "Click text to edit. Click a table, figure, or equation for its controls."}
          </span>
          <button
            type="button"
            onClick={onRequestSource}
            className="rounded px-2 py-1 text-primary hover:bg-muted"
          >
            Edit in Source
          </button>
        </div>
      )}
      {failed && (
        <div className="shrink-0 border-b border-border bg-background p-2">
          <button
            type="button"
            className="rounded border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            onClick={() => setBuildRecoveryOpen(true)}
          >
            Find breaking change
          </button>
        </div>
      )}
      {showBlankPage && pdfEditBridge ? (
        <PdfVisualBlankPage
          bridge={pdfEditBridge}
          text={blankDraftText}
          onTextChange={setBlankDraftText}
        />
      ) : pdfDataUrl ? (
        <>
          <div className="shrink-0 border-b border-border bg-background px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 text-xs font-medium" role="status">
                {status}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runCompile()}
                className="shrink-0 rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
              >
                {busy ? status : "Rebuild"}
              </button>
            </div>
            {(busy || failed || stale) && (
              <p className="mt-1 text-xs text-muted-foreground">
                Showing last successful preview
                {stale ? " · Source changed since last build" : ""}
              </p>
            )}
            {failed && buildMessage && (
              <p className="mt-1 break-words text-xs text-muted-foreground">
                {buildMessage}
              </p>
            )}
          </div>
          <div
            className="shrink-0 border-b border-border bg-background px-3 py-2"
            hidden={visualEditing}
            data-testid="synctex-controls"
          >
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={syncDisabled}
                onClick={() => {
                  const page = goToPdfForCursor();
                  if (page !== null) {
                    setSyncedPage(page);
                    setSyncMessage(
                      `PDF page ${page} for ${activeFileId ?? "source"}:${cursor?.line ?? 1}`,
                    );
                  } else if (!hasSynctex) {
                    setSyncMessage("No SyncTeX mapping for this build.");
                  } else if (synctexStale) {
                    setSyncMessage(
                      "Source changed since last build. Rebuild to sync.",
                    );
                  } else {
                    setSyncMessage("No PDF position for the current cursor.");
                  }
                }}
                className="shrink-0 rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
              >
                Go to PDF for cursor
              </button>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                Page
                <input
                  aria-label="PDF page for reverse sync"
                  inputMode="numeric"
                  value={reversePage}
                  placeholder={String(pdfPage)}
                  onChange={(e) => setReversePage(e.target.value)}
                  className="w-12 rounded border border-border bg-background px-1 py-0.5 text-xs"
                />
              </label>
              <button
                type="button"
                disabled={syncDisabled}
                onClick={() => {
                  const raw = reversePage.trim();
                  const page = raw === "" ? pdfPage : Number.parseInt(raw, 10);
                  if (!Number.isSafeInteger(page) || page <= 0) {
                    setSyncMessage("Enter a valid PDF page number.");
                    return;
                  }
                  const target = goToSourceForPdfPage(page);
                  if (target) {
                    setSyncMessage(
                      `Source ${target.file}:${target.line} for PDF page ${page}`,
                    );
                  } else if (!hasSynctex) {
                    setSyncMessage("No SyncTeX mapping for this build.");
                  } else if (synctexStale) {
                    setSyncMessage(
                      "Source changed since last build. Rebuild to sync.",
                    );
                  } else {
                    setSyncMessage(`No source mapped for PDF page ${page}.`);
                  }
                }}
                className="shrink-0 rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
              >
                Go to source for page
              </button>
            </div>
            <p
              className="mt-1 text-xs text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              {!hasSynctex
                ? "SyncTeX unavailable for this build."
                : synctexStale
                  ? "SyncTeX stale. Rebuild to re-enable source–PDF sync."
                  : (syncMessage ??
                    "SyncTeX ready. Jump between source and PDF.")}
              {synctexMapping?.truncated
                ? " Mapping truncated to transport limits."
                : ""}
            </p>
            {hasSynctex && !visualEditing && viewerStyle !== "browser" && (
              <div
                className="mt-2 flex items-center gap-1"
                role="group"
                aria-label="PDF viewer"
              >
                <button
                  type="button"
                  aria-pressed={!interactiveActive}
                  onClick={() => setViewerMode("iframe")}
                  className="rounded border border-border px-2 py-0.5 text-xs aria-pressed:bg-primary/10 aria-pressed:text-primary"
                >
                  Default
                </button>
                <button
                  type="button"
                  aria-pressed={interactiveActive}
                  disabled={
                    !interactiveAvailable && viewerMode !== "interactive"
                  }
                  onClick={() => setViewerMode("interactive")}
                  title={
                    interactiveAvailable
                      ? "Coordinate SyncTeX with click-to-source"
                      : "Rebuild to enable the interactive viewer"
                  }
                  className="rounded border border-border px-2 py-0.5 text-xs disabled:opacity-50 aria-pressed:bg-primary/10 aria-pressed:text-primary"
                >
                  Interactive
                </button>
              </div>
            )}
          </div>
          {visualEditing && syncMessage && (
            <p
              role="status"
              className="shrink-0 bg-panel-header px-3 py-2 text-xs text-muted-foreground"
            >
              {syncMessage}
            </p>
          )}
          {interactiveActive ? (
            <PdfCanvasViewer
              pdfBytes={pdfBytes}
              page={pdfPage}
              onPageChange={setPdfPage}
              onPageCount={setPdfPageCount}
              navigationLocked={pdfDraftOpen}
              highlight={pdfHighlight}
              stale={synctexStale}
              renderOverlay={
                visualEditing && pdfEditBridge
                  ? (layout) => (
                      <PdfVisualEditor
                        layout={layout}
                        bridge={pdfEditBridge}
                        onEditingChange={setPdfDraftOpen}
                        draft={pdfTextDraft}
                        onDraftChange={setPdfTextDraft}
                      />
                    )
                  : undefined
              }
              onCanvasClick={
                visualEditing
                  ? async (click) => {
                      const current = useWorkbenchStore.getState();
                      const revision = current.documentRevision,
                        project = current.projectId;
                      if (current.projectRole === "viewer") {
                        setSyncMessage("This project is read-only.");
                        return;
                      }
                      if (
                        current.synctexRevision !== revision ||
                        current.buildStatus === "queued" ||
                        current.buildStatus === "running"
                      ) {
                        setSyncMessage("Rebuild to edit the current PDF.");
                        return;
                      }
                      const target = findSourceForPdf(
                        current.synctexMapping,
                        click.page,
                        click.xPdf,
                        click.pageHeightBp - click.yPdf,
                      );
                      const source = target && current.filesByPath[target.file];
                      if (!target || typeof source !== "string") {
                        setSyncMessage(
                          "No editable source is mapped here. Use Edit in Source.",
                        );
                        return;
                      }
                      const objects = parseVisualObjects(source).filter(
                        (entry) => {
                          const first = source
                              .slice(0, entry.from)
                              .split("\n").length,
                            last = source.slice(0, entry.to).split("\n").length;
                          return target.line >= first && target.line <= last;
                        },
                      );
                      const object = objects.length === 1 ? objects[0] : null;
                      if (!object) {
                        setSyncMessage(
                          "Click highlighted text to edit it. Custom typesetting can be edited in Source.",
                        );
                        return;
                      }
                      const firstLine = source
                        .slice(0, object.from)
                        .split("\n").length;
                      const lastLine = source
                        .slice(0, object.to)
                        .split("\n").length;
                      const hit = current.synctexMapping?.entries.some(
                        (entry) => {
                          if (
                            entry.file !== target.file ||
                            entry.page !== click.page ||
                            entry.line < firstLine ||
                            entry.line > lastLine + 1
                          )
                            return false;
                          const box = syncTexEntryToBp(
                            current.synctexMapping,
                            entry,
                          );
                          const y = click.pageHeightBp - click.yPdf;
                          return (
                            click.xPdf >= box.xBp - 12 &&
                            click.xPdf <=
                              box.xBp + Math.max(box.wBp, 12) + 12 &&
                            y >= box.yTopBp - Math.max(box.hBp, 12) - 12 &&
                            y <= box.yTopBp + 12
                          );
                        },
                      );
                      if (!hit) {
                        setSyncMessage(
                          "Click directly on a mapped object to edit it.",
                        );
                        return;
                      }
                      current.openFile(target.file);
                      for (let i = 0; i < 20; i++) {
                        await new Promise<void>((resolve) =>
                          requestAnimationFrame(() => resolve()),
                        );
                        const now = useWorkbenchStore.getState();
                        if (
                          now.projectId !== project ||
                          now.documentRevision !== revision ||
                          now.projectRole === "viewer"
                        )
                          return;
                        if (
                          pdfEditBridge?.current?.fileId === target.file &&
                          pdfEditBridge.current.openObjectAt(
                            source,
                            object.from,
                          )
                        ) {
                          setSyncMessage(null);
                          return;
                        }
                      }
                      setSyncMessage(
                        "The source editor is not ready. Try clicking the object again.",
                      );
                    }
                  : undefined
              }
              onCanvasDoubleClick={(click) => {
                const target = goToSourceForPdfPoint(click);
                if (target) {
                  setSyncMessage(
                    `Source ${target.file}:${target.line} for PDF page ${click.page}`,
                  );
                } else if (synctexStale) {
                  setSyncMessage(
                    "Source changed since last build. Rebuild to sync.",
                  );
                } else {
                  setSyncMessage(
                    `No source mapped for PDF page ${click.page}.`,
                  );
                }
              }}
              onError={(message) => setSyncMessage(message)}
            />
          ) : viewerStyle === "browser" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-5 text-center">
              <p className="text-xs text-muted-foreground">
                Open this build in your browser’s PDF viewer.
              </p>
              {browserUrl && (
                <a
                  href={
                    syncedPage === null
                      ? browserUrl
                      : `${browserUrl}#page=${syncedPage}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded bg-primary px-3 py-2 text-xs text-primary-foreground"
                >
                  Open PDF in browser tab
                </a>
              )}
            </div>
          ) : (
            <iframe
              src={
                syncedPage === null
                  ? viewerStyle === "overleaf"
                    ? `${pdfDataUrl}#view=FitH&toolbar=0`
                    : pdfDataUrl
                  : viewerStyle === "overleaf"
                    ? `${pdfDataUrl}#page=${syncedPage}&view=FitH&toolbar=0`
                    : `${pdfDataUrl}#page=${syncedPage}`
              }
              className="min-h-0 w-full flex-1 border-0"
              title="Compiled PDF"
            />
          )}
        </>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-5">
          <div className="w-full max-w-xs text-center">
            {busy ? (
              <Loader2
                size={30}
                className="mx-auto mb-4 animate-spin text-primary"
              />
            ) : (
              <FileText
                size={32}
                strokeWidth={1.25}
                className="mx-auto mb-4 text-muted-foreground/60"
              />
            )}
            <h2 className="text-sm font-semibold">
              {busy ? status : failed ? "Build failed" : "Document not built"}
            </h2>
            <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
              {failed
                ? (buildMessage ?? "Check the build log for details.")
                : busy
                  ? "Generating your PDF preview."
                  : "Build your project to see the PDF here."}
            </p>
            <button
              type="button"
              onClick={() => void runCompile()}
              disabled={busy}
              className="mt-5 inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              <Play size={13} />
              {busy ? status : failed ? "Retry Build" : "Start Build"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
