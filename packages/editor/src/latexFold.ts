import { foldService } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Fold a single `\\begin{env} … \\end{env}` region (first matching `\\end` after the opener).
 */
export const latexBeginEndFold = foldService.of((state: EditorState, lineStart: number) => {
  const line = state.doc.lineAt(lineStart);
  const m = line.text.match(/\\begin\{([^}]+)\}/u);
  if (!m) return null;
  const env = m[1]!;
  const from = line.from + m.index!;
  const startNo = line.number;
  const endRe = new RegExp(`\\\\end\\{${escapeRe(env)}\\}`, "u");
  for (let ln = startNo + 1; ln <= state.doc.lines; ln += 1) {
    const t = state.doc.line(ln).text;
    if (endRe.test(t)) {
      return { from, to: state.doc.line(ln).to };
    }
  }
  return null;
});
