"use client";
import React, { useEffect, useRef } from "react";
import {
  parseTableCellContent,
  type TableCellNode,
} from "@/lib/tableCellContent";
import { renderMathPreview } from "./MathPreview";
/** Build only text nodes, known formatting elements and untrusted-mode KaTeX. */
export function renderTableCellContent(
  element: HTMLElement,
  source: string,
): boolean {
  element.textContent = "";
  const nodes = parseTableCellContent(source);
  if (!nodes) {
    element.textContent = source;
    element.classList.add("cm-visual-object-source");
    return false;
  }
  element.classList.remove("cm-visual-object-source");
  function append(parent: HTMLElement, nodes: TableCellNode[]) {
    for (const node of nodes) {
      if (node.kind === "text")
        parent.appendChild(document.createTextNode(node.text));
      else if (node.kind === "break")
        parent.appendChild(document.createElement("br"));
      else if (node.kind === "math") {
        const math = document.createElement("span");
        if (!renderMathPreview(math, node.tex)) {
          math.textContent = `\\(${node.tex}\\)`;
          math.className = "cm-visual-object-source";
        }
        parent.appendChild(math);
      } else {
        const wrapper = document.createElement(
          node.kind === "bold" ? "strong" : node.kind === "italic" ? "em" : "u",
        );
        append(wrapper, node.children);
        parent.appendChild(wrapper);
      }
    }
  }
  append(element, nodes);
  return true;
}
export function TableCellPreview({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) renderTableCellContent(ref.current, source);
  }, [source]);
  return (
    <div
      ref={ref}
      aria-label="Cell preview"
      className="min-h-10 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-muted/30 p-3 text-sm"
    />
  );
}
