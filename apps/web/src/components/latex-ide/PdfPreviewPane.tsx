"use client";

import React from "react";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import { FileText, XCircle, Play } from "lucide-react";

function baseName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function toPdfFileName(source: string | null | undefined): string {
  if (!source) return "main.pdf";
  const base = baseName(source);
  if (/\.tex$/i.test(base)) return base.replace(/\.tex$/i, ".pdf");
  return base;
}

function statusLabel(buildStatus: "idle" | "queued" | "running" | "ready" | "failed"): string {
  switch (buildStatus) {
    case "queued":
      return "Queued";
    case "running":
      return "Compiling…";
    case "ready":
      return "Ready";
    case "failed":
      return "Build failed";
    case "idle":
    default:
      return "Not built";
  }
}

export function PdfPreviewPane() {
  const pdfDataUrl = useWorkbenchStore((s) => s.pdfDataUrl);
  const buildStatus = useWorkbenchStore((s) => s.buildStatus);
  const buildMessage = useWorkbenchStore((s) => s.buildMessage);
  const runCompile = useWorkbenchStore((s) => s.runCompile);
  const mainFile = useWorkbenchStore((s) => s.mainFile);
  const documentRevision = useWorkbenchStore((s) => s.documentRevision);
  const pdfSourceRevision = useWorkbenchStore((s) => s.pdfSourceRevision);
  const pdfMainFile = useWorkbenchStore((s) => s.pdfMainFile);

  const hasPdf = Boolean(pdfDataUrl);
  const isBusy = buildStatus === "queued" || buildStatus === "running";
  const isFailed = buildStatus === "failed";
  const isStale =
    hasPdf &&
    typeof documentRevision === "number" &&
    typeof pdfSourceRevision === "number" &&
    documentRevision !== pdfSourceRevision;

  const displayName = toPdfFileName(pdfMainFile ?? mainFile);
  const busyLabel = buildStatus === "queued" ? "Queued…" : "Compiling…";
  const buildButtonLabel = isBusy
    ? busyLabel
    : hasPdf
      ? "Rebuild"
      : isFailed
        ? "Retry Build"
        : "Start Build";

  const bannerTitle = isBusy
    ? statusLabel(buildStatus)
    : isFailed
      ? "Build failed"
      : isStale
        ? "Stale preview"
        : statusLabel(buildStatus);
  const bannerSubtitle = isBusy || isFailed
    ? "Showing last successful preview"
    : isStale
      ? "Source changed since last build"
      : null;

  return (
    <div
      className="h-full flex flex-col bg-zinc-100/50 border-l border-zinc-100 overflow-hidden shadow-[inset_-1px_1px_3px_rgba(0,0,0,0.02)]"
      data-testid="pdf-preview-pane"
      data-status={buildStatus}
    >
      {/* Tabs Bar */}
      <div className="h-10 border-b flex items-center bg-zinc-50/30 shrink-0 px-1">
        <div className="h-10 px-4 flex items-center gap-2 bg-white text-zinc-900 font-bold border-r border-zinc-100 shadow-[0_1px_2px_rgba(0,0,0,0.05)] relative z-10 min-w-[120px]">
          <FileText className="w-3.5 h-3.5 text-red-500" />
          <span className="text-[12px] truncate tracking-tight">{displayName}</span>
          {isStale ? (
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 bg-amber-100 border border-amber-200 rounded px-1.5 py-0.5">
              Stale
            </span>
          ) : null}
          <div className="absolute top-0 inset-x-0 h-[2px] bg-red-500 rounded-full shadow-[0_1px_5px_rgba(239,68,68,0.3)]" />
        </div>
      </div>

      {/* Toolbar */}
      <div className="h-10 border-b flex items-center justify-between px-3 bg-white/80 backdrop-blur-sm shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-bold text-zinc-600 truncate">
            {bannerTitle}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {hasPdf && pdfDataUrl ? (
              <a
                href={pdfDataUrl}
                download={displayName}
                className="px-3 py-1 bg-white border border-zinc-200 rounded-xl text-[11px] font-black uppercase tracking-[0.1em] text-zinc-600 hover:text-zinc-900 hover:border-zinc-300 hover:shadow-md transition-all active:scale-95"
              >
                Download
              </a>
          ) : null}
          <button
            onClick={() => void runCompile()}
            disabled={isBusy}
            className="px-4 py-1 bg-white border border-zinc-200 rounded-xl text-[11px] font-black uppercase tracking-[0.1em] text-zinc-600 hover:text-zinc-900 hover:border-zinc-300 hover:shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {buildButtonLabel}
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden bg-zinc-100/50 relative">
        {hasPdf && pdfDataUrl ? (
          <>
            <div className="shrink-0 px-4 pt-3">
              <div className="w-full px-4 py-2 bg-white/90 border border-zinc-200 rounded-xl shadow-sm flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-black uppercase tracking-[0.1em] text-zinc-900">
                    {bannerTitle}
                  </span>
                  {bannerSubtitle ? (
                    <span className="text-[11px] font-bold text-zinc-500">
                      · {bannerSubtitle}
                    </span>
                  ) : null}
                </div>
                {buildMessage ? (
                  <p className="text-[11px] font-medium text-zinc-500 leading-relaxed">
                    {buildMessage}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex-1 overflow-auto p-8 flex flex-col items-center min-h-0 bg-[#f4f4f7] relative">
              <div className="relative group/pdf w-full">
                <div className="bg-white shadow-[0_20px_50px_rgba(0,0,0,0.1),0_0_1px_rgba(0,0,0,0.1)] border border-white rounded-sm w-full min-h-[30rem] aspect-[1/1.414] overflow-hidden">
                  <iframe
                    src={pdfDataUrl}
                    className="w-full h-full border-none"
                    title="Compiled PDF"
                  />
                </div>
              </div>
            </div>
          </>
        ) : isBusy ? (
          <div className="flex-1 overflow-auto p-8 flex flex-col items-center min-h-0 bg-[#f4f4f7] relative">
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 max-w-sm space-y-6">
              <div className="relative">
                <div className="w-20 h-20 rounded-[32px] bg-primary/5 flex items-center justify-center text-primary border border-primary/10 shadow-sm animate-pulse">
                  <FileText size={40} />
                </div>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-widest">
                  {buildStatus === "queued" ? "Queued" : "Compiling..."}
                </h3>
                <p className="text-[12px] text-zinc-500 font-medium leading-relaxed">
                  Generating your PDF preview. This usually takes a few seconds.
                </p>
                {buildMessage ? (
                  <p className="text-[11px] text-zinc-400 font-medium">{buildMessage}</p>
                ) : null}
              </div>
            </div>
          </div>
        ) : isFailed ? (
          <div className="flex-1 overflow-auto p-8 flex flex-col items-center min-h-0 bg-[#f4f4f7] relative">
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 max-w-sm space-y-6">
              <div className="w-20 h-20 rounded-[32px] bg-red-50 flex items-center justify-center text-red-400 border border-red-100 shadow-sm relative group">
                <XCircle size={40} className="transition-transform group-hover:scale-110" />
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-widest">
                  Build Failed
                </h3>
                <p className="text-[12px] text-zinc-500 font-medium leading-relaxed">
                  {buildMessage ?? "There was an error compiling your document. Please check the logs for details."}
                </p>
              </div>
              <button
                onClick={() => void runCompile()}
                disabled={isBusy}
                className="px-6 py-2 bg-white border border-zinc-200 rounded-xl text-[11px] font-black uppercase tracking-[0.1em] text-zinc-600 hover:text-zinc-900 hover:border-zinc-300 hover:shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Retry Build
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto p-8 flex flex-col items-center min-h-0 bg-[#f4f4f7] relative">
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12 max-w-sm space-y-6">
              <div
                className="w-20 h-20 rounded-[32px] bg-zinc-50 flex items-center justify-center text-zinc-300 border border-zinc-100 shadow-sm relative group cursor-pointer"
                onClick={() => void runCompile()}
              >
                <FileText size={40} className="transition-transform group-hover:scale-110" />
                <div className="absolute -top-2 -right-2 bg-primary text-white p-1.5 rounded-full shadow-lg shadow-primary/30 animate-pulse">
                  <Play size={14} fill="currentColor" />
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-bold text-zinc-900 uppercase tracking-widest">
                  Document not built
                </h3>
                <p className="text-[12px] text-zinc-500 font-medium leading-relaxed">
                  Build your project to generate the PDF preview and start polishing your research.
                </p>
                {buildMessage ? (
                  <p className="text-[11px] text-zinc-400 font-medium">{buildMessage}</p>
                ) : null}
              </div>
              <button
                onClick={() => void runCompile()}
                disabled={isBusy}
                className="px-6 py-2 bg-white border border-zinc-200 rounded-xl text-[11px] font-black uppercase tracking-[0.1em] text-zinc-600 hover:text-zinc-900 hover:border-zinc-300 hover:shadow-md transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Start Build
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
