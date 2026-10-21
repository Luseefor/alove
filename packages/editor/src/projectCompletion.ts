import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";

export type ProjectCiteEntry = {
  key: string;
  type?: string;
  title?: string;
  author?: string;
  year?: string;
};

export type ProjectLabelEntry = {
  label: string;
  file?: string;
  context?: string;
};

export type ProjectLanguageIndex = {
  cites: ProjectCiteEntry[];
  labels: ProjectLabelEntry[];
};

export const CITE_COMMANDS = [
  "cite",
  "citep",
  "citet",
  "citealt",
  "citeauthor",
  "citeyear",
  "citeyearpar",
  "parencite",
  "textcite",
  "footcite",
  "footcitetext",
  "autocite",
  "smartcite",
  "Cite",
  "Citet",
  "Citep",
  "Parencite",
  "Textcite",
  "Autocite",
  "nocite",
] as const;

export const REF_COMMANDS = [
  "ref",
  "eqref",
  "pageref",
  "autoref",
  "cref",
  "Cref",
  "nameref",
  "labelcref",
  "cpageref",
] as const;

const CITE_PATTERN =
  "(?:cite[a-zA-Z]*\\*?|Cite[a-zA-Z]*\\*?|parencite\\*?|textcite\\*?|autocite\\*?|smartcite\\*?|footcite[a-z]*\\*?|nocite\\*?)";
const REF_PATTERN =
  "(?:ref|eqref|pageref|autoref|cref|Cref|nameref|labelcref|cpageref)\\*?";

/** True when the character at `index` is escaped by an odd run of backslashes. */
export function isEscapedAt(text: string, index: number): boolean {
  let run = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) {
    run += 1;
  }
  return run % 2 === 1;
}

/** Strip the `%` comment tail of a single line (respects `\\%`). */
export function stripLineComment(line: string): string {
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "%" && !isEscapedAt(line, i)) {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Column offset where the `%` comment starts, or -1 when there is none. */
export function commentStart(line: string): number {
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "%" && !isEscapedAt(line, i)) return i;
  }
  return -1;
}

function blankMatch(match: string): string {
  return match.replace(/[^\n]/g, " ");
}

const VERBATIM_BLOCK =
  /\\begin\s*\{(verbatim|Verbatim|lstlisting|minted|comment)\}[\s\S]*?\\end\s*\{\1\}/g;

function stripVerbatimBlocks(text: string): string {
  return text.replace(VERBATIM_BLOCK, blankMatch);
}

function lineStartOffset(text: string, index: number): number {
  return text.lastIndexOf("\n", index - 1) + 1;
}

function isInComment(text: string, matchIndex: number): boolean {
  const lineStart = lineStartOffset(text, matchIndex);
  const lineEnd = text.indexOf("\n", matchIndex);
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
  const col = commentStart(line);
  if (col === -1) return false;
  return matchIndex - lineStart >= col;
}

/**
 * Parse `.bib` entries with brace-depth scanning so multi-line values and
 * several entries per file resolve. Field extraction tolerates
 * `{...}` (nested), `"..."`, and bare values.
 */
export function parseBibEntries(bibText: string): ProjectCiteEntry[] {
  const entries: ProjectCiteEntry[] = [];
  if (!bibText) return entries;
  const header = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = header.exec(bibText)) !== null) {
    const type = (m[1] ?? "").trim();
    const key = (m[2] ?? "").trim();
    if (!key) continue;
    // Body runs until the entry's closing brace at depth 0.
    let depth = 1;
    let i = header.lastIndex;
    for (; i < bibText.length; i += 1) {
      const ch = bibText[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = bibText.slice(header.lastIndex, i);
    entries.push({
      key,
      type,
      title: extractBibField(body, "title"),
      author: extractBibField(body, "author"),
      year: extractBibField(body, "year"),
    });
    if (i < bibText.length) header.lastIndex = i + 1;
  }
  return entries;
}

function extractBibField(body: string, name: string): string | undefined {
  const re = new RegExp(`${name}\\s*=\\s*`, "i");
  const m = re.exec(body);
  if (!m || m.index === undefined) return undefined;
  let i = m.index + m[0].length;
  while (i < body.length && /\s/.test(body[i]!)) i += 1;
  if (i >= body.length) return undefined;
  const open = body[i];
  if (open === "{") {
    let depth = 0;
    const start = i + 1;
    for (let j = i; j < body.length; j += 1) {
      if (body[j] === "{") depth += 1;
      else if (body[j] === "}") {
        depth -= 1;
        if (depth === 0) {
          return body.slice(start, j).replace(/\s+/g, " ").trim() || undefined;
        }
      }
    }
    return undefined;
  }
  if (open === '"') {
    const end = body.indexOf('"', i + 1);
    if (end === -1) return undefined;
    return body.slice(i + 1, end).replace(/\s+/g, " ").trim() || undefined;
  }
  const rest = body.slice(i).match(/^([^\s,}]+)/);
  const value = rest?.[1]?.replace(/},?\s*$/, "").trim();
  return value || undefined;
}

