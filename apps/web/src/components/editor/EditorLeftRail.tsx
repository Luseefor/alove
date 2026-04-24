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
    <aside className="flex h-full flex-col border-r border-zinc-200/90 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-950/50">
      <RailSectionTitle>Templates</RailSectionTitle>
      <div className="flex flex-col gap-1.5 px-2 py-2">
        {(Object.keys(TEMPLATES) as TemplateId[]).map((id) => (
          <button
            key={id}
            type="button"
            className="rounded-lg border border-zinc-200/90 bg-white px-3 py-2 text-left text-xs font-medium text-zinc-800 shadow-sm transition hover:border-alove-surface-soft-border hover:bg-alove-surface-soft/80 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-alove-surface-soft-border dark:hover:bg-alove-surface-soft/50"
            onClick={() => void onApplyTemplate(id)}
          >
            {TEMPLATES[id].label}
          </button>
        ))}
        {designMode ? (
          <button
            type="button"
            className="rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-left text-xs font-medium text-zinc-600 transition hover:border-alove-accent hover:bg-alove-surface-soft/50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:border-alove-accent"
            onClick={() => void onNewTexFile()}
          >
            + New .tex file
          </button>
        ) : (
          <p className="rounded-lg bg-zinc-100/80 px-2 py-2 text-[11px] leading-snug text-zinc-500 dark:bg-zinc-900/60">
            Enable <strong className="text-zinc-700 dark:text-zinc-300">Design</strong> in the
            header to add files beyond <code className="font-mono text-zinc-600">main.tex</code>.
          </p>
        )}
      </div>

      <RailSectionTitle>Files</RailSectionTitle>
      <div className="max-h-44 overflow-auto px-2 py-2">
        {Object.keys(files).map((path) => (
          <button
            key={path}
            type="button"
            className={`mb-1 flex w-full items-center rounded-lg px-2 py-1.5 text-left font-mono text-xs transition ${
              path === activeFile
                ? "bg-alove-surface-soft font-medium text-alove-fg-strong dark:bg-alove-surface-soft/90 dark:text-alove-fg-strong"
                : "text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-200 dark:hover:bg-zinc-800/80"
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
              className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-200/60 dark:text-zinc-200 dark:hover:bg-zinc-800/70"
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
              className="mb-1 block w-full truncate rounded-lg px-2 py-1 text-left font-mono text-xs text-zinc-700 hover:bg-zinc-200/60 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-200 dark:hover:bg-zinc-800/70"
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
