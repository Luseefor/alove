/**
 * Project-wide manuscript outline: pure, bounded, deterministic.
 *
 * Follows literal `\input{path}` / `\include{path}` in document order
 * (nested, repeated with unique ids), resolves root-relative paths as TeX
 * does with a safe normalized `.tex` fallback (including-dir fallback when
 * the root is missing but unambiguous), and never resolves outside the
 * project. Skips comments, verbatim-like environments, inline `\verb`,
 * macro definitions and fake commands. Heading commands
 * part/chapter/section/subsection/subsubsection/paragraph/subparagraph
 * support `*`, optional `[short]` and balanced formatted `{title}`.
 *
 * Bounds are deterministic: distinct files, total characters, visits,
 * depth and headings are capped; hitting a cap sets `limited: true`.
 * Offsets are exact UTF-16 code units into the original file content
 * (CRLF preserved); lines are 1-based counting `\n` only.
 *
 * Only the root document body is scanned when the root has
 * `\begin{document}` … `\end{document}` markers; fragments are scanned
 * whole. `\includeonly{…}` in the root preamble filters `\include`
 * (never `\input`); dynamic/unparseable `\includeonly` warns and is
 * ignored rather than silently pretending.
 */

export type ProjectOutlineHeading = {
  id: string;
  path: string;
  /** 1-based line of `from`. */
  line: number;
  /** UTF-16 offset of `\` starting the heading command. */
  from: number;
  /** UTF-16 offset after the closing `}` of the mandatory title. */
  to: number;
  /** 0=part … 6=subparagraph. */
  level: number;
  title: string;
};

export type ProjectOutlineWarning = {
  path: string;
  line: number;
  message: string;
};

export type ProjectOutlineResult = {
  headings: ProjectOutlineHeading[];
  warnings: ProjectOutlineWarning[];
  limited: boolean;
};

export const PROJECT_OUTLINE_MAX_FILES = 200;
export const PROJECT_OUTLINE_MAX_VISITS = 500;
export const PROJECT_OUTLINE_MAX_HEADINGS = 2000;
export const PROJECT_OUTLINE_MAX_TOTAL_CHARS = 2_000_000;
export const PROJECT_OUTLINE_MAX_DEPTH = 32;
export const PROJECT_OUTLINE_MAX_WARNINGS = 100;
const MAX_PATH_LEN = 500;
const MAX_TITLE_RAW_CHARS = 2000;
/** Rendered title cap so the sidebar never holds an unbounded DOM string. */
export const PROJECT_OUTLINE_MAX_TITLE_CHARS = 500;
/** Warning snippet cap so a single huge `\input{...}` cannot bloat notices. */
const MAX_WARNING_SNIPPET = 200;
/** Cap `\includeonly` occurrences scanned: bounds work and avoids O(n²) line mapping. */
export const PROJECT_OUTLINE_MAX_INCLUDEONLY = 100;

function truncateSnippet(value: string, max: number): string {
  if (value.length <= max) return value;
  let end = max;
  // Avoid splitting a surrogate pair: back off one unit if we cut high.
  const cu = value.charCodeAt(end - 1);
  if (cu >= 0xd800 && cu <= 0xdbff) end -= 1;
  return `${value.slice(0, end)}…`;
}

function boundTitle(title: string): string {
  if (title.length <= PROJECT_OUTLINE_MAX_TITLE_CHARS) return title;
  let end = PROJECT_OUTLINE_MAX_TITLE_CHARS - 1;
  const cu = title.charCodeAt(end - 1);
  if (cu >= 0xd800 && cu <= 0xdbff) end -= 1;
  return `${title.slice(0, Math.max(0, end))}…`;
}

const LEVEL_MAP: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

const HEADING_COMMANDS = new Set(Object.keys(LEVEL_MAP));
const VERBATIM_ENVS = new Set([
  "verbatim",
  "verbatim*",
  "lstlisting",
  "lstlisting*",
  "minted",
  "comment",
]);
const DEFINING_COMMANDS = new Set([
  "newcommand",
  "renewcommand",
  "providecommand",
  "DeclareRobustCommand",
  "DeclareMathOperator",
  "def",
  "edef",
  "gdef",
  "xdef",
]);

function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z"));
}

function isEscaped(content: string, pos: number): boolean {
  let n = 0;
  for (let i = pos - 1; i >= 0 && content[i] === "\\"; i -= 1) n += 1;
  return n % 2 === 1;
}

function hasOwn(map: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, key);
}

function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function countNewlines(content: string, from: number, to: number): number {
  let n = 0;
  const end = Math.min(to, content.length);
  for (let i = Math.max(0, from); i < end; i += 1) {
    if (content[i] === "\n") n += 1;
  }
  return n;
}

function lineAt(content: string, offset: number): number {
  const safe = Math.max(0, Math.min(offset, content.length));
  let line = 1;
  for (let i = 0; i < safe; i += 1) {
    if (content[i] === "\n") line += 1;
  }
  return line;
}

