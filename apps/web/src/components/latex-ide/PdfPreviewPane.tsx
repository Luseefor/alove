"use client";

import { 
  ZoomIn, 
  ZoomOut, 
  FileWarning, 
  RotateCw, 
  ChevronLeft, 
  ChevronRight, 
  Loader2, 
  Download, 
  Layers,
  ChevronDown,
  Play
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import { useEffect, useMemo, useState } from "react";

export function PdfPreviewPane() {
  const {
    runCompile,
    pdfDataUrl,
    buildStatus,
    buildMessage,
    pdfZoom,
    setPdfZoom,
    pdfPage,
    pdfPageCount,
    setPdfPage,
    setPdfPageCount,
  } = useWorkbenchStore();
  const pdfViewerSrc = pdfDataUrl ? `${pdfDataUrl}#page=${pdfPage}&zoom=${pdfZoom}` : null;
  const [pageInput, setPageInput] = useState("1");
  const pageChips = useMemo(() => {
    const cap = Math.min(pdfPageCount, 24);
    return Array.from({ length: cap }, (_, i) => i + 1);
  }, [pdfPageCount]);

  useEffect(() => {
    if (!pdfDataUrl) {
      setPdfPageCount(1);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc =
          "https://unpkg.com/pdfjs-dist@5.6.205/build/pdf.worker.min.mjs";
        const doc = await pdfjs.getDocument(pdfDataUrl).promise;
        if (!cancelled) {
          setPdfPageCount(doc.numPages || 1);
        }
      } catch {
        if (!cancelled) setPdfPageCount(1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfDataUrl, setPdfPageCount]);

  useEffect(() => {
    setPageInput(String(pdfPage));
  }, [pdfPage]);
  return (
    <div data-testid="pdf-preview-pane" className="h-full flex flex-col bg-[#525659] dark:bg-muted/10 overflow-hidden relative">
      <div className="h-9 bg-background border-b flex items-center justify-between px-2 shrink-0 z-40 select-none">
        <div className="flex items-center gap-1">
           <button
             onClick={() => void runCompile()}
             className="flex items-center gap-1.5 px-3 py-1 bg-primary text-primary-foreground rounded text-[11px] font-bold hover:opacity-90 transition-all"
            >
              {buildStatus === "running" ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              <span>Recompile</span>
              <ChevronDown size={12} className="opacity-60 border-l border-primary-foreground/20 pl-1" />
            </button>
            <span
              data-testid="compile-status"
              data-status={buildStatus}
              className="sr-only"
              aria-live="polite"
            >
              {buildStatus}
              {buildMessage ? `: ${buildMessage}` : ""}
            </span>

            <div className="w-px h-4 bg-border mx-1" />

            <button className="p-1.5 hover:bg-muted rounded text-muted-foreground"><Layers size={14} /></button>
           <a
             href={pdfDataUrl ?? undefined}
             download="output.pdf"
             className={cn(
               "p-1.5 rounded",
               pdfDataUrl ? "hover:bg-muted text-muted-foreground" : "text-muted-foreground/40 pointer-events-none",
             )}
           >
             <Download size={14} />
           </a>
        </div>

        <div className="flex items-center gap-2 bg-muted rounded p-0.5 text-[11px] font-bold">
           <button
             onClick={() => setPdfPage(pdfPage - 1)}
             className="p-1 hover:bg-background rounded text-muted-foreground"
           >
             <ChevronLeft size={14} />
           </button>
           <div className="flex items-center gap-1 px-1">
              <span>{pdfPage}</span>
              <span className="opacity-30">/</span>
              <span className="opacity-60">{pdfPageCount}</span>
           </div>
           <button
             onClick={() => setPdfPage(pdfPage + 1)}
             className="p-1 hover:bg-background rounded text-muted-foreground"
           >
             <ChevronRight size={14} />
           </button>
           <input
             value={pageInput}
             onChange={(e) => setPageInput(e.target.value.replace(/[^\d]/g, ""))}
             onKeyDown={(e) => {
               if (e.key === "Enter") {
                 const parsed = Number(pageInput || "1");
                 if (!Number.isNaN(parsed)) setPdfPage(parsed);
               }
             }}
             className="h-6 w-12 rounded border bg-background px-1 text-center text-[11px] font-medium outline-none"
           />
        </div>

        <div className="flex items-center gap-0.5">
           <button
             onClick={() => setPdfZoom(pdfZoom - 10)}
             className="p-1.5 hover:bg-muted rounded text-muted-foreground"
           >
             <ZoomOut size={14} />
           </button>
           <span className="text-[11px] font-bold w-10 text-center">{pdfZoom}%</span>
           <button
             onClick={() => setPdfZoom(pdfZoom + 10)}
             className="p-1.5 hover:bg-muted rounded text-muted-foreground"
           >
             <ZoomIn size={14} />
           </button>
           <div className="w-px h-4 bg-border mx-1" />
           <button className="p-1.5 hover:bg-muted rounded text-muted-foreground"><RotateCw size={14} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8 flex flex-col items-center gap-6 no-scrollbar">
        {pdfDataUrl && (
          <div className="w-full max-w-[860px] rounded border bg-background/70 p-2 flex items-center gap-1 overflow-auto">
            {pageChips.map((p) => (
              <button
                key={p}
                onClick={() => setPdfPage(p)}
                className={cn(
                  "h-7 min-w-7 rounded px-2 text-[11px] border",
                  pdfPage === p ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground border-border hover:bg-muted",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        )}
        {pdfDataUrl ? (
          <iframe
            title="Compiled PDF"
            src={pdfViewerSrc ?? pdfDataUrl}
            className="bg-white shadow-2xl w-[min(820px,100%)] h-[calc(100%-8px)]"
            style={{ transform: `scale(${pdfZoom / 100})`, transformOrigin: "top center" }}
          />
        ) : (
          <div
            data-testid="pdf-preview-empty"
            className="w-[min(700px,100%)] min-h-[420px] border border-dashed border-white/30 rounded-lg grid place-items-center text-white/80 text-sm px-8 text-center"
          >
            <div className="space-y-2">
              <FileWarning className="mx-auto" size={22} />
              <p>No compiled PDF yet. Click Recompile to build your document.</p>
              {buildMessage && (
                <p data-testid="pdf-preview-error" className="text-xs text-white/60">
                  {buildMessage}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
