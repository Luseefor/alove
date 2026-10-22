/**
 * Bounded, conservative source-preserving projection for Manuscript visual mode.
 *
 * Canonical LaTeX must never HTML-roundtrip: this module is a pure projection.
 * It never transforms `source`; it only returns UTF-16exact offsets.
 *
 * Known wrappers (only):
 * - `\section|subsection|subsubsection[*]{...}` (no `[...]`; standalone, top level only)
 * - `\textbf{...}` -> bold, `\textit{...}|\emph{...}` -> italic, nestable
 * - `\textbackslash{}|\textasciitilde{}|\textasciicircum{}` + `\%\&\#\_\$\{\}` literals
 *
 * All else stays VISIBLE as source and becomes `protected` (comments, verb,
 * verbatim/listing, math, unknown commands/envs/groups, cite, stray markers).
 * Every `hidden` range is also `protected`. `literals` are `protected` but NOT hidden.
 * Transparent envs: only `itemize|enumerate` (protect begin/end/item tokens, parse inside).
 * All other envs opaque. Headings only at body top level (`allowHeadings`).
 */

export type VisualRange = { from: number; to: number };
export type VisualMark = { from: number; to: number; kind: "bold" | "italic" };
export type VisualHeading = { from: number; level: 1 | 2 | 3 };
export type VisualLiteral = { from: number; to: number; text: string };

export type VisualDocument = {
  hidden: VisualRange[];
  marks: VisualMark[];
  headings: VisualHeading[];
  protected: VisualRange[];
  body: VisualRange;
  limited: boolean;
  literals: VisualLiteral[];
  items: (VisualRange & { text: string })[];
};

const MAX_SOURCE_UTF16 = 1024 * 1024;
const MAX_LINES = 20000;
const MAX_KNOWN_DEPTH = 100;

const VERBATIM_ENVS = new Set([
  "verbatim",
  "verbatim*",
  "Verbatim",
  "lstlisting",
  "listings",
  "minted",
]);

const MATH_ENVS = new Set([
  "math",
  "displaymath",
  "equation",
  "equation*",
  "align",
  "align*",
  "gather",
  "gather*",
  "multline",
  "multline*",
  "eqnarray",
  "eqnarray*",
]);

const LIST_ENVS = new Set(["itemize", "enumerate"]);

function isLetterOrAt(ch: string | undefined): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || ch === "@";
}

function parseCommandAt(
  src: string,
  pos: number,
): { name: string; star: boolean; end: number } | null {
  if (src[pos] !== "\\") return null;
  if (pos + 1 >= src.length) return null;
  const nxt = src[pos + 1]!;
  if (!isLetterOrAt(nxt)) return null;
  let j = pos + 2;
  while (j < src.length && isLetterOrAt(src[j])) j++;
  const name = src.slice(pos + 1, j);
  let star = false;
  if (src[j] === "*") {
    star = true;
    j++;
  }
  return { name, star, end: j };
}

function countBackslashesBefore(src: string, pos: number): number {
  let n = 0;
  let i = pos - 1;
  while (i >= 0 && src[i] === "\\") {
    n++;
    i--;
  }
  return n;
}

function isEscaped(src: string, pos: number): boolean {
  return countBackslashesBefore(src, pos) % 2 === 1;
}

function findLineEnd(src: string, pos: number, end: number): number {
  for (let i = pos; i < end; i++) {
    const c = src[i];
    if (c === "\n" || c === "\r") return i;
  }
  return end;
}

function lineStartOf(src: string, pos: number): number {
  const nl = src.lastIndexOf("\n", pos - 1);
  const cr = src.lastIndexOf("\r", pos - 1);
  return Math.max(nl, cr) + 1;
}

function findEnvNameClose(
  src: string,
  openPos: number,
  scopeEnd: number,
): number {
  // openPos at '{'
  for (let i = openPos + 1; i < scopeEnd; i++) {
    const c = src[i];
    if (c === "\\") {
      i++; // skip escaped
      continue;
    }
    if (c === "{") return -1;
    if (c === "}") return i;
  }
  return -1;
}

