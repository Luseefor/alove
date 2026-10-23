"use client";
import React, { useMemo } from "react";
import { buildProjectOutline } from "@/lib/projectOutline";
import { useWorkbenchStore } from "@/stores/workbenchStore";

export function ManuscriptOutline() {
  const files = useWorkbenchStore((s) => s.filesByPath);
  const mainFile = useWorkbenchStore((s) => s.mainFile);
  const activeFile = useWorkbenchStore((s) => s.activeFileId);
  const outline = useMemo(
    () => buildProjectOutline(files, mainFile ?? "main.tex"),
    [files, mainFile],
  );
  return (
    <nav
      aria-label="Manuscript outline"
      className="flex-1 overflow-y-auto px-2 py-2"
    >
      <p className="px-2 pb-2 text-xs text-muted-foreground">
        Manuscript · {mainFile ?? "Choose a main file"}
      </p>
      {outline.headings.length ? (
        outline.headings.map((heading) => (
          <button
            key={heading.id}
            type="button"
            aria-label={`Go to ${heading.title} in ${heading.path}, line ${heading.line}`}
            title={`${heading.path}:${heading.line}`}
            className="block min-h-9 w-full rounded px-2 py-1 text-left text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ paddingLeft: `${8 + Math.min(heading.level, 6) * 10}px` }}
            onClick={() => {
              const state = useWorkbenchStore.getState();
              // Rendered offsets are valid only for this exact snapshot.
              if (state.filesByPath[heading.path] !== files[heading.path])
                return;
              state.openFile(heading.path);
              useWorkbenchStore.setState({
                nextSelection: { start: heading.from, end: heading.from },
                focusedLine: null,
              });
            }}
          >
            <span className="block truncate font-medium">{heading.title}</span>
            <span className="block truncate text-[10px] text-muted-foreground">
              {heading.path}:{heading.line}
              {activeFile === heading.path ? " · open" : ""}
            </span>
          </button>
        ))
      ) : (
        <p className="px-2 py-6 text-xs text-muted-foreground">
          No manuscript headings found.
        </p>
      )}
      {(outline.warnings.length > 0 || outline.limited) && (
        <details className="mt-2 border-t border-border px-2 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Outline notices
            {outline.warnings.length ? ` (${outline.warnings.length})` : ""}
          </summary>
          {outline.limited && (
            <p className="mt-2">This outline reached its scan limit.</p>
          )}
          {outline.warnings.map((warning, index) => (
            <p
              className="mt-2 break-words"
              key={`${warning.path}:${warning.line}:${index}`}
            >
              {warning.path}:{warning.line} · {warning.message}
            </p>
          ))}
        </details>
      )}
    </nav>
  );
}
