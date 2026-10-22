import { decodeVisualProse, readTexGroup } from "./visualObjectTypes";
export type TableCellNode =
  | { kind: "text"; text: string }
  | { kind: "bold" | "italic" | "underline"; children: TableCellNode[] }
  | { kind: "math"; tex: string }
  | { kind: "break" };
/** Bounded inline grammar; unknown TeX stays source-only. No HTML is interpreted. */
export function parseTableCellContent(source: string): TableCellNode[] | null {
  if (source.length > 10000 || source.includes("\u0000")) return null;
  let count = 0;
  function parse(text: string, depth: number): TableCellNode[] | null {
    if (depth > 16) return null;
    const result: TableCellNode[] = [];
    const push = (node: TableCellNode) => {
      if (++count > 500) return false;
      result.push(node);
      return true;
    };
    let plain = "";
    const flush = () => {
      if (!plain) return true;
      const decoded = decodeVisualProse(plain);
      plain = "";
      return decoded !== null && push({ kind: "text", text: decoded });
    };
    for (let i = 0; i < text.length; ) {
      if (text[i] === "$" || text.startsWith("\\(", i)) {
        if (!flush() || text.startsWith("$$", i)) return null;
        const open = text[i] === "$" ? "$" : "\\(",
          close = open === "$" ? "$" : "\\)";
        let end = i + open.length,
          braces = 0;
        for (; end < text.length; end++) {
          if (text.startsWith(close, end) && braces === 0) break;
          const c = text[end];
          if (
            c === "%" ||
            c === "&" ||
            text.startsWith("\\begin", end) ||
            text.startsWith("\\end", end) ||
            text.startsWith("\\[", end) ||
            text.startsWith("\\]", end) ||
            text.startsWith("\\\\", end)
          )
            return null;
          if (c === "\\") {
            end++;
            continue;
          }
          if (c === "$") return null;
          if (c === "{" && ++braces > 32) return null;
          if (c === "}" && --braces < 0) return null;
        }
        const tex = text.slice(i + open.length, end);
        if (
          end >= text.length ||
          braces ||
          !tex.trim() ||
          !push({ kind: "math", tex })
        )
          return null;
        i = end + close.length;
        continue;
      }
      if (text[i] === "\\") {
        const literal =
          /^\\(?:textbackslash\{\}|textasciitilde\{\}|textasciicircum\{\}|[%&#_${}])/.exec(
            text.slice(i),
          );
        if (literal) {
          plain += literal[0];
          i += literal[0].length;
          continue;
        }
        const cmd = /^\\(textbf|textit|emph|underline)\{/.exec(text.slice(i));
        if (cmd) {
          if (!flush()) return null;
          const g = readTexGroup(text, i + cmd[0].length - 1);
          if (!g) return null;
          const children = parse(g.value, depth + 1);
          if (!children) return null;
          if (
            !push({
              kind:
                cmd[1] === "textbf"
                  ? "bold"
                  : cmd[1] === "underline"
                    ? "underline"
                    : "italic",
              children,
            })
          )
            return null;
          i = g.to;
          continue;
        }
        const newline = /^\\newline\b(?:\{\})?/.exec(text.slice(i));
        if (newline) {
          if (!flush() || !push({ kind: "break" })) return null;
          i += newline[0].length;
          continue;
        }
        return null;
      }
      if (/[{}%&#_^~]/.test(text[i]!)) return null;
      plain += text[i++]!;
    }
    return flush() ? result : null;
  }
  return parse(source, 0);
}
export function tableCellPlainText(nodes: TableCellNode[]): string {
  return nodes
    .map((n) =>
      n.kind === "text"
        ? n.text
        : n.kind === "math"
          ? n.tex
          : n.kind === "break"
            ? "\n"
            : tableCellPlainText(n.children),
    )
    .join("");
}
export function formatTableCellSelection(
  source: string,
  from: number,
  to: number,
  kind: "bold" | "italic" | "underline" | "math",
): { source: string; from: number; to: number } {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < from ||
    to > source.length ||
    !parseTableCellContent(source)
  )
    throw new Error("Select supported cell text first.");
  const selected = source.slice(from, to) || (kind === "math" ? "x" : "text");
  if (
    !parseTableCellContent(source.slice(0, from)) ||
    !parseTableCellContent(source.slice(to))
  )
    throw new Error(
      "Select complete text or formatting; do not cross a LaTeX wrapper.",
    );
  const open =
      kind === "math"
        ? "\\("
        : `\\${kind === "bold" ? "textbf" : kind === "italic" ? "textit" : "underline"}{`,
    close = kind === "math" ? "\\)" : "}";
  const result =
    source.slice(0, from) + open + selected + close + source.slice(to);
  if (!parseTableCellContent(result))
    throw new Error(
      "This selection cannot be formatted safely. Edit its LaTeX directly.",
    );
  return {
    source: result,
    from: from + open.length,
    to: from + open.length + selected.length,
  };
}
