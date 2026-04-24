import type { Diagnostic } from "@alove/protocol";

const fileLineRe =
  /^([\w./\\-]+\.(?:tex|sty|cls|bib))\s*:\s*(\d+)(?::(\d+))?\s*(.*)$/u;

const latexLineRe = /^l\.(\d+)\s(.*)$/u;

export function parseLatexLog(log: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = log.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const trimmed = line.trim();

    const fl = trimmed.match(fileLineRe);
    if (
      fl &&
      (trimmed.toLowerCase().includes("error") ||
        trimmed.toLowerCase().includes("warning"))
    ) {
      const low = trimmed.toLowerCase();
      const severity: Diagnostic["severity"] = low.includes("error")
        ? "error"
        : "warning";
      diagnostics.push({
        severity,
        message: trimmed,
        file: fl[1]!,
        line: Number(fl[2]),
        column: fl[3] ? Number(fl[3]) : undefined,
      });
      continue;
    }

    const ll = trimmed.match(latexLineRe);
    if (ll) {
      diagnostics.push({
        severity: "error",
        message: ll[2]!.trim(),
        line: Number(ll[1]),
      });
      continue;
    }

    if (trimmed.includes("! LaTeX Error")) {
      diagnostics.push({ severity: "error", message: trimmed });
    } else if (/^! /u.test(trimmed)) {
      diagnostics.push({ severity: "error", message: trimmed });
    } else if (trimmed.includes("LaTeX Warning")) {
      diagnostics.push({ severity: "warning", message: trimmed });
    } else if (trimmed.includes("Package") && trimmed.includes("Warning")) {
      diagnostics.push({ severity: "warning", message: trimmed });
    }
  }
  return diagnostics;
}