const LABEL_RE = /\\label\s*\{([^}]*)\}/g;
const SECTION_RE =
  /\\(part|chapter|section|subsection|subsubsection|paragraph|caption)\*?(?:\[[^\]]*\])?\{([^}]*)\}/;
const ENV_RE = /\\begin\s*\{([^}]*)\}/;

function extractLabelContext(
  fullText: string,
  matchIndex: number,
  label: string,
): string | undefined {
  const lookBehind = fullText.slice(Math.max(0, matchIndex - 1200), matchIndex);
  const sections = [...lookBehind.matchAll(new RegExp(SECTION_RE, "g"))];
  const lastSection = sections.at(-1);
  if (lastSection) {
    const title = (lastSection[2] ?? "").replace(/\s+/g, " ").trim();
    if (title) return title.slice(0, 120);
  }
  const envs = [...lookBehind.matchAll(new RegExp(ENV_RE, "g"))];
  const lastEnv = envs.at(-1)?.[1]?.trim();
  // Fall back to the label's own line with commands stripped.
  const lineStart = lineStartOffset(fullText, matchIndex);
  const lineEnd = fullText.indexOf("\n", matchIndex);
  const line = fullText
    .slice(lineStart, lineEnd === -1 ? fullText.length : lineEnd)
    .replace(/\\[a-zA-Z]+\*?/g, " ")
    .replace(/[{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const pruned = line.replace(label, "").replace(/\s+/g, " ").trim();
  if (pruned) {
    const prefix = lastEnv ? `[${lastEnv}] ` : "";
    return `${prefix}${pruned}`.slice(0, 120);
  }
  if (lastEnv) return `[${lastEnv}]`;
  return undefined;
}

/** Collect `\label{...}` keys, skipping escaped and `%`-commented commands. */
export function parseTexLabels(
  texText: string,
  file?: string,
): ProjectLabelEntry[] {
  const labels: ProjectLabelEntry[] = [];
  if (!texText) return labels;
  const clean = stripVerbatimBlocks(texText);
  LABEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(clean)) !== null) {
    const matchIndex = m.index;
    if (isEscapedAt(clean, matchIndex)) continue;
    if (isInComment(clean, matchIndex)) continue;
    const label = (m[1] ?? "").trim();
    if (!label || label.includes(" ") || label.includes("\\")) continue;
    if (labels.some((l) => l.label === label && l.file === file)) continue;
    labels.push({
      label,
      file,
      context: extractLabelContext(clean, matchIndex, label),
    });
  }
  return labels;
}

export type CiteCompletionContext = {
  command: string;
  /** Current key fragment after the last comma (may be empty). */
  fragment: string;
  /** Offset where the current fragment starts. */
  from: number;
};

export type RefCompletionContext = {
  command: string;
  fragment: string;
  from: number;
};

function matchCommandAt(
  before: string,
  baseOffset: number,
  pattern: string,
): { command: string; braceIndex: number } | null {
  const re = new RegExp(`\\\\(${pattern})\\s*(\\[[^\\]]*\\]\\s*)*\\{([^}]*)$`);
  const m = re.exec(before);
  if (!m || m.index === undefined) return null;
  const absIndex = baseOffset + m.index;
  return { command: m[1]!, braceIndex: absIndex };
}

/**
 * When `pos` sits inside `\citeVariant[...]{k1,k2|}` return the active key
 * fragment. Handles cite variants, optional args, and comma-separated keys.
 * Returns null for escaped or `%`-commented commands.
 */
export function findCiteCompletion(
  docText: string,
  pos: number,
): CiteCompletionContext | null {
  const start = Math.max(0, pos - 600);
  const before = docText.slice(start, pos);
  const hit = matchCommandAt(before, start, CITE_PATTERN);
  if (!hit) return null;
  if (isEscapedAt(docText, hit.braceIndex)) return null;
  if (isInComment(docText, hit.braceIndex)) return null;
  const brace = docText.indexOf("{", hit.braceIndex);
  if (brace === -1 || brace >= pos) return null;
  const inner = docText.slice(brace + 1, pos);
  if (inner.includes("}")) return null;
  const lastComma = inner.lastIndexOf(",");
  const fragment = inner.slice(lastComma + 1).trimStart();
  const leadingSpaces = inner.slice(lastComma + 1).length - fragment.length;
  return {
    command: hit.command,
    fragment,
    from: brace + 1 + lastComma + 1 + leadingSpaces,
  };
}

/** Same as cite completion for `\ref`/`\eqref`/`\cref`/… variants. */
export function findRefCompletion(
  docText: string,
  pos: number,
): RefCompletionContext | null {
  const start = Math.max(0, pos - 600);
  const before = docText.slice(start, pos);
  const hit = matchCommandAt(before, start, REF_PATTERN);
  if (!hit) return null;
  if (isEscapedAt(docText, hit.braceIndex)) return null;
  if (isInComment(docText, hit.braceIndex)) return null;
  const brace = docText.indexOf("{", hit.braceIndex);
  if (brace === -1 || brace >= pos) return null;
  const inner = docText.slice(brace + 1, pos);
  if (inner.includes("}")) return null;
  const fragment = inner.trimStart();
  return {
    command: hit.command,
    fragment,
    from: brace + 1 + (inner.length - fragment.length),
  };
}

export function formatCiteDetail(entry: ProjectCiteEntry): string | undefined {
  const parts: string[] = [];
  if (entry.author) parts.push(entry.author);
  if (entry.year) parts.push(`(${entry.year})`);
  const head = parts.join(" ").trim();
  const tail = entry.title ?? entry.type ?? "";
  if (head && tail) return `${head} — ${tail}`.slice(0, 140);
  return (head || tail || undefined)?.slice(0, 140);
}

function matchesFilter(haystack: string, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return haystack.toLowerCase().includes(q);
}

/** Cite options filtered by the in-progress key fragment. */
export function buildCiteCompletions(
  entries: ProjectCiteEntry[],
  fragment: string,
): Completion[] {
  const seen = new Set<string>();
  const out: Completion[] = [];
  for (const entry of entries) {
    if (!entry.key || seen.has(entry.key)) continue;
    seen.add(entry.key);
    const hay = [entry.key, entry.title, entry.author, entry.year]
      .filter(Boolean)
      .join(" ");
    if (!matchesFilter(hay, fragment)) continue;
    out.push({
      label: entry.key,
      detail: formatCiteDetail(entry),
      info: entry.title,
      type: "reference",
      apply: entry.key,
    });
  }
  out.sort((a, b) => String(a.label).localeCompare(String(b.label)));
  return out;
}

/** Ref options filtered by the in-progress label fragment. */
export function buildRefCompletions(
  entries: ProjectLabelEntry[],
  fragment: string,
): Completion[] {
  const seen = new Set<string>();
  const out: Completion[] = [];
  for (const entry of entries) {
    if (!entry.label || seen.has(entry.label)) continue;
    seen.add(entry.label);
    const hay = [entry.label, entry.context, entry.file]
      .filter(Boolean)
      .join(" ");
    if (!matchesFilter(hay, fragment)) continue;
    const detail = [entry.context, entry.file].filter(Boolean).join(" · ");
    out.push({
      label: entry.label,
      detail: detail ? detail.slice(0, 140) : undefined,
      type: "reference",
      apply: entry.label,
    });
  }
  out.sort((a, b) => String(a.label).localeCompare(String(b.label)));
  return out;
}

/**
 * CodeMirror completion source for project-wide cite/ref keys. Returns null
 * outside cite/ref braces so snippet sources can handle other contexts.
 */
export function createProjectCompletionSource(getIndex: () => ProjectLanguageIndex) {
  return function projectCompletionSource(
    ctx: CompletionContext,
  ): CompletionResult | null {
    if (ctx.pos < 0) return null;
    const docText = ctx.state.doc.toString();
    const cite = findCiteCompletion(docText, ctx.pos);
    if (cite) {
      const options = buildCiteCompletions(getIndex().cites, cite.fragment);
      return {
        from: cite.from,
        options,
        filter: false,
        validFor: /^[\w:.\-]*$/,
      };
    }
    const ref = findRefCompletion(docText, ctx.pos);
    if (ref) {
      const options = buildRefCompletions(getIndex().labels, ref.fragment);
      return {
        from: ref.from,
        options,
        filter: false,
        validFor: /^[\w:.\-]*$/,
      };
    }
    return null;
  };
}
