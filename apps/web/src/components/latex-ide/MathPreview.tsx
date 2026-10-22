"use client";
import React from "react";
import katex from "katex";
import { useEffect, useRef, useState } from "react";
export function renderMathPreview(
  element: HTMLElement,
  tex: string,
  display = false,
): boolean {
  element.textContent = "";
  if (!tex.trim() || tex.length > 8192) {
    element.textContent = "Enter an equation (up to 8 Ki characters).";
    return false;
  }
  try {
    katex.render(tex.replace(/\\label\{[A-Za-z0-9:._/+@-]+\}/g, ""), element, {
      displayMode: display,
      throwOnError: true,
      trust: false,
      strict: "error",
      maxSize: 10,
      maxExpand: 1000,
      output: "htmlAndMathml",
      macros: {},
    });
    return true;
  } catch {
    element.textContent =
      "Preview unavailable for this expression. Its LaTeX remains available in Source.";
    return false;
  }
}
export function MathPreview({
  tex,
  display = false,
}: {
  tex: string;
  display?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ref.current) setReady(renderMathPreview(ref.current, tex, display));
  }, [tex, display]);
  return (
    <div
      ref={ref}
      data-testid="math-preview"
      data-ready={ready}
      aria-label="Equation preview"
      className="max-w-full overflow-auto rounded border border-border bg-background p-3 text-sm"
    />
  );
}