/** Safe project-relative normalization; null = unsafe/traversal/invalid. */
function safeNormalizePath(p: string): string | null {
  if (p.length === 0 || p.length > MAX_PATH_LEN) return null;
  if (p.startsWith("/")) return null;
  if (p.includes("\\") || p.includes(":") || p.includes("\0")) return null;
  if (p.includes("\n") || p.includes("\r")) return null;
  for (let i = 0; i < p.length; i += 1) {
    const c = p.charCodeAt(i);
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) {
      // Tab/LF/CR already rejected above; any other control is invalid.
      return null;
    }
  }
  const segs = p.split("/");
  const out: string[] = [];
  for (const seg of segs) {
    if (seg.length === 0) return null;
    if (seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    if (seg !== seg.trim()) return null;
    if (seg.startsWith("-")) return null;
    if (seg === "__proto__" || seg === "constructor" || seg === "prototype") return null;
    out.push(seg);
  }
  if (out.length === 0) return null;
  return out.join("/");
}

function skipSpacesAndComments(content: string, pos: number, end: number): number {
  let i = pos;
  while (i < end) {
    const ch = content[i];
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === "\f" || ch === "\v") {
      i += 1;
      continue;
    }
    if (ch === "%" && !isEscaped(content, i)) {
      while (i < end && content[i] !== "\n") i += 1;
      continue;
    }
    break;
  }
  return i;
}

