/**
 * Cross-file project search: pure, bounded, UI-safe helpers.
 *
 * The Zustand store (`workbenchStore`) delegates its search methods to this
 * module so the matching, glob filtering, binary exclusion, and replacement
 * logic stays unit-testable without React.
 *
 * Regex engine (RE2, linear time):
 * - Every user-supplied pattern (search queries AND include/exclude globs)
 *   executes on RE2JS, which guarantees linear-time matching in the input
 *   size. There is no backtracking, so catastrophic inputs such as
 *   `((a+)+)$` or `a+a+a+a+b` cannot hang the tab no matter the file size.
 * - The old static `isSafeRegex` heuristic is gone: RE2 makes it obsolete.
 *   What remains is the `MAX_PATTERN_LENGTH` cap and this documented RE2
 *   subset. Patterns outside the subset (backreferences like `\1`,
 *   lookahead/lookbehind like `(?=…)`/`(?<=…)`) fail at compile time with a
 *   clear "Invalid regular expression (RE2 syntax)" error. There is
 *   deliberately no JavaScript-RegExp fallback: falling back would re-open
 *   the ReDoS hole the engine switch closes.
 * - Native `RegExp` is used only for fixed implementation patterns (e.g.
 *   expanding `$1`/`$&` in replacement templates), never for user input.
 *
 * Bounding:
 * - Files larger than `maxFileBytes` are skipped, matches are capped per
 *   file (`DEFAULT_MAX_MATCHES_PER_FILE`) and in total (`maxResults`,
 *   clamped finite), and zero-length matches advance by a full code point
 *   so the scan always terminates.
 * - Truncation contract: hitting either cap sets `truncated: true`.
 *   Replace-all refuses truncated result sets (it would otherwise silently
 *   rewrite a prefix of the matches); single-target replacement stays
 *   allowed because it verifies one span directly without enumerating.
 */

import { RE2JS } from "re2js";

export type ProjectSearchOptions = {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  /** Comma-separated glob list, e.g. `"*.tex, chapters/**"`. */
  include?: string;
  /** Comma-separated glob list, e.g. `"figures/**, *.pdf"`. */
  exclude?: string;
  /** Legacy shorthand: only scan `.tex` files. Combined with globs. */
  texOnly?: boolean;
  /** Total match cap across all files (default 2000; clamped finite). */
  maxResults?: number;
  /** Per-file byte cap; larger files are skipped (default 1_000_000). */
  maxFileBytes?: number;
};

export type ProjectSearchMatch = {
  path: string;
  /** 1-based start line. */
  line: number;
  /** 1-based start column in UTF-16 code units (matches String#indexOf). */
  column: number;
  /** 1-based end line (== line for single-line matches). */
  endLine: number;
  /** 1-based exclusive end column in UTF-16 code units. */
  endColumn: number;
  /** UTF-16 length of the matched substring (may span lines). */
  length: number;
  /** Trimmed start-line preview for list display (back-compat field). */
  preview: string;
  /** Full start-line text (untrimmed) for exact highlight rendering. */
  lineText: string;
  /** Exact matched substring (may contain newlines for multiline). */
  matchText: string;
};

export type ProjectSearchGroups = Array<{
  path: string;
  matches: ProjectSearchMatch[];
}>;

export type ProjectSearchOutcome = {
  matches: ProjectSearchMatch[];
  groups: ProjectSearchGroups;
  totalMatches: number;
  fileCount: number;
  searchedFiles: number;
  skippedBinary: number;
  truncated: boolean;
};

export const MAX_PATTERN_LENGTH = 200;
export const DEFAULT_MAX_RESULTS = 2000;
export const DEFAULT_MAX_MATCHES_PER_FILE = 500;
export const DEFAULT_MAX_FILE_BYTES = 1_000_000;
/** Hard memory bound for caller-supplied `maxResults`. */
export const MAX_RESULTS_HARD_CAP = 50_000;

function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false;
  return ch === "_" || (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9");
}

