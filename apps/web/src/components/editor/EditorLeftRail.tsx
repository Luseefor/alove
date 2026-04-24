"use client";

import type { OutlineHeading, InputRef } from "@alove/editor";
import { RailSectionTitle } from "@/components/ui/primitives";
import { TEMPLATES, type TemplateId } from "@/lib/templates";
import type { HistoryEntry } from "@/lib/compileHistory";

type EditorLeftRailProps = {
  zen: boolean;
  designMode: boolean;
  files: Record<string, string>;
  activeFile: string;
  onOpenFile: (path: string) => void;
  onApplyTemplate: (id: TemplateId) => void;
  onNewTexFile: () => void;
  outline: OutlineHeading[];
  onOutlineJump: (from: number) => void;
  inputRefs: InputRef[];
  history: HistoryEntry[];
};

export function EditorLeftRail({
  zen,
  designMode,
  files,
  activeFile,
  onOpenFile,
  onApplyTemplate,
  onNewTexFile,
  outline,
  onOutlineJump,
  inputRefs,
  history,
}: EditorLeftRailProps) {
  if (zen) return null;

  return (
    <aside className="flex h-full flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
      <RailSectionTitle>Templates</RailSectionTitle>
      <div className="flex flex-col px-2 py-1.5">
        {(Object.keys(TEMPLATES) as TemplateId[]).map((id) => (
          <button
            key={id}
            type="button"
            className="border-b border-transparent py-1.5 text-left text-xs text-zinc-700 hover:border-zinc-300 hover:text-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-50"
            onClick={() => void onApplyTemplate(id)}
          >
            {TEMPLATES[id].label}
          </button>
        ))}
        {designMode ? (
          <button
            type="button"
            className="mt-0.5 py-1.5 text-left text-xs text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-800 dark:text-zinc-500 dark:decoration-zinc-600 dark:hover:text-zinc-300"
            onClick={() => void onNewTexFile()}
          >
            New .tex file
          </button>
        ) : (
          <p className="py-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-500">
            Turn on <span className="font-medium text-zinc-700 dark:text-zinc-300">Design</span>{" "}
            in the header for multi-file.
          </p>
        )}
      </div>

      <RailSectionTitle>Files</RailSectionTitle>
      <div className="max-h-44 overflow-auto px-1 py-1">
        {Object.keys(files).map((path) => (
          <button
            key={path}
            type="button"
            className={`flex w-full items-center px-2 py-1 text-left font-mono text-xs ${
              path === activeFile
                ? "border-l-2 border-l-zinc-900 bg-zinc-200/60 font-medium text-zinc-950 dark:border-l-zinc-100 dark:bg-zinc-800/80 dark:text-zinc-50"
                : "border-l-2 border-l-transparent text-zinc-700 hover:bg-zinc-200/50 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
            }`}
            onClick={() => onOpenFile(path)}
          >
            {path}
          </button>
        ))}
      </div>

      <RailSectionTitle>Outline</RailSectionTitle>
      <div className="min-h-0 flex-1 overflow-auto px-1 py-1">
        {outline.length === 0 ? (
          <p className="px-2 py-2 text-xs text-zinc-500">No sections yet — add{" "}
            <code className="font-mono">\section</code>.
          </p>
        ) : (
          outline.map((h, i) => (
            <button
              type="button"
              key={`${h.title}-${i}`}
              className="block w-full truncate px-2 py-1 text-left text-sm text-zinc-700 hover:bg-zinc-200/60 dark:text-zinc-200 dark:hover:bg-zinc-800/70"
              style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
              onClick={() => onOutlineJump(h.from)}
            >
              {h.title}
            </button>
          ))
        )}
      </div>

      <RailSectionTitle>\input / \include</RailSectionTitle>
      <div className="max-h-32 overflow-auto px-1 py-1">
        {inputRefs.length === 0 ? (
          <p className="px-2 text-xs text-zinc-500">No references found in this file.</p>
        ) : (
          inputRefs.map((r, i) => (
            <button
              key={`${r.path}-${i}`}
              type="button"
              disabled={!files[r.path] && !files[`${r.path}.tex`]}
              className="mb-0.5 block w-full truncate px-2 py-1 text-left font-mono text-xs text-zinc-700 hover:bg-zinc-200/60 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-800/70"
              onClick={() => {
                const p = files[r.path] ? r.path : `${r.path}.tex`;
                if (files[p]) onOpenFile(p);
              }}
            >
              {r.path}
            </button>
          ))
        )}
      </div>

      <RailSectionTitle>Compile history</RailSectionTitle>
      <div className="max-h-28 overflow-auto px-2 py-2 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
        {history.length === 0 ? (
          <span>Successful and failed builds appear here (stored locally).</span>
        ) : (
          history.map((h) => (
            <div key={h.id} className="mb-1.5 truncate border-b border-zinc-100 pb-1 last:border-0 dark:border-zinc-800/80">
              <span className="font-mono text-zinc-500">
                {new Date(h.ts).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span className={h.ok ? " text-alove-fg-muted dark:text-alove-fg-muted" : " text-red-600 dark:text-red-400"}>
                {" "}
                · {h.ok ? "OK" : "Fail"}
              </span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