function findMatchingBrace(content: string, open: number, end: number): number | null {
  if (open < 0 || open >= end || content[open] !== "{") return null;
  let depth = 0;
  let i = open;
  while (i < end) {
    const ch = content[i];
    if (ch === "%" && !isEscaped(content, i)) {
      while (i < end && content[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
      if (depth < 0) return null;
    }
    i += 1;
  }
  return null;
}

function findMatchingBracket(content: string, open: number, end: number): number | null {
  if (open < 0 || open >= end || content[open] !== "[") return null;
  let depth = 0;
  let i = open;
  while (i < end) {
    const ch = content[i];
    if (ch === "%" && !isEscaped(content, i)) {
      while (i < end && content[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return i;
      if (depth < 0) return null;
    }
    i += 1;
  }
  return null;
}

function stripPathComments(raw: string): string {
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "%" && !isEscaped(raw, i)) {
      while (i < raw.length && raw[i] !== "\n") i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function cleanTitle(raw: string, depth = 0): string {
  if (depth > 32) return "";
  const src = raw.length > MAX_TITLE_RAW_CHARS ? raw.slice(0, MAX_TITLE_RAW_CHARS) : raw;
  const n = src.length;
  let out = "";
  let i = 0;
  const needSpace = () => out.length > 0 && !out.endsWith(" ") && !out.endsWith("\n");
  while (i < n) {
    const ch = src[i];
    if (ch === "%" && !isEscaped(src, i)) {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "\\") {
      if (i + 1 >= n) break;
      const nxt = src[i + 1]!;
      if (/[a-zA-Z]/.test(nxt)) {
        let j = i + 1;
        while (j < n && /[a-zA-Z]/.test(src[j]!)) j += 1;
        const cmd = src.slice(i + 1, j);
        let k = j;
        let skippedSpace = false;
        while (k < n && (src[k] === " " || src[k] === "\t" || src[k] === "\r" || src[k] === "\n")) {
          skippedSpace = true;
          k += 1;
        }
        if (k < n && src[k] === "*") {
          k += 1;
          while (k < n && (src[k] === " " || src[k] === "\t" || src[k] === "\r" || src[k] === "\n")) k += 1;
        }
        if (k < n && src[k] === "[") {
          const close = findMatchingBracket(src, k, n);
          if (close !== null) {
            k = close + 1;
            while (k < n && (src[k] === " " || src[k] === "\t" || src[k] === "\r" || src[k] === "\n")) k += 1;
          }
        }
        let consumed = false;
        let first = true;
        while (k < n && src[k] === "{") {
          const close = findMatchingBrace(src, k, n);
          if (close === null) break;
          const inner = cleanTitle(src.slice(k + 1, close), depth + 1);
          if (inner.length > 0) {
            if (!first || needSpace()) {
              if (needSpace()) out += " ";
            } else if (out.length > 0 && !out.endsWith(" ") && !inner.startsWith(" ")) {
              // Keep word boundary when a command glued two words, e.g. \textbf{a}b.
              // No extra space needed when the arg itself starts the next word;
              // joining directly preserves TeX behavior for glued text.
            }
            out += inner;
          } else if (!first && needSpace()) {
            out += " ";
          }
          first = false;
          consumed = true;
          k = close + 1;
          let sawSpace = false;
          while (k < n && (src[k] === " " || src[k] === "\t" || src[k] === "\r" || src[k] === "\n")) {
            sawSpace = true;
            k += 1;
          }
          if (sawSpace && k < n) {
            // Preserve a word boundary that TeX would keep after `}`.
            out += " ";
          }
        }
        if (consumed) {
          i = k;
          continue;
        }
        // No braced arg: keep the command name as text (e.g. \LaTeX -> LaTeX).
        if (needSpace()) out += " ";
        out += cmd;
        // Preserve following whitespace via the main loop (do not skip it here).
        i = j;
        if (skippedSpace) out += " ";
        continue;
      }
      // Single-character command.
      if (nxt === "\\") {
        if (needSpace()) out += " ";
        out += " ";
        i += 2;
        continue;
      }
      if (nxt === "%" || nxt === "&" || nxt === "#" || nxt === "_" || nxt === "$" || nxt === "{" || nxt === "}") {
        out += nxt;
        i += 2;
        continue;
      }
      if (nxt === " " || nxt === "," || nxt === ";" || nxt === ":" || nxt === "!" || nxt === "/") {
        out += " ";
        i += 2;
        continue;
      }
      if (nxt === "(" || nxt === ")" || nxt === "[" || nxt === "]") {
        // \( \) \[ \] math delimiters: drop.
        i += 2;
        continue;
      }
      if (nxt === '"' || nxt === "'" || nxt === "`" || nxt === "^" || nxt === "~" || nxt === "=" || nxt === ".") {
        // Accents: drop the accent, keep the base letter from the following group.
        i += 2;
        continue;
      }
      // Unknown single-char command: drop the backslash, keep the char.
      out += nxt;
      i += 2;
      continue;
    }
    if (ch === "{") {
      const close = findMatchingBrace(src, i, n);
      if (close === null) {
        i += 1;
        continue;
      }
      const inner = cleanTitle(src.slice(i + 1, close), depth + 1);
      if (inner.length > 0) {
        if (needSpace() && !/^[ .,;:!?)]/.test(inner)) out += " ";
        out += inner;
      }
      i = close + 1;
      continue;
    }
    if (ch === "}") {
      i += 1;
      continue;
    }
    if (ch === "$") {
      i += 1;
      continue;
    }
    if (ch === "~") {
      out += " ";
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out.replace(/[\s\u00a0]+/g, " ").trim();
}

type HeadingParse = {
  from: number;
  to: number;
  level: number;
  title: string;
};

function tryParseHeading(
  content: string,
  backslashPos: number,
  afterCmdPos: number,
  cmd: string,
  end: number,
): HeadingParse | null {
  let k = skipSpacesAndComments(content, afterCmdPos, end);
  if (k < end && content[k] === "*") {
    k += 1;
    k = skipSpacesAndComments(content, k, end);
  }
  if (k < end && content[k] === "[") {
    const close = findMatchingBracket(content, k, end);
    if (close === null) return null;
    k = skipSpacesAndComments(content, close + 1, end);
  }
  if (k >= end || content[k] !== "{") return null;
  const close = findMatchingBrace(content, k, end);
  if (close === null) return null;
  const rawTitle = content.slice(k + 1, close);
  const title = boundTitle(cleanTitle(rawTitle));
  const level = LEVEL_MAP[cmd] ?? 2;
  return { from: backslashPos, to: close + 1, level, title };
}

type IncludeParse = {
  from: number;
  to: number;
  rawArg: string;
  kind: "input" | "include";
};

function tryParseInclude(
  content: string,
  backslashPos: number,
  afterCmdPos: number,
  kind: "input" | "include",
  end: number,
): IncludeParse | null {
  let k = skipSpacesAndComments(content, afterCmdPos, end);
  if (k < end && content[k] === "[") {
    const closeOpt = findMatchingBracket(content, k, end);
    if (closeOpt === null) return null;
    k = skipSpacesAndComments(content, closeOpt + 1, end);
  }
  if (k >= end || content[k] !== "{") return null;
  const close = findMatchingBrace(content, k, end);
  if (close === null) return null;
  const rawWithComments = content.slice(k + 1, close);
  const raw = stripPathComments(rawWithComments).trim();
  return { from: backslashPos, to: close + 1, rawArg: raw, kind };
}

function isDynamicIncludeArg(raw: string): boolean {
  if (raw.length === 0) return true;
  if (/[\\{}#%]/.test(raw)) return true;
  if (/[\n\r\0]/.test(raw)) return true;
  return false;
}

type ResolveOk = { ok: true; path: string };
type ResolveFail = { ok: false; reason: "traversal" | "missing" };
function resolveIncludeTarget(
  rawArg: string,
  includingPath: string,
  filesByPath: Record<string, string>,
): ResolveOk | ResolveFail {
  const trimmed = rawArg.trim();
  if (trimmed.length === 0) return { ok: false, reason: "missing" };
  // Absolute paths are never followed: they would escape the project.
  // TeX root-relative lookup uses plain relative keys; reject `/foo`.
  if (trimmed.startsWith("/")) return { ok: false, reason: "traversal" };
  if (isDynamicIncludeArg(trimmed)) return { ok: false, reason: "missing" };
  const stripped = trimmed;

  const rootBase = safeNormalizePath(stripped);
  if (rootBase !== null) {
    if (hasOwn(filesByPath, rootBase)) return { ok: true, path: rootBase };
    if (!rootBase.endsWith(".tex")) {
      const withTex = `${rootBase}.tex`;
      if (hasOwn(filesByPath, withTex)) return { ok: true, path: withTex };
    }
  }
  const dir = dirname(includingPath);
  if (dir === "") {
    return rootBase === null ? { ok: false, reason: "traversal" } : { ok: false, reason: "missing" };
  }
  const joinedNorm = safeNormalizePath(`${dir}/${stripped}`);
  if (joinedNorm === null) {
    return rootBase === null ? { ok: false, reason: "traversal" } : { ok: false, reason: "missing" };
  }
  if (hasOwn(filesByPath, joinedNorm)) return { ok: true, path: joinedNorm };
  if (!joinedNorm.endsWith(".tex")) {
    const withTex = `${joinedNorm}.tex`;
    if (hasOwn(filesByPath, withTex)) return { ok: true, path: withTex };
  }
  if (rootBase === null) return { ok: false, reason: "traversal" };
  return { ok: false, reason: "missing" };
}

/** Find root document body [start, end) or null when markers are absent. */
function findDocumentBody(content: string): [number, number] | null {
  const end = content.length;
  let beginStart = -1;
  let beginEnd = -1;
  let braceDepth = 0;
  let i = 0;
  // First pass: locate \begin{document} and \end{document} skipping
  // comments/verbatim and any macro/group args (braceDepth !== 0).
  // Fake markers inside \newcommand args or bare groups are ignored.
  while (i < end) {
    const ch = content[i];
    if (ch === "{" && !isEscaped(content, i)) {
      braceDepth += 1;
      i += 1;
      continue;
    }
    if (ch === "}" && !isEscaped(content, i)) {
      if (braceDepth > 0) braceDepth -= 1;
      i += 1;
      continue;
    }
    if (ch === "%" && !isEscaped(content, i)) {
      while (i < end && content[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\\" && i + 1 < end && isLetter(content[i + 1])) {
      let j = i + 1;
      while (j < end && isLetter(content[j])) j += 1;
      const cmd = content.slice(i + 1, j);
      if (cmd === "begin") {
        const k = skipSpacesAndComments(content, j, end);
        if (k < end && content[k] === "{") {
          const close = findMatchingBrace(content, k, end);
          if (close !== null) {
            const env = content.slice(k + 1, close).trim();
            if (VERBATIM_ENVS.has(env)) {
              // Verbatim stays opaque everywhere to keep braceDepth correct,
              // even for fake blocks nested inside macro/group args.
              const marker = `\\end{${env}}`;
              const idx = content.indexOf(marker, close + 1);
              if (idx === -1) break;
              i = idx + marker.length;
              continue;
            }
            if (braceDepth === 0 && env === "document" && beginStart === -1) {
              beginStart = i;
              beginEnd = close + 1;
              i = close + 1;
              continue;
            }
            // Fake \begin{document} inside macro/group args is ignored;
            // skip only the `{env}` part so braceDepth stays balanced.
            i = close + 1;
            continue;
          }
        }
        i = j;
        continue;
      }
      if (cmd === "end") {
        const k = skipSpacesAndComments(content, j, end);
        if (k < end && content[k] === "{") {
          const close = findMatchingBrace(content, k, end);
          if (close !== null) {
            const env = content.slice(k + 1, close).trim();
            if (braceDepth === 0 && env === "document" && beginStart !== -1) {
              return [beginEnd, i];
            }
            i = close + 1;
            continue;
          }
        }
        i = j;
        continue;
      }
      if (cmd === "verb") {
        let k = j;
        if (k < end && content[k] === "*") k += 1;
        if (k >= end) {
          i = k;
          continue;
        }
        const delim = content[k]!;
        if (delim === "\n" || delim === "\r" || isLetter(delim)) {
          i = k;
          continue;
        }
        let m = k + 1;
        while (m < end && content[m] !== delim && content[m] !== "\n" && content[m] !== "\r") m += 1;
        i = m < end && content[m] === delim ? m + 1 : m;
        continue;
      }
      i = j;
      continue;
    }
    if (ch === "\\") {
      i += 2;
      continue;
    }
    i += 1;
  }
  return null;
}

type IncludeOnlyParse = {
  entries: string[];
  dynamic: boolean;
  from: number;
  to: number;
  line: number;
};

function collectIncludeOnly(
  content: string,
  start: number,
  end: number,
): { found: boolean; dynamic: boolean; entries: string[]; occurrences: IncludeOnlyParse[]; capped: boolean } {
  const occurrences: IncludeOnlyParse[] = [];
  let braceDepth = 0;
  // Running line avoids O(n²) `lineAt` per occurrence on large roots.
  let line = lineAt(content, start);
  let capped = false;
  let i = start;
  while (i < end) {
    const ch = content[i];
    if (ch === "{" && !isEscaped(content, i)) {
      braceDepth += 1;
      i += 1;
      continue;
    }
    if (ch === "}" && !isEscaped(content, i)) {
      if (braceDepth > 0) braceDepth -= 1;
      i += 1;
      continue;
    }
    if (ch === "%" && !isEscaped(content, i)) {
      while (i < end && content[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\\" && i + 1 < end && isLetter(content[i + 1])) {
      let j = i + 1;
      while (j < end && isLetter(content[j])) j += 1;
      const cmd = content.slice(i + 1, j);
      if (cmd === "begin") {
        const k = skipSpacesAndComments(content, j, end);
        if (k < end && content[k] === "{") {
          const close = findMatchingBrace(content, k, end);
          if (close !== null) {
            const env = content.slice(k + 1, close).trim();
            if (VERBATIM_ENVS.has(env)) {
              const marker = `\\end{${env}}`;
              const idx = content.indexOf(marker, close + 1);
              if (idx === -1 || idx + marker.length > end) break;
              line += countNewlines(content, i, idx + marker.length);
              i = idx + marker.length;
              continue;
            }
            i = close + 1;
            continue;
          }
        }
        i = j;
        continue;
      }
      if (cmd === "verb") {
        let k = j;
        if (k < end && content[k] === "*") k += 1;
        if (k >= end) {
          i = k;
          continue;
        }
        const delim = content[k]!;
        if (delim === "\n" || delim === "\r" || isLetter(delim)) {
          i = k;
          continue;
        }
        let m = k + 1;
        while (m < end && content[m] !== delim && content[m] !== "\n" && content[m] !== "\r") m += 1;
        i = m < end && content[m] === delim ? m + 1 : m;
        continue;
      }
      if (cmd === "includeonly") {
        // Fake \includeonly inside macro/group args is ignored.
        if (braceDepth !== 0) {
          i = j;
          continue;
        }
        // Bound occurrences before any further scan: endless `\includeonly`
        // spam in a 2MB root must not grow warnings or cost O(n²).
        if (occurrences.length >= PROJECT_OUTLINE_MAX_INCLUDEONLY) {
          capped = true;
          break;
        }
        const k = skipSpacesAndComments(content, j, end);
        if (k < end && content[k] === "{") {
          const close = findMatchingBrace(content, k, end);
          if (close === null) {
            occurrences.push({ entries: [], dynamic: true, from: i, to: j, line });
            i = j;
            continue;
          }
          const raw = content.slice(k + 1, close);
          if (/[\\#{}%]/.test(raw)) {
            occurrences.push({ entries: [], dynamic: true, from: i, to: close + 1, line });
          } else {
            const parts = raw
              .split(",")
              .map((s) => s.trim())
              .filter((s) => s.length > 0);
            occurrences.push({ entries: parts, dynamic: false, from: i, to: close + 1, line });
          }
          line += countNewlines(content, i, close + 1);
          i = close + 1;
          continue;
        }
        i = j;
        continue;
      }
      i = j;
      continue;
    }
    if (ch === "\\") {
      line += countNewlines(content, i, Math.min(i + 2, end));
      i += 2;
      continue;
    }
    i += 1;
  }
  if (occurrences.length === 0) return { found: false, dynamic: false, entries: [], occurrences, capped };
  // Last `\includeonly` wins (LaTeX semantics); earlier ones are overridden.
  const last = occurrences[occurrences.length - 1]!;
  if (last.dynamic) return { found: true, dynamic: true, entries: [], occurrences, capped };
  return { found: true, dynamic: false, entries: last.entries, occurrences, capped };
}

function buildIncludeOnlySet(entries: string[]): { set: Set<string>; invalid: string[] } {
  const set = new Set<string>();
  const invalid: string[] = [];
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    // Absolute entries are never followed; warn instead of stripping.
    if (trimmed.startsWith("/")) {
      invalid.push(entry);
      continue;
    }
    const stripped = trimmed;
    const norm = safeNormalizePath(stripped);
    if (norm === null) {
      invalid.push(entry);
      continue;
    }
    set.add(norm);
    if (norm.endsWith(".tex")) set.add(norm.slice(0, -4));
    else set.add(`${norm}.tex`);
  }
  return { set, invalid };
}

type OutlineState = {
  mainFile: string;
  filesByPath: Record<string, string>;
  headings: ProjectOutlineHeading[];
  warnings: ProjectOutlineWarning[];
  limited: boolean;
  distinct: Set<string>;
  visits: number;
  totalChars: number;
  headingSeq: number;
  includeOnly: Set<string> | null;
  includeOnlyActive: boolean;
};

function pushWarning(state: OutlineState, path: string, line: number, message: string): void {
  if (state.warnings.length >= PROJECT_OUTLINE_MAX_WARNINGS) {
    state.limited = true;
    return;
  }
  state.warnings.push({ path, line, message });
}

/**
 * Build a project-wide manuscript outline starting from `mainFile`.
 *
 * Pure: never mutates `filesByPath`, performs no I/O, terminates via
 * deterministic bounds. Repeated includes emit distinct headings with
 * unique ids; cycles/missing/dynamic includes become warnings.
 */
export function buildProjectOutline(
  filesByPath: Record<string, string>,
  mainFile: string,
): ProjectOutlineResult {
  const headings: ProjectOutlineHeading[] = [];
  const warnings: ProjectOutlineWarning[] = [];
  // Defensive: never throw on unsafe caller input; the sidebar memoizes
  // this on every keystroke, so any throw would blank the UI.
  if (typeof filesByPath !== "object" || filesByPath === null || Array.isArray(filesByPath)) {
    return {
      headings,
      warnings: [{ path: "main.tex", line: 1, message: "Invalid project files." }],
      limited: false,
    };
  }
  if (typeof mainFile !== "string" || mainFile.length === 0) {
    return {
      headings,
      warnings: [{ path: "main.tex", line: 1, message: "Main file not found in project." }],
      limited: false,
    };
  }
  const state: OutlineState = {
    mainFile,
    filesByPath,
    headings,
    warnings,
    limited: false,
    distinct: new Set(),
    visits: 0,
    totalChars: 0,
    headingSeq: 0,
    includeOnly: null,
    includeOnlyActive: false,
  };

  const rawRoot: unknown = hasOwn(filesByPath, mainFile) ? filesByPath[mainFile] : undefined;
  if (typeof rawRoot !== "string") {
    pushWarning(state, truncateSnippet(mainFile, MAX_WARNING_SNIPPET), 1, `Main file "${truncateSnippet(mainFile, MAX_WARNING_SNIPPET)}" not found in project.`);
    return { headings, warnings, limited: false };
  }
  const rootContent = rawRoot;

  // Root char cap before any prepass: findDocumentBody/collectIncludeOnly
  // scan the root, so bound them up front instead of scanning unbounded input.
  if (rootContent.length > PROJECT_OUTLINE_MAX_TOTAL_CHARS) {
    state.limited = true;
    pushWarning(state, mainFile, 1, "Outline truncated: project too large.");
    return { headings, warnings, limited: state.limited };
  }

  const body = findDocumentBody(rootContent);
  const includeOnlyScan = collectIncludeOnly(rootContent, 0, body ? body[0] : rootContent.length);
  if (includeOnlyScan.capped) {
    // Bounded: stop scanning endless `\includeonly` spam, warn once and
    // include everything rather than pretending to filter.
    state.limited = true;
    const last = includeOnlyScan.occurrences[includeOnlyScan.occurrences.length - 1];
    pushWarning(state, mainFile, last ? last.line : 1, "Outline truncated: too many \\includeonly directives; including all files.");
    state.includeOnly = null;
    state.includeOnlyActive = false;
  } else if (includeOnlyScan.found) {
    // Last `\includeonly` wins; earlier ones are overridden.
    if (includeOnlyScan.dynamic) {
      const last = includeOnlyScan.occurrences[includeOnlyScan.occurrences.length - 1];
      pushWarning(state, mainFile, last ? last.line : 1, "Ignoring dynamic \\includeonly; including all files.");
      state.includeOnly = null;
      state.includeOnlyActive = false;
    } else {
      const { set, invalid } = buildIncludeOnlySet(includeOnlyScan.entries);
      for (const bad of invalid) {
        const last = includeOnlyScan.occurrences[includeOnlyScan.occurrences.length - 1];
        pushWarning(state, mainFile, last ? last.line : 1, `Ignoring invalid \\includeonly entry "${truncateSnippet(bad, MAX_WARNING_SNIPPET)}".`);
      }
      state.includeOnly = set;
      state.includeOnlyActive = true;
    }
  }

  traverseFile(mainFile, new Set<string>(), 0, state);
  return { headings: state.headings, warnings: state.warnings, limited: state.limited };
}

function traverseFile(filePath: string, stack: Set<string>, depth: number, state: OutlineState): void {
  if (state.limited && state.headings.length >= PROJECT_OUTLINE_MAX_HEADINGS) return;
  if (stack.has(filePath)) {
    pushWarning(state, filePath, 1, `Skipping cyclic include of "${filePath}".`);
    return;
  }
  const raw: unknown = hasOwn(state.filesByPath, filePath) ? state.filesByPath[filePath] : undefined;
  if (typeof raw !== "string") return;
  const content = raw;
  if (!state.distinct.has(filePath) && state.distinct.size >= PROJECT_OUTLINE_MAX_FILES) {
    state.limited = true;
    pushWarning(state, filePath, 1, "Outline truncated: too many files.");
    return;
  }
  if (state.visits >= PROJECT_OUTLINE_MAX_VISITS) {
    state.limited = true;
    pushWarning(state, filePath, 1, "Outline truncated: too many includes.");
    return;
  }
  if (state.totalChars + content.length > PROJECT_OUTLINE_MAX_TOTAL_CHARS) {
    state.limited = true;
    pushWarning(state, filePath, 1, "Outline truncated: project too large.");
    return;
  }
  if (depth > PROJECT_OUTLINE_MAX_DEPTH) {
    state.limited = true;
    pushWarning(state, filePath, 1, "Outline truncated: include depth limit reached.");
    return;
  }

  state.distinct.add(filePath);
  state.visits += 1;
  state.totalChars += content.length;
  stack.add(filePath);

  let rangeStart = 0;
  let rangeEnd = content.length;
  if (filePath === state.mainFile) {
    const body = findDocumentBody(content);
    if (body) {
      rangeStart = body[0];
      rangeEnd = body[1];
    }
  }

  let line = lineAt(content, rangeStart);
  let i = rangeStart;
  const end = rangeEnd;
  let braceDepth = 0;

  const flushLineTo = (to: number): void => {
    if (to > i) line += countNewlines(content, i, to);
  };

  while (i < end) {
    if (state.headings.length >= PROJECT_OUTLINE_MAX_HEADINGS) {
      state.limited = true;
      pushWarning(state, filePath, line, "Outline truncated: too many headings.");
      break;
    }
    if (state.limited && state.headings.length >= PROJECT_OUTLINE_MAX_HEADINGS) break;
    const ch = content[i];
    if (ch === "{" && !isEscaped(content, i)) {
      braceDepth += 1;
      i += 1;
      continue;
    }
    if (ch === "}" && !isEscaped(content, i)) {
      if (braceDepth > 0) braceDepth -= 1;
      i += 1;
      continue;
    }
    if (ch === "%" && !isEscaped(content, i)) {
      while (i < end && content[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\\" && i + 1 < end && isLetter(content[i + 1])) {
      let j = i + 1;
      while (j < end && isLetter(content[j])) j += 1;
      const cmd = content.slice(i + 1, j);
      if (cmd === "begin") {
        const k = skipSpacesAndComments(content, j, end);
        if (k < end && content[k] === "{") {
          const close = findMatchingBrace(content, k, end);
          if (close === null) {
            i = j;
            continue;
          }
          const env = content.slice(k + 1, close).trim();
          if (VERBATIM_ENVS.has(env)) {
            const marker = `\\end{${env}}`;
            const idx = content.indexOf(marker, close + 1);
            if (idx === -1 || idx + marker.length > end) break;
            flushLineTo(idx + marker.length);
            i = idx + marker.length;
            continue;
          }
          flushLineTo(close + 1);
          i = close + 1;
          continue;
        }
        i = j;
        continue;
      }
      if (cmd === "end") {
        const k = skipSpacesAndComments(content, j, end);
        if (k < end && content[k] === "{") {
          const close = findMatchingBrace(content, k, end);
          if (close !== null) {
            flushLineTo(close + 1);
            i = close + 1;
            continue;
          }
        }
        i = j;
        continue;
      }
      if (cmd === "verb") {
        let k = j;
        if (k < end && content[k] === "*") k += 1;
        if (k >= end) {
          i = k;
          continue;
        }
        const delim = content[k]!;
        if (delim === "\n" || delim === "\r" || isLetter(delim)) {
          i = k;
          continue;
        }
        let m = k + 1;
        while (m < end && content[m] !== delim && content[m] !== "\n" && content[m] !== "\r") m += 1;
        if (m < end && content[m] === delim) i = m + 1;
        else i = m;
        continue;
      }
      if (HEADING_COMMANDS.has(cmd)) {
        if (braceDepth !== 0) {
          i = j;
          continue;
        }
        const parsed = tryParseHeading(content, i, j, cmd, end);
        if (parsed === null) {
          i = j;
          continue;
        }
        const id = `${filePath}@${parsed.from}#${state.headingSeq}`;
        state.headingSeq += 1;
        state.headings.push({
          id,
          path: filePath,
          line,
          from: parsed.from,
          to: parsed.to,
          level: parsed.level,
          title: parsed.title,
        });
        flushLineTo(parsed.to);
        i = parsed.to;
        continue;
      }
      if (cmd === "input" || cmd === "include") {
        if (braceDepth !== 0) {
          i = j;
          continue;
        }
        const kind = cmd === "input" ? "input" : "include";
        const parsed = tryParseInclude(content, i, j, kind, end);
        if (parsed === null) {
          i = j;
          continue;
        }
        const includeLine = line;
        flushLineTo(parsed.to);
        const nextI = parsed.to;
        const rawArg = parsed.rawArg;
        if (isDynamicIncludeArg(rawArg)) {
          pushWarning(state, filePath, includeLine, `Skipping dynamic \\${kind} argument.`);
          i = nextI;
          continue;
        }
        const resolved = resolveIncludeTarget(rawArg, filePath, state.filesByPath);
        if (!resolved.ok) {
          if (resolved.reason === "traversal") {
            pushWarning(state, filePath, includeLine, `Skipping unsafe \\${kind} path "${truncateSnippet(rawArg, MAX_WARNING_SNIPPET)}": outside project.`);
          } else {
            const tried = rawArg.endsWith(".tex") ? rawArg : `${rawArg} (+ .tex fallback)`;
            pushWarning(state, filePath, includeLine, `Missing \\${kind} file "${truncateSnippet(tried, MAX_WARNING_SNIPPET)}".`);
          }
          i = nextI;
          continue;
        }
        if (kind === "include" && state.includeOnlyActive && state.includeOnly !== null) {
          const target = resolved.path;
          const withoutTex = target.endsWith(".tex") ? target.slice(0, -4) : target;
          if (!state.includeOnly.has(target) && !state.includeOnly.has(withoutTex)) {
            i = nextI;
            continue;
          }
        }
        if (stack.has(resolved.path)) {
          pushWarning(state, filePath, includeLine, `Skipping cyclic \\${kind} of "${resolved.path}".`);
          i = nextI;
          continue;
        }
        if (state.visits >= PROJECT_OUTLINE_MAX_VISITS) {
          state.limited = true;
          pushWarning(state, filePath, includeLine, "Outline truncated: too many includes.");
          i = nextI;
          break;
        }
        i = nextI;
        traverseFile(resolved.path, stack, depth + 1, state);
        // Recompute line after recursion? `line` already advanced past the
        // include directive; recursion does not affect the current file's
        // line counter. Keep it as-is.
        if (state.headings.length >= PROJECT_OUTLINE_MAX_HEADINGS) {
          state.limited = true;
          pushWarning(state, filePath, line, "Outline truncated: too many headings.");
          break;
        }
        if (state.limited && state.visits >= PROJECT_OUTLINE_MAX_VISITS) break;
        continue;
      }
      if (cmd === "includeonly") {
        const k = skipSpacesAndComments(content, j, end);
        if (k < end && content[k] === "{") {
          const close = findMatchingBrace(content, k, end);
          if (close !== null) {
            flushLineTo(close + 1);
            i = close + 1;
            continue;
          }
        }
        i = j;
        continue;
      }
      if (DEFINING_COMMANDS.has(cmd)) {
        // Skip only the definition itself (name + optionals + one body)
        // so a following top-level \section/\input is never swallowed.
        let k = j;
        if (k < end && content[k] === "*") k += 1;
        k = skipSpacesAndComments(content, k, end);
        if (cmd === "def" || cmd === "edef" || cmd === "gdef" || cmd === "xdef") {
          // \def\cs<params>{replacement}: skip the control sequence, then
          // at most the next `{...}` on the same line as the replacement.
          // Parameter text (#1, delimiters) stays scannable but holds no
          // headings; never cross a newline to swallow the next section.
          if (k < end && content[k] === "\\") {
            if (k + 1 < end && isLetter(content[k + 1])) {
              let m = k + 1;
              while (m < end && isLetter(content[m])) m += 1;
              k = m;
            } else {
              k += 2;
            }
            let t = k;
            while (t < end && (content[t] === " " || content[t] === "\t" || content[t] === "\r")) t += 1;
            if (t < end && content[t] === "{") {
              const close = findMatchingBrace(content, t, end);
              if (close !== null) k = close + 1;
            } else {
              // Look only to end of line for the replacement body.
              let u = t;
              while (u < end && content[u] !== "\n" && content[u] !== "{") {
                if (content[u] === "%" && !isEscaped(content, u)) break;
                u += 1;
              }
              if (u < end && content[u] === "{") {
                const close = findMatchingBrace(content, u, end);
                if (close !== null) k = close + 1;
              } else {
                k = t;
              }
            }
          }
        } else {
          // \newcommand family: name, up to two optionals, one definition.
          if (k < end && content[k] === "{") {
            const close = findMatchingBrace(content, k, end);
            if (close !== null) k = close + 1;
          } else if (k < end && content[k] === "\\") {
            if (k + 1 < end && isLetter(content[k + 1])) {
              let m = k + 1;
              while (m < end && isLetter(content[m])) m += 1;
              k = m;
            } else {
              k += 2;
            }
          }
          for (let opt = 0; opt < 2; opt += 1) {
            const after = skipSpacesAndComments(content, k, end);
            if (after < end && content[after] === "[") {
              const close = findMatchingBracket(content, after, end);
              if (close === null) break;
              k = close + 1;
            } else {
              k = after;
              break;
            }
          }
          k = skipSpacesAndComments(content, k, end);
          if (k < end && content[k] === "{") {
            const close = findMatchingBrace(content, k, end);
            if (close !== null) k = close + 1;
          }
        }
        flushLineTo(k);
        i = k;
        continue;
      }
      i = j;
      continue;
    }
    if (ch === "\\") {
      i += 2;
      continue;
    }
    i += 1;
  }

  stack.delete(filePath);
}