/** Binary guard: data-URL uploads (images/PDF) and NUL bytes are never searched. */
export function isBinaryContent(content: string): boolean {
  if (content.startsWith("data:")) return true;
  return content.includes("\0");
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function clampMaxResults(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw)) return DEFAULT_MAX_RESULTS;
  const floored = Math.floor(raw);
  if (floored <= 0) return DEFAULT_MAX_RESULTS;
  return Math.min(floored, MAX_RESULTS_HARD_CAP);
}

/**
 * Compile a user pattern with RE2. Throws `Invalid regular expression (RE2
 * syntax): …` for over-long patterns and for syntax RE2 rejects
 * (backreferences, lookaround). No JavaScript-RegExp fallback.
 */
function compileSearchPattern(source: string, caseSensitive: boolean | undefined): RE2JS {
  if (source.length > MAX_PATTERN_LENGTH) {
    throw new Error(`Query too long (max ${MAX_PATTERN_LENGTH} chars).`);
  }
  const flags = (caseSensitive ? 0 : RE2JS.CASE_INSENSITIVE) | RE2JS.MULTILINE;
  try {
    return RE2JS.compile(source, flags);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid regular expression (RE2 syntax): ${detail}`);
  }
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseGlobList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * Minimal glob → RE2 source: `*` matches any run except `/`, `**` matches
 * anything including `/`, `?` matches one char except `/`. Everything else
 * is matched literally. Executed on RE2 (linear time), never on RegExp.
 */
export function globToRe2Source(glob: string): string {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      source += "[^/]";
      continue;
    }
    if ("\\.+^${}()|[]".includes(ch)) source += `\\${ch}`;
    else source += ch;
  }
  return source;
}

function compileGlobTester(raw: string | undefined): ((path: string) => boolean) | null {
  const parts = parseGlobList(raw);
  if (parts.length === 0) return null;
  let re: RE2JS;
  try {
    re = RE2JS.compile(`^(?:${parts.map(globToRe2Source).join("|")})$`, 0);
  } catch {
    throw new Error("Invalid glob pattern.");
  }
  return (path: string) => re.test(path);
}

export function matchesAnyGlob(path: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  const tester = compileGlobTester(patterns.join(","));
  return tester ? tester(path) : false;
}

export function isPathIncluded(
  path: string,
  include: string | undefined,
  exclude: string | undefined,
  texOnly: boolean | undefined,
): boolean {
  if (texOnly && !path.endsWith(".tex")) return false;
  const includeTester = compileGlobTester(include);
  const excludeTester = compileGlobTester(exclude);
  if (includeTester && !includeTester(path)) return false;
  if (excludeTester && excludeTester(path)) return false;
  return true;
}

/** Line-start offsets (0-based) for O(1) line slicing + binary-search mapping. */
function buildLineStarts(content: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineColAt(starts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo]! + 1 };
}

function lineTextAtStarts(content: string, starts: number[], line: number): string {
  const clamped = Math.max(1, Math.min(line, starts.length));
  const s = starts[clamped - 1]!;
  const next = clamped < starts.length ? starts[clamped]! : content.length + 1;
  return content.slice(s, next - 1);
}

export function offsetToLineCol(content: string, offset: number): { line: number; column: number } {
  const safe = Math.max(0, Math.min(offset, content.length));
  return lineColAt(buildLineStarts(content), safe);
}

/** Inverse of `offsetToLineCol` for exact match navigation/highlight. */
export function matchToOffset(content: string, line: number, column: number): number {
  const starts = buildLineStarts(content);
  const clampedLine = Math.max(1, Math.min(line, starts.length));
  const s = starts[clampedLine - 1]!;
  const next = clampedLine < starts.length ? starts[clampedLine]! : content.length + 1;
  const lineLen = next - s - 1;
  return s + Math.max(0, Math.min(column - 1, lineLen));
}

/** Advance one full code point (never splits a surrogate pair, always progresses). */
function advancePast(content: string, pos: number): number {
  if (pos >= content.length) return pos + 1;
  const cu = content.charCodeAt(pos);
  if (cu >= 0xd800 && cu <= 0xdbff && pos + 1 < content.length) {
    const lo = content.charCodeAt(pos + 1);
    if (lo >= 0xdc00 && lo <= 0xdfff) return pos + 2;
  }
  return pos + 1;
}

export function searchProjectFiles(
  filesByPath: Record<string, string>,
  query: string,
  options: ProjectSearchOptions = {},
): ProjectSearchOutcome {
  const needle = query;
  // The store trims before delegating; an empty/whitespace query yields no
  // results rather than matching every file.
  if (!needle.trim()) {
    return { matches: [], groups: [], totalMatches: 0, fileCount: 0, searchedFiles: 0, skippedBinary: 0, truncated: false };
  }
  const source = options.regex ? needle : escapeRegExp(needle);
  const pattern = compileSearchPattern(source, options.caseSensitive);
  const maxResults = clampMaxResults(options.maxResults);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const includeTester = compileGlobTester(options.include);
  const excludeTester = compileGlobTester(options.exclude);
  const matches: ProjectSearchMatch[] = [];
  let searchedFiles = 0;
  let skippedBinary = 0;
  let truncated = false;

  for (const [path, content] of Object.entries(filesByPath)) {
    if (matches.length >= maxResults) {
      truncated = true;
      break;
    }
    if (options.texOnly && !path.endsWith(".tex")) continue;
    if (includeTester && !includeTester(path)) continue;
    if (excludeTester && excludeTester(path)) continue;
    if (isBinaryContent(content)) {
      skippedBinary += 1;
      continue;
    }
    if (utf8ByteLength(content) > maxFileBytes) continue;
    searchedFiles += 1;
    const starts = buildLineStarts(content);
    const matcher = pattern.matcher(content);
    let pos = 0;
    let perFile = 0;
    for (;;) {
      if (matches.length >= maxResults || perFile >= DEFAULT_MAX_MATCHES_PER_FILE) {
        // Either cap truncates the listing: callers must surface this.
        truncated = true;
        break;
      }
      let found: boolean;
      try {
        found = matcher.find(pos);
      } catch {
        throw new Error("Search failed on this pattern.");
      }
      if (!found) break;
      const s = matcher.start();
      const e = matcher.end();
      if (e === s) {
        pos = advancePast(content, s);
        if (pos > content.length) break;
        continue;
      }
      if (options.wholeWord && (isWordChar(content[s - 1]) || isWordChar(content[e]))) {
        pos = e;
        continue;
      }
      const start = lineColAt(starts, s);
      const end = lineColAt(starts, e);
      const lineText = lineTextAtStarts(content, starts, start.line);
      const previewSource = lineText.trim();
      matches.push({
        path,
        line: start.line,
        column: start.column,
        endLine: end.line,
        endColumn: end.column,
        length: e - s,
        preview: previewSource.length > 200 ? `${previewSource.slice(0, 200)}…` : previewSource,
        lineText,
        matchText: content.slice(s, e),
      });
      perFile += 1;
      pos = e;
    }
  }

  const byPath = new Map<string, ProjectSearchMatch[]>();
  for (const match of matches) {
    const list = byPath.get(match.path);
    if (list) list.push(match);
    else byPath.set(match.path, [match]);
  }
  const groups: ProjectSearchGroups = [...byPath.entries()]
    .map(([path, groupMatches]) => ({ path, matches: groupMatches }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    matches,
    groups,
    totalMatches: matches.length,
    fileCount: groups.length,
    searchedFiles,
    skippedBinary,
    truncated,
  };
}

/**
 * Fixed-pattern `$` expansion (native RegExp on a constant pattern only):
 * `$$` → `$`, `$&` → whole match, `$n` → group n (`$10` is group 1 + "0"
 * when only 9 groups exist), `$``/`$'` → "". Matches String#replace
 * semantics for the supported subset so regex replacements keep working.
 */
function expandReplacement(template: string, match: string, groups: string[]): string {
  return template.replace(/\$(\$|&|`|'|\d{1,2})/g, (whole, token: string) => {
    if (token === "$") return "$";
    if (token === "&") return match;
    if (token === "`" || token === "'") return "";
    const n = Number(token);
    if (Number.isInteger(n) && n >= 1 && n <= groups.length) return groups[n - 1] ?? "";
    return whole;
  });
}

/** Collect RE2 capture groups for an exact-span verification match. */
function groupsOf(matcher: { groupCount(): number; group(n: number): string | null }): string[] {
  const groups: string[] = [];
  for (let i = 1; i <= matcher.groupCount(); i += 1) groups.push(matcher.group(i) ?? "");
  return groups;
}

/** Verify `content[offset:offset+length]` fully matches, returning groups. */
function verifySpan(
  pattern: RE2JS,
  content: string,
  offset: number,
  length: number,
  wholeWord: boolean | undefined,
): { matched: boolean; groups: string[] } {
  if (length <= 0 || offset < 0 || offset + length > content.length) return { matched: false, groups: [] };
  if (wholeWord && (isWordChar(content[offset - 1]) || isWordChar(content[offset + length]))) {
    return { matched: false, groups: [] };
  }
  const slice = content.slice(offset, offset + length);
  const probe = pattern.matcher(slice);
  let found = false;
  try {
    found = probe.find();
  } catch {
    return { matched: false, groups: [] };
  }
  if (!found || probe.start() !== 0 || probe.end() !== slice.length) return { matched: false, groups: [] };
  return { matched: true, groups: groupsOf(probe) };
}

export type ReplaceOutcome = {
  files: Record<string, string>;
  replacedMatches: number;
  replacedFiles: number;
};

export function applyReplaceToFiles(
  filesByPath: Record<string, string>,
  query: string,
  replaceText: string,
  options: ProjectSearchOptions & {
    target?: { path: string; line: number; column: number };
  } = {},
): ReplaceOutcome {
  const unchanged = { files: { ...filesByPath }, replacedMatches: 0, replacedFiles: 0 };
  if (!query.trim()) return unchanged;
  const source = options.regex ? query : escapeRegExp(query);
  const pattern = compileSearchPattern(source, options.caseSensitive);

  if (options.target) {
    // Single-target verification needs no enumeration, so per-file/global
    // truncation never blocks it: one RE2 span check at the recorded offset.
    const { path, line, column } = options.target;
    const content = filesByPath[path];
    if (content === undefined) return unchanged;
    if (!isPathIncluded(path, options.include, options.exclude, options.texOnly)) return unchanged;
    if (isBinaryContent(content)) return unchanged;
    if (utf8ByteLength(content) > (options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES)) return unchanged;
    const offset = matchToOffset(content, line, column);
    // The span length is unknown without searching: find the match that
    // starts exactly here.
    const probe = pattern.matcher(content);
    let found = false;
    try {
      found = probe.find(offset);
    } catch {
      return unchanged;
    }
    if (!found || probe.start() !== offset) return unchanged;
    const length = probe.end() - offset;
    const check = verifySpan(pattern, content, offset, length, options.wholeWord);
    if (!check.matched) return unchanged;
    const insert = options.regex ? expandReplacement(replaceText, probe.group(0) ?? "", check.groups) : replaceText;
    const next = content.slice(0, offset) + insert + content.slice(offset + length);
    if (next === content) return unchanged;
    return { files: { ...filesByPath, [path]: next }, replacedMatches: 1, replacedFiles: 1 };
  }

  const outcome = searchProjectFiles(filesByPath, query, {
    ...options,
    maxResults: options.maxResults,
  });
  // A truncated listing is a prefix of the true matches: applying it would
  // silently rewrite only part of the project, so refuse outright.
  if (outcome.truncated) {
    throw new Error("Too many matches; refine the query before replacing.");
  }
  if (outcome.matches.length === 0) return unchanged;

  // Group offsets per file and splice back-to-front so earlier offsets stay
  // valid. One atomic files object out: the store commits it in a single
  // set() so local autosave sees exactly one source revision (undo/checkpoint
  // safe) instead of per-file writes.
  const byFile = new Map<string, ProjectSearchMatch[]>();
  for (const m of outcome.matches) {
    const list = byFile.get(m.path);
    if (list) list.push(m);
    else byFile.set(m.path, [m]);
  }
  const nextFiles = { ...filesByPath };
  let replacedMatches = 0;
  for (const [path, list] of byFile) {
    const content = filesByPath[path] ?? "";
    const starts = buildLineStarts(content);
    type Edit = { offset: number; length: number; insert: string };
    const edits: Edit[] = [];
    for (const m of list) {
      const s = starts[m.line - 1];
      if (s === undefined) continue;
      const offset = s + (m.column - 1);
      if (offset < 0 || offset + m.length > content.length) continue;
      if (content.slice(offset, offset + m.length) !== m.matchText) continue;
      const check = verifySpan(pattern, content, offset, m.length, options.wholeWord);
      if (!check.matched) continue;
      const insert = options.regex ? expandReplacement(replaceText, m.matchText, check.groups) : replaceText;
      edits.push({ offset, length: m.length, insert });
    }
    if (edits.length === 0) continue;
    edits.sort((a, b) => b.offset - a.offset);
    let next = content;
    for (const edit of edits) {
      next = next.slice(0, edit.offset) + edit.insert + next.slice(edit.offset + edit.length);
    }
    if (next !== content) {
      nextFiles[path] = next;
      replacedMatches += edits.length;
    }
  }
  return {
    files: nextFiles,
    replacedMatches,
    replacedFiles: Object.keys(byFile).filter((p) => nextFiles[p] !== filesByPath[p]).length,
  };
}

export type ReplacePreviewEntry = {
  path: string;
  line: number;
  column: number;
  before: string;
  after: string;
};

export function buildReplacePreview(
  filesByPath: Record<string, string>,
  query: string,
  replaceText: string,
  options: ProjectSearchOptions = {},
  limit = 8,
): { totalMatches: number; fileCount: number; samples: ReplacePreviewEntry[]; truncated: boolean } {
  const outcome = searchProjectFiles(filesByPath, query, options);
  const source = options.regex ? query : escapeRegExp(query);
  let pattern: RE2JS | null = null;
  try {
    pattern = compileSearchPattern(source, options.caseSensitive);
  } catch {
    pattern = null;
  }
  const samples = outcome.matches.slice(0, limit).map((m) => {
    let after: string;
    if (options.regex && pattern) {
      const probe = pattern.matcher(m.matchText);
      let ok = false;
      let groups: string[] = [];
      try {
        ok = probe.find() && probe.start() === 0 && probe.end() === m.matchText.length;
        if (ok) groups = groupsOf(probe);
      } catch {
        ok = false;
      }
      after = ok ? expandReplacement(replaceText, m.matchText, groups) : replaceText;
    } else after = replaceText;
    const before = m.lineText.trim().length > 160 ? `${m.lineText.trim().slice(0, 160)}…` : m.lineText.trim();
    // Splice at the exact recorded offset: String#replace would rewrite the
    // FIRST occurrence on the line, which is wrong for the 2nd+ match.
    // slice() clamps, so multiline spans (length past end of line) are safe.
    const start = m.column - 1;
    const rendered = m.lineText.slice(0, start) + after + m.lineText.slice(start + m.length);
    const afterTrim = rendered.trim().length > 160 ? `${rendered.trim().slice(0, 160)}…` : rendered.trim();
    return { path: m.path, line: m.line, column: m.column, before, after: afterTrim };
  });
  return { totalMatches: outcome.totalMatches, fileCount: outcome.fileCount, samples, truncated: outcome.truncated };
}
