import type { Diagnostic as ProtoDiagnostic } from "@alove/protocol";
import { Text } from "@codemirror/state";

export function toCmDiagnostics(doc: Text, rows: ProtoDiagnostic[]) {
  return rows.map((d) => {
    if (d.line != null && d.line >= 1 && d.line <= doc.lines) {
      const line = doc.line(d.line);
      return {
        from: line.from,
        to: Math.min(line.to, line.from + 200),
        message: d.message,
        severity: d.severity as "error" | "warning" | "info",
      };
    }
    return {
      from: 0,
      to: Math.min(120, doc.length),
      message: d.message,
      severity: d.severity as "error" | "warning" | "info",
    };
  });
}