function findMatchingBracket(
  src: string,
  openPos: number,
  scopeEnd: number,
): number {
  let depth = 1;
  let i = openPos + 1;
  while (i < scopeEnd) {
    const c = src[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "%") {
      if (!isEscaped(src, i)) {
        i = findLineEnd(src, i, scopeEnd);
        continue;
      }
      i++;
      continue;
    }
    if (c === "[") {
      depth++;
      i++;
      continue;
    }
    if (c === "]") {
      depth--;
      if (depth === 0) return i;
      i++;
      continue;
    }
    i++;
  }
  return -1;
}

function findVerbEndOnLine(
  src: string,
  delimPos: number,
  lineEnd: number,
): number {
  const delim = src[delimPos];
  if (delim === undefined) return -1;
  if (delim === "\n" || delim === "\r") return -1;
  // LaTeX forbids letter/space delim conservatively; treat as malformed.
  if (isLetterOrAt(delim)) return -1;
  for (let j = delimPos + 1; j < lineEnd; j++) {
    if (src[j] === delim) return j;
  }
  return -1;
}

function findDollarClose(
  src: string,
  start: number,
  scopeEnd: number,
  display: boolean,
): number {
  let i = start + (display ? 2 : 1);
  while (i < scopeEnd) {
    const c = src[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === "%") {
      if (!isEscaped(src, i)) {
        i = findLineEnd(src, i, scopeEnd);
        continue;
      }
      i++;
      continue;
    }
    if (c === "$") {
      if (isEscaped(src, i)) {
        i++;
        continue;
      }
      if (display) {
        if (i + 1 < scopeEnd && src[i + 1] === "$") return i;
        i++;
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}

function findBackslashParenClose(
  src: string,
  start: number,
  scopeEnd: number,
  open: "(" | "[",
): number {
  const close: string = open === "(" ? ")" : "]";
  let j = start + 2;
  while (j + 1 < scopeEnd) {
    const c = src[j];
    if (c === "%") {
      if (!isEscaped(src, j)) {
        j = findLineEnd(src, j, scopeEnd);
        continue;
      }
      j++;
      continue;
    }
    if (c === "\\" && src[j + 1] === close) {
      // ensure the backslash itself is not escaped (\\] is linebreak + ])
      // count backslashes before j: if odd, this \ is escaped -> not a closer.
      // Since we skip \\ pairs below, a lone \ here is real.
      return j;
    }
    if (c === "\\") {
      j += 2;
      continue;
    }
    j++;
  }
  return -1;
}

function findMatchingEnvEnd(
  src: string,
  beginClose: number,
  envName: string,
  scopeEnd: number,
  depthGuard = 0,
): { endStart: number; endClose: number } | null {
  if (depthGuard > 20) return null;
  if (VERBATIM_ENVS.has(envName)) {
    const marker = `\\end{${envName}}`;
    const found = src.indexOf(marker, beginClose + 1);
    return found >= 0 && found + marker.length <= scopeEnd
      ? { endStart: found, endClose: found + marker.length - 1 }
      : null;
  }
  let depth = 1;
  let i = beginClose + 1;
  while (i < scopeEnd) {
    const c = src[i];
    if (c === "%") {
      if (!isEscaped(src, i)) {
        i = findLineEnd(src, i, scopeEnd);
        continue;
      }
      i++;
      continue;
    }
    if (c === "\\") {
      if (i + 1 >= scopeEnd) {
        i++;
        continue;
      }
      const nxt = src[i + 1]!;
      if (isLetterOrAt(nxt)) {
        const cmd = parseCommandAt(src, i);
        if (!cmd || cmd.end > scopeEnd) {
          i += 2;
          continue;
        }
        if (cmd.name === "verb") {
          const le = findLineEnd(src, i, scopeEnd);
          if (cmd.end >= scopeEnd) {
            i = le;
            continue;
          }
          const vEnd = findVerbEndOnLine(src, cmd.end, le);
          i = vEnd === -1 ? le : vEnd + 1;
          continue;
        }
        if (cmd.name === "begin" || cmd.name === "end") {
          if (cmd.end >= scopeEnd || src[cmd.end] !== "{") {
            i = cmd.end;
            continue;
          }
          const close = findEnvNameClose(src, cmd.end, scopeEnd);
          if (close === -1) return null;
          const inner = src.slice(cmd.end + 1, close).trim();
          if (
            cmd.name === "begin" &&
            (VERBATIM_ENVS.has(inner) || MATH_ENVS.has(inner))
          ) {
            const sub = findMatchingEnvEnd(
              src,
              close,
              inner,
              scopeEnd,
              depthGuard + 1,
            );
            if (!sub) return null;
            i = sub.endClose + 1;
            continue;
          }
          if (inner === envName) {
            if (cmd.name === "begin") depth++;
            else {
              depth--;
              if (depth === 0) return { endStart: i, endClose: close };
            }
          }
          i = close + 1;
          continue;
        }
        i = cmd.end;
        continue;
      }
      // control symbol
      if (nxt === "(" || nxt === "[") {
        const open = nxt as "(" | "[";
        const found = findBackslashParenClose(src, i, scopeEnd, open);
        if (found === -1) return null;
        i = found + 2;
        continue;
      }
      i += 2;
      continue;
    }
    if (c === "$") {
      if (isEscaped(src, i)) {
        i++;
        continue;
      }
      const display = i + 1 < scopeEnd && src[i + 1] === "$";
      const found = findDollarClose(src, i, scopeEnd, display);
      if (found === -1) return null;
      i = found + (display ? 2 : 1);
      continue;
    }
    i++;
  }
  return null;
}

function findMatchingBrace(
  src: string,
  openPos: number,
  scopeEnd: number,
): number {
  let depth = 1;
  let i = openPos + 1;
  while (i < scopeEnd) {
    const c = src[i];
    if (c === "%") {
      if (!isEscaped(src, i)) {
        i = findLineEnd(src, i, scopeEnd);
        continue;
      }
      i++;
      continue;
    }
    if (c === "\\") {
      if (i + 1 >= scopeEnd) {
        i++;
        continue;
      }
      const nxt = src[i + 1]!;
      if (isLetterOrAt(nxt)) {
        const cmd = parseCommandAt(src, i);
        if (!cmd || cmd.end > scopeEnd) {
          i += 2;
          continue;
        }
        if (cmd.name === "verb") {
          const le = findLineEnd(src, i, scopeEnd);
          if (cmd.end >= scopeEnd) return -1;
          const vEnd = findVerbEndOnLine(src, cmd.end, le);
          if (vEnd === -1) return -1;
          i = vEnd + 1;
          continue;
        }
        if (cmd.name === "begin") {
          if (cmd.end < scopeEnd && src[cmd.end] === "{") {
            const close = findEnvNameClose(src, cmd.end, scopeEnd);
            if (close === -1) return -1;
            const inner = src.slice(cmd.end + 1, close).trim();
            if (VERBATIM_ENVS.has(inner) || MATH_ENVS.has(inner)) {
              const sub = findMatchingEnvEnd(src, close, inner, scopeEnd);
              if (!sub) return -1;
              i = sub.endClose + 1;
              continue;
            }
          }
          i = cmd.end;
          continue;
        }
        i = cmd.end;
        continue;
      }
      if (nxt === "(" || nxt === "[") {
        const found = findBackslashParenClose(src, i, scopeEnd, nxt);
        if (found === -1) return -1;
        i = found + 2;
        continue;
      }
      i += 2;
      continue;
    }
    if (c === "$") {
      if (isEscaped(src, i)) {
        i++;
        continue;
      }
      const display = i + 1 < scopeEnd && src[i + 1] === "$";
      const found = findDollarClose(src, i, scopeEnd, display);
      if (found === -1) return -1;
      i = found + (display ? 2 : 1);
      continue;
    }
    if (c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === "}") {
      depth--;
      if (depth === 0) return i;
      i++;
      continue;
    }
    i++;
  }
  return -1;
}

type DocMarkers =
  | { kind: "none" | "invalid" }
  | { kind: "full"; beginEnd: number; endStart: number };

/** Only top-level markers count: definitions, comments and opaque environments cannot open the document. */
function findDocumentMarkers(src: string): DocMarkers {
  let beginEnd = -1,
    endStart = -1;
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    if (c === "%") {
      i = findLineEnd(src, i, src.length);
      continue;
    }
    if (c === "{") {
      const close = findMatchingBrace(src, i, src.length);
      if (close < 0) return { kind: "invalid" };
      i = close + 1;
      continue;
    }
    if (c === "$") {
      const display = src[i + 1] === "$";
      const close = findDollarClose(src, i, src.length, display);
      if (close < 0) return { kind: "invalid" };
      i = close + (display ? 2 : 1);
      continue;
    }
    if (c !== "\\") {
      i++;
      continue;
    }
    const cmd = parseCommandAt(src, i);
    if (!cmd) {
      if (src[i + 1] === "(" || src[i + 1] === "[") {
        const close = findBackslashParenClose(
          src,
          i,
          src.length,
          src[i + 1] as "(" | "[",
        );
        if (close < 0) return { kind: "invalid" };
        i = close + 2;
      } else i += 2;
      continue;
    }
    if (cmd.name === "verb") {
      const close = findVerbEndOnLine(
        src,
        cmd.end,
        findLineEnd(src, i, src.length),
      );
      if (close < 0) return { kind: "invalid" };
      i = close + 1;
      continue;
    }
    if ((cmd.name === "begin" || cmd.name === "end") && src[cmd.end] === "{") {
      const close = findEnvNameClose(src, cmd.end, src.length);
      if (close < 0) return { kind: "invalid" };
      const env = src.slice(cmd.end + 1, close);
      if (env === "document") {
        if (cmd.name === "begin") {
          if (beginEnd >= 0 || endStart >= 0) return { kind: "invalid" };
          beginEnd = close + 1;
        } else {
          if (beginEnd < 0 || endStart >= 0) return { kind: "invalid" };
          endStart = i;
        }
        i = close + 1;
        continue;
      }
      if (cmd.name === "begin") {
        const pair = findMatchingEnvEnd(src, close, env, src.length);
        if (!pair) return { kind: "invalid" };
        i = pair.endClose + 1;
        continue;
      }
    }
    i = cmd.end;
  }
  if (beginEnd < 0) return { kind: "none" };
  if (endStart < 0) return { kind: "invalid" };
  return { kind: "full", beginEnd, endStart };
}

function sectionLevel(name: string): 1 | 2 | 3 | null {
  if (name === "section") return 1;
  if (name === "subsection") return 2;
  if (name === "subsubsection") return 3;
  return null;
}

function markKind(name: string): "bold" | "italic" | null {
  if (name === "textbf") return "bold";
  if (name === "textit" || name === "emph") return "italic";
  return null;
}

function literalForTwoChar(sym: string): string | null {
  if (
    sym === "%" ||
    sym === "&" ||
    sym === "#" ||
    sym === "_" ||
    sym === "$" ||
    sym === "{" ||
    sym === "}"
  ) {
    return sym;
  }
  return null;
}

function literalForTextCommand(name: string): string | null {
  if (name === "textbackslash") return "\\";
  if (name === "textasciitilde") return "~";
  if (name === "textasciicircum") return "^";
  return null;
}

export function parseVisualDocument(source: string): VisualDocument {
  const len = source.length;
  const whole: VisualRange = { from: 0, to: len };

  const limitedResult = (): VisualDocument => ({
    hidden: [],
    marks: [],
    headings: [],
    protected: len === 0 ? [] : [{ from: 0, to: len }],
    body: { ...whole },
    limited: true,
    literals: [],
    items: [],
  });

  if (len > MAX_SOURCE_UTF16) return limitedResult();

  let newlines = 0;
  for (let k = 0; k < len; k++) {
    if (source[k] === "\n") {
      newlines++;
      if (newlines + 1 > MAX_LINES) return limitedResult();
    }
  }

  const hidden: VisualRange[] = [];
  const marks: VisualMark[] = [];
  const headings: VisualHeading[] = [];
  const guards: VisualRange[] = [];
  const literals: VisualLiteral[] = [];
  const items: (VisualRange & { text: string })[] = [];

  const addGuard = (from: number, to: number) => {
    if (to > from) guards.push({ from, to });
  };
  const addHidden = (from: number, to: number) => {
    if (to > from) {
      hidden.push({ from, to });
      guards.push({ from, to });
    }
  };

  let body: VisualRange = { ...whole };
  const markers = findDocumentMarkers(source);
  if (markers.kind === "invalid")
    return { ...limitedResult(), limited: false, body: { from: 0, to: 0 } };
  if (markers.kind === "full") {
    addHidden(0, markers.beginEnd);
    addHidden(markers.endStart, len);
    body = { from: markers.beginEnd, to: markers.endStart };
  }

  const consumeUnknownArgs = (pos: number, scopeEnd: number): number => {
    let t = pos;
    while (t < scopeEnd) {
      const ch = source[t];
      if (ch === "[") {
        const cb = findMatchingBracket(source, t, scopeEnd);
        if (cb === -1) {
          addGuard(t, scopeEnd);
          return scopeEnd;
        }
        addGuard(t, cb + 1);
        t = cb + 1;
        continue;
      }
      if (ch === "{") {
        const cb = findMatchingBrace(source, t, scopeEnd);
        if (cb === -1) {
          addGuard(t, scopeEnd);
          return scopeEnd;
        }
        addGuard(t, cb + 1);
        t = cb + 1;
        continue;
      }
      break;
    }
    return t;
  };

  const protectFallbackWithOptionals = (
    cmdStart: number,
    cmdEnd: number,
    scopeEnd: number,
  ): number => {
    addGuard(cmdStart, cmdEnd);
    return consumeUnknownArgs(cmdEnd, scopeEnd);
  };

  function parseScope(
    s: number,
    e: number,
    allowHeadings: boolean,
    inList: boolean,
    depth: number,
    listType?: string,
  ): void {
    if (s >= e) return;
    if (depth > MAX_KNOWN_DEPTH) {
      addGuard(s, e);
      return;
    }
    let i = s;
    let itemNumber = 0;
    while (i < e) {
      const c = source[i];
      if (c === "%") {
        if (isEscaped(source, i)) {
          i++;
          continue;
        }
        const le = findLineEnd(source, i, e);
        addGuard(i, le);
        i = le;
        continue;
      }
      if (c === "\\") {
        if (i + 1 >= e) {
          addGuard(i, e);
          i = e;
          continue;
        }
        const nxt = source[i + 1]!;
        if (isLetterOrAt(nxt)) {
          const cmd = parseCommandAt(source, i);
          if (!cmd || cmd.end > e) {
            addGuard(i, e);
            i = e;
            continue;
          }
          const cmdStart = i;
          const cmdEnd = cmd.end;
          const lvl = sectionLevel(cmd.name);
          const kind = markKind(cmd.name);

          if (lvl !== null) {
            if (!allowHeadings) {
              i = protectFallbackWithOptionals(cmdStart, cmdEnd, e);
              continue;
            }
            if (cmdEnd < e && source[cmdEnd] === "[") {
              const ob = findMatchingBracket(source, cmdEnd, e);
              if (ob === -1) {
                addGuard(cmdStart, e);
                i = e;
                continue;
              }
              const t = ob + 1;
              if (t < e && source[t] === "{") {
                const cb = findMatchingBrace(source, t, e);
                if (cb === -1) {
                  addGuard(cmdStart, e);
                  i = e;
                  continue;
                }
                addGuard(cmdStart, cb + 1);
                i = cb + 1;
              } else {
                addGuard(cmdStart, ob + 1);
                i = ob + 1;
              }
              continue;
            }
            if (cmdEnd >= e || source[cmdEnd] !== "{") {
              addGuard(cmdStart, cmdEnd);
              i = cmdEnd;
              continue;
            }
            const close = findMatchingBrace(source, cmdEnd, e);
            if (close === -1) {
              addGuard(cmdStart, e);
              i = e;
              continue;
            }
            const lineStart = lineStartOf(source, cmdStart);
            const lineEnd = findLineEnd(source, close + 1, e);
            const after = source.slice(close + 1, lineEnd).trim();
            if (
              source.slice(lineStart, cmdStart).trim() ||
              (after && !after.startsWith("%")) ||
              source.slice(cmdEnd + 1, close).includes("\n")
            ) {
              addGuard(cmdStart, close + 1);
              i = close + 1;
              continue;
            }
            addHidden(cmdStart, cmdEnd + 1);
            addHidden(close, close + 1);
            headings.push({ from: lineStartOf(source, cmdStart), level: lvl });
            if (close > cmdEnd + 1) {
              parseScope(cmdEnd + 1, close, false, false, depth + 1);
            }
            i = close + 1;
            continue;
          }

          if (kind !== null) {
            if (cmd.star) {
              i = protectFallbackWithOptionals(cmdStart, cmdEnd, e);
              continue;
            }
            if (cmdEnd < e && source[cmdEnd] === "[") {
              const ob = findMatchingBracket(source, cmdEnd, e);
              if (ob === -1) {
                addGuard(cmdStart, e);
                i = e;
                continue;
              }
              const t = ob + 1;
              if (t < e && source[t] === "{") {
                const cb = findMatchingBrace(source, t, e);
                if (cb === -1) {
                  addGuard(cmdStart, e);
                  i = e;
                  continue;
                }
                addGuard(cmdStart, cb + 1);
                i = cb + 1;
              } else {
                addGuard(cmdStart, ob + 1);
                i = ob + 1;
              }
              continue;
            }
            if (cmdEnd >= e || source[cmdEnd] !== "{") {
              addGuard(cmdStart, cmdEnd);
              i = cmdEnd;
              continue;
            }
            const close = findMatchingBrace(source, cmdEnd, e);
            if (close === -1) {
              addGuard(cmdStart, e);
              i = e;
              continue;
            }
            addHidden(cmdStart, cmdEnd + 1);
            addHidden(close, close + 1);
            if (close > cmdEnd + 1) {
              marks.push({ from: cmdEnd + 1, to: close, kind });
              parseScope(cmdEnd + 1, close, false, false, depth + 1);
            }
            i = close + 1;
            continue;
          }

          if (cmd.name === "verb") {
            if (cmdEnd >= e) {
              addGuard(cmdStart, e);
              i = e;
              continue;
            }
            const le = findLineEnd(source, cmdStart, e);
            const vEnd = findVerbEndOnLine(source, cmdEnd, le);
            if (vEnd === -1) {
              addGuard(cmdStart, le);
              i = le;
              continue;
            }
            addGuard(cmdStart, vEnd + 1);
            i = vEnd + 1;
            continue;
          }

          if (cmd.name === "begin") {
            if (cmdEnd >= e || source[cmdEnd] !== "{") {
              addGuard(cmdStart, cmdEnd);
              i = cmdEnd;
              continue;
            }
            const nameClose = findEnvNameClose(source, cmdEnd, e);
            if (nameClose === -1) {
              addGuard(cmdStart, e);
              i = e;
              continue;
            }
            const env = source.slice(cmdEnd + 1, nameClose).trim();
            if (env === "document") {
              const sub = findMatchingEnvEnd(source, nameClose, env, e);
              if (!sub) {
                addGuard(cmdStart, e);
                i = e;
              } else {
                addGuard(cmdStart, sub.endClose + 1);
                i = sub.endClose + 1;
              }
              continue;
            }
            if (VERBATIM_ENVS.has(env) || MATH_ENVS.has(env)) {
              const sub = findMatchingEnvEnd(source, nameClose, env, e);
              if (!sub) {
                addGuard(cmdStart, e);
                i = e;
              } else {
                addGuard(cmdStart, sub.endClose + 1);
                i = sub.endClose + 1;
              }
              continue;
            }
            if (LIST_ENVS.has(env)) {
              const sub = findMatchingEnvEnd(source, nameClose, env, e);
              if (!sub) {
                addGuard(cmdStart, e);
                i = e;
                continue;
              }
              addHidden(cmdStart, nameClose + 1);
              addHidden(sub.endStart, sub.endClose + 1);
              parseScope(
                nameClose + 1,
                sub.endStart,
                false,
                true,
                depth + 1,
                env,
              );
              i = sub.endClose + 1;
              continue;
            }
            const sub = findMatchingEnvEnd(source, nameClose, env, e);
            if (!sub) {
              addGuard(cmdStart, e);
              i = e;
            } else {
              addGuard(cmdStart, sub.endClose + 1);
              i = sub.endClose + 1;
            }
            continue;
          }

          if (cmd.name === "end") {
            if (cmdEnd < e && source[cmdEnd] === "{") {
              const nameClose = findEnvNameClose(source, cmdEnd, e);
              if (nameClose === -1) {
                addGuard(cmdStart, e);
                i = e;
                continue;
              }
              addGuard(cmdStart, nameClose + 1);
              i = nameClose + 1;
              continue;
            }
            addGuard(cmdStart, cmdEnd);
            i = cmdEnd;
            continue;
          }

          if (cmd.name === "item") {
            if (inList) {
              if (cmdEnd < e && source[cmdEnd] === "[") {
                const ob = findMatchingBracket(source, cmdEnd, e);
                if (ob === -1) {
                  addGuard(cmdStart, e);
                  i = e;
                  continue;
                }
                addGuard(cmdStart, ob + 1);
                i = ob + 1;
                continue;
              }
              addGuard(cmdStart, cmdEnd);
              items.push({
                from: cmdStart,
                to: cmdEnd,
                text: listType === "enumerate" ? `${++itemNumber}.` : "•",
              });
              i = cmdEnd;
              continue;
            }
            i = protectFallbackWithOptionals(cmdStart, cmdEnd, e);
            continue;
          }

          const litText = literalForTextCommand(cmd.name);
          if (litText !== null) {
            if (!cmd.star && source.slice(cmdEnd, cmdEnd + 2) === "{}") {
              literals.push({ from: cmdStart, to: cmdEnd + 2, text: litText });
              addGuard(cmdStart, cmdEnd + 2);
              i = cmdEnd + 2;
              continue;
            }
            i = protectFallbackWithOptionals(cmdStart, cmdEnd, e);
            continue;
          }

          i = protectFallbackWithOptionals(cmdStart, cmdEnd, e);
          continue;
        }

        // control symbol: backslash + single char
        const sym = nxt;
        if (sym === "(" || sym === "[") {
          const found = findBackslashParenClose(source, i, e, sym);
          if (found === -1) {
            addGuard(i, e);
            i = e;
          } else {
            addGuard(i, found + 2);
            i = found + 2;
          }
          continue;
        }
        if (i + 1 >= e) {
          addGuard(i, e);
          i = e;
          continue;
        }
        const lit = literalForTwoChar(sym);
        if (lit !== null) {
          literals.push({ from: i, to: i + 2, text: lit });
          addGuard(i, i + 2);
          i += 2;
          continue;
        }
        addGuard(i, i + 2);
        i += 2;
        continue;
      }
      if (c === "$") {
        if (isEscaped(source, i)) {
          i++;
          continue;
        }
        const display = i + 1 < e && source[i + 1] === "$";
        const found = findDollarClose(source, i, e, display);
        if (found === -1) {
          addGuard(i, e);
          i = e;
          continue;
        }
        const closeEnd = found + (display ? 2 : 1);
        addGuard(i, closeEnd);
        i = closeEnd;
        continue;
      }
      if (c === "{") {
        const close = findMatchingBrace(source, i, e);
        if (close === -1) {
          addGuard(i, e);
          i = e;
          continue;
        }
        addGuard(i, close + 1);
        i = close + 1;
        continue;
      }
      if (c === "}") {
        addGuard(i, i + 1);
        i++;
        continue;
      }
      i++;
    }
  }

  if (body.to > body.from) {
    parseScope(body.from, body.to, true, false, 0);
  }

  hidden.sort((a, b) => a.from - b.from || a.to - b.to);
  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  headings.sort((a, b) => a.from - b.from);
  literals.sort((a, b) => a.from - b.from);

  guards.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: VisualRange[] = [];
  for (const r of guards) {
    const last = merged[merged.length - 1];
    if (last && r.from < last.to) {
      if (r.to > last.to) last.to = r.to;
    } else {
      merged.push({ ...r });
    }
  }

  return {
    hidden,
    marks,
    headings,
    protected: merged,
    body: { ...body },
    limited: false,
    literals,
    items,
  };
}
