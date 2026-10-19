import type { Diagnostic as ProtoDiagnostic } from "@alove/protocol";
import { Text } from "@codemirror/state";

export function normalizeDiagnosticFile(p: string | null | undefined): string | null {
  if (p == null) return null;
  let s = String(p).trim().replace(/\\/g, "/");
  if (!s) return null;
  if (s.startsWith("/work/")) s = s.slice("/work/".length);
  if (s.startsWith("/")) return null;
  if (/^[A-Za-z]:\//.test(s)) return null;
  while (s.startsWith("./")) s = s.slice(2);
  const stack: string[] = [];
  for (const part of s.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!stack.length) return null;
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  if (!stack.length) return null;
  return stack.join("/");
}

export function toCmDiagnostics(
  doc: Text,
  rows: ProtoDiagnostic[],
  activeFile?: string,
  mainFile?: string | null,
) {
  const active = activeFile ? normalizeDiagnosticFile(activeFile) : null;
  const filter = Boolean(activeFile);
  const fallback = normalizeDiagnosticFile(mainFile ?? "main.tex") ?? "main.tex";
  const out: {
    from: number;
    to: number;
    message: string;
    severity: "error" | "warning" | "info";
  }[] = [];
  for (const d of rows) {
    if (filter) {
      const eff = d.file ? normalizeDiagnosticFile(d.file) : fallback;
      if (!eff || eff !== active) continue;
    }
    if (
      typeof d.line !== "number" ||
      !Number.isInteger(d.line) ||
      d.line < 1 ||
      d.line > doc.lines
    ) {
      continue;
    }
    const line = doc.line(d.line);
    let from = line.from;
    if (
      typeof d.column === "number" &&
      Number.isInteger(d.column) &&
      d.column >= 1
    ) {
      from = Math.min(line.to, Math.max(line.from, line.from + d.column - 1));
    }
    out.push({
      from,
      to: Math.min(line.to, from + 200),
      message: d.message,
      severity: d.severity as "error" | "warning" | "info",
    });
  }
  return out;
}
