"use client";

import type { Diagnostic as ProtoDiagnostic } from "@alove/protocol";
import { Kbd } from "@/components/ui/primitives";
import type { BuildUiState } from "@/types/editor-workbench";

type EditorRightRailProps = {
  zen: boolean;
  build: BuildUiState;
  pdfZoom: number;
  onPdfZoom: (n: number) => void;
  diagnostics: ProtoDiagnostic[];
  logTail: string;
};

export function EditorRightRail({
  zen,
  build,
  pdfZoom,
  onPdfZoom,
  diagnostics,
  logTail,
}: EditorRightRailProps) {
  if (zen) return null;

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-zinc-200/90 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-950/50">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200/90 px-3 py-2 dark:border-zinc-800">
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">
          PDF preview
        </span>
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <label className="flex items-center gap-1.5">
            <span className="text-zinc-400">Zoom</span>
            <input
              type="range"
              min={60}
              max={160}
              value={pdfZoom}
              onChange={(e) => onPdfZoom(Number(e.target.value))}
              className="w-24"
            />
            <span className="w-9 tabular-nums text-zinc-600 dark:text-zinc-300">{pdfZoom}%</span>
          </label>
          {build.kind === "ready" && build.pdfDataUrl ? (
            <a
              className="font-medium text-alove-fg-muted underline-offset-2 hover:underline dark:text-alove-fg-muted"
              href={build.pdfDataUrl}
              download="main.pdf"
            >
              Download
            </a>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-zinc-100/90 dark:bg-zinc-900/40">
        {build.kind === "ready" && build.pdfDataUrl ? (
          <div
            className="h-full w-full origin-top-left"
            style={{
              transform: `scale(${pdfZoom / 100})`,
              width: `${10000 / pdfZoom}%`,
              height: `${10000 / pdfZoom}%`,
            }}
          >
            <iframe
              title="PDF preview"
              className="h-full w-full border-0"
              src={build.pdfDataUrl}
            />
          </div>
        ) : (
          <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-300">
              No PDF yet
            </p>
            <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
              Run <Kbd>Compile</Kbd> from the header or open the command palette with{" "}
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>. Enable auto-compile to refresh after edits.
            </p>
          </div>
        )}
      </div>

      <div className="max-h-36 overflow-auto border-t border-zinc-200/90 bg-amber-50/95 dark:border-zinc-800 dark:bg-amber-950/35">
        <div className="border-b border-amber-200/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-amber-900 dark:border-amber-900/50 dark:text-amber-100">
          Problems ({diagnostics.length})
        </div>
        <ul className="max-h-28 overflow-auto px-3 pb-2 text-[11px] leading-snug text-amber-950 dark:text-amber-50">
          {diagnostics.length === 0 ? (
            <li className="text-zinc-500 dark:text-zinc-400">No structured diagnostics.</li>
          ) : (
            diagnostics.map((d, i) => (
              <li key={i} className="mb-1.5 font-mono">
                <span className="font-semibold uppercase">{d.severity}</span>
                {d.file ? (
                  <span className="text-zinc-600 dark:text-zinc-300">
                    {" "}
                    {d.file}:{d.line ?? "?"} —{" "}
                  </span>
                ) : null}
                {d.message}
              </li>
            ))
          )}
        </ul>
      </div>

      <div className="max-h-44 min-h-[6rem] overflow-auto border-t border-zinc-200/90 bg-white p-3 font-mono text-[11px] leading-relaxed text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
          Engine log (tail)
        </div>
        {logTail ? (
          <pre className="whitespace-pre-wrap break-words">{logTail}</pre>
        ) : (
          <span className="text-zinc-400">Waiting for next compile…</span>
        )}
      </div>
    </aside>
  );
}
