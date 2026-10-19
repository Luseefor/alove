"use client";

import React from "react";
import { FileText, Loader2, Play } from "lucide-react";
import { useWorkbenchStore } from "@/stores/workbenchStore";

export function PdfPreviewPane() {
  const { pdfDataUrl, buildStatus, buildMessage, runCompile, mainFile, documentRevision, pdfSourceRevision, pdfMainFile } = useWorkbenchStore();
  const busy = buildStatus === "queued" || buildStatus === "running";
  const failed = buildStatus === "failed";
  const stale = Boolean(pdfDataUrl) && pdfSourceRevision !== null && documentRevision !== pdfSourceRevision;
  const filename = (pdfMainFile ?? mainFile ?? "main.tex").split("/").at(-1)!.replace(/\.tex$/i, ".pdf");
  const status = busy ? buildStatus === "queued" ? "Queued…" : "Compiling…" : failed ? "Build failed" : stale ? "Stale preview" : pdfDataUrl ? "Ready" : "Not built";

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-l border-border bg-muted/40" data-testid="pdf-preview-pane" data-status={buildStatus} aria-label="PDF preview">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
        <FileText size={15} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={filename}>{filename}</span>
        {pdfDataUrl && <a href={pdfDataUrl} download={filename} className="shrink-0 rounded px-2 py-1 text-xs text-primary hover:bg-muted">Download</a>}
      </div>
      {pdfDataUrl ? (
        <>
          <div className="shrink-0 border-b border-border bg-background px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 text-xs font-medium" role="status">{status}</span>
              <button type="button" disabled={busy} onClick={() => void runCompile()} className="shrink-0 rounded border border-border px-2 py-1 text-xs disabled:opacity-50">{busy ? status : "Rebuild"}</button>
            </div>
            {(busy || failed || stale) && <p className="mt-1 text-xs text-muted-foreground">Showing last successful preview{stale ? " · Source changed since last build" : ""}</p>}
            {failed && buildMessage && <p className="mt-1 break-words text-xs text-muted-foreground">{buildMessage}</p>}
          </div>
          <iframe src={pdfDataUrl} className="min-h-0 w-full flex-1 border-0" title="Compiled PDF" />
        </>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-5">
          <div className="w-full max-w-xs text-center">
            {busy ? <Loader2 size={30} className="mx-auto mb-4 animate-spin text-primary" /> : <FileText size={32} strokeWidth={1.25} className="mx-auto mb-4 text-muted-foreground/60" />}
            <h2 className="text-sm font-semibold">{busy ? status : failed ? "Build failed" : "Document not built"}</h2>
            <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">{failed ? buildMessage ?? "Check the build log for details." : busy ? "Generating your PDF preview." : "Build your project to see the PDF here."}</p>
            <button type="button" onClick={() => void runCompile()} disabled={busy} className="mt-5 inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50">
              <Play size={13} />{busy ? status : failed ? "Retry Build" : "Start Build"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
