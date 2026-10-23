"use client";
import React from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { VisualObject } from "@/lib/visualObjects";
import type { VisualFormat } from "@alove/editor";

export function VisualWritingToolbar({
  onFormat,
  onInsertObject,
  onRequestSource,
  readOnly,
  style,
}: {
  onInsertObject?: (kind: VisualObject["kind"]) => void;
  onFormat: (kind: VisualFormat) => void;
  onRequestSource?: () => void;
  readOnly: boolean;
  style: VisualFormat;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Visual writing"
      className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-background px-3 py-2 text-sm"
    >
      <select
        aria-label="Paragraph style"
        value={style}
        disabled={readOnly}
        onChange={(event) => onFormat(event.target.value as VisualFormat)}
        className="h-8 rounded border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="paragraph">Paragraph</option>
        <option value="section">Heading 1</option>
        <option value="subsection">Heading 2</option>
        <option value="subsubsection">Heading 3</option>
      </select>
      {(["bold", "italic"] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          disabled={readOnly}
          aria-label={
            kind === "bold" ? "Bold selected text" : "Italicize selected text"
          }
          title={
            kind === "bold"
              ? "Bold selected text (Ctrl/Cmd+B)"
              : "Italicize selected text (Ctrl/Cmd+I)"
          }
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onFormat(kind)}
          className="h-8 min-w-8 rounded px-2 hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden="true"
            className={kind === "bold" ? "font-bold" : "italic"}
          >
            {kind === "bold" ? "B" : "I"}
          </span>
        </button>
      ))}
      {(["bulletList", "numberedList"] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          disabled={readOnly}
          aria-label={
            kind === "bulletList"
              ? "Create bulleted list"
              : "Create numbered list"
          }
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onFormat(kind)}
          className="h-8 min-w-8 shrink-0 rounded px-2 text-xs hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {kind === "bulletList" ? "•" : "1."}
        </button>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={readOnly}>
          <button
            type="button"
            className="h-8 shrink-0 rounded border border-border px-2 text-xs hover:bg-muted disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Insert visual object"
          >
            Insert ▾
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {(
            [
              ["table", "Table"],
              ["figure", "Figure"],
              ["subfigure", "Subfigures"],
              ["math", "Equation"],
              ["citation", "Citation"],
              ["reference", "Reference"],
            ] as const
          ).map(([kind, label]) => (
            <DropdownMenuItem
              key={kind}
              onSelect={() => onInsertObject?.(kind)}
            >
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="min-w-2 flex-1" />
      <button
        type="button"
        onClick={onRequestSource}
        className="h-8 shrink-0 rounded px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Edit source
      </button>
    </div>
  );
}
