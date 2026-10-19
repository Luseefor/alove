import { normalizeCompilePath } from "@alove/protocol";

export type FileChange = {
  path: string;
  kind: "added" | "removed" | "modified";
  /** Content in the last good build, or null when the file was absent there. Empty string is valid content. */
  before: string | null;
  /** Content in the failed build, or null when the file is absent there. Empty string is valid content. */
  after: string | null;
  /** 1-based line number of the first differing line; 1 when a side is absent. */
  firstChangedLine: number;
};

export type ChangePreviewLine = {
  kind: "removed" | "added";
  /** Original line number for removed lines, new-file line number for added lines. */
  line: number;
  text: string;
};

function splitLines(text: string): string[] {
  return text.split("\n");
}

function firstChangedLineOf(before: string, after: string): number {
  const a = splitLines(before);
  const b = splitLines(after);
  const common = Math.min(a.length, b.length);
  for (let i = 0; i < common; i++) {
    if (a[i] !== b[i]) return i + 1;
  }
  return common + 1;
}

/**
 * Diff two build file maps (last good vs failed). Returns one entry per path
 * whose presence or content differs, sorted by path for determinism.
 * Only own keys are considered; null means absent, empty string is content.
 */
export function compareBuildFiles(
  good: Record<string, string>,
  failed: Record<string, string>,
): FileChange[] {
  const paths = [...new Set([...Object.keys(good), ...Object.keys(failed)])].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const out: FileChange[] = [];
  for (const path of paths) {
    const inGood = Object.hasOwn(good, path);
    const inFailed = Object.hasOwn(failed, path);
    if (inGood && inFailed) {
      const before = good[path];
      const after = failed[path];
      if (before === after) continue;
      out.push({ path, kind: "modified", before, after, firstChangedLine: firstChangedLineOf(before, after) });
    } else if (inFailed) {
      out.push({ path, kind: "added", before: null, after: failed[path], firstChangedLine: 1 });
    } else {
      out.push({ path, kind: "removed", before: good[path], after: null, firstChangedLine: 1 });
    }
  }
  return out;
}

/**
 * Apply one change in reverse: put `before` content back, or delete the file
 * when `before` is null. Returns a fresh map; inputs are never mutated.
 * Throws on paths rejected by normalizeCompilePath.
 */
export function restoreCandidateFile(
  files: Record<string, string>,
  change: FileChange,
): Record<string, string> {
  if (normalizeCompilePath(change.path) !== change.path) {
    throw new Error(`unsafe file path: ${change.path}`);
  }
  const next: Record<string, string> = { ...files };
  if (change.before === null) {
    delete next[change.path];
  } else {
    next[change.path] = change.before;
  }
  return next;
}

const SOURCE_EXTENSIONS = new Set(["tex", "sty", "cls", "bib"]);

function extensionOf(path: string): string | null {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Order restore candidates: files named by diagnostics first, then LaTeX
 * sources (tex/sty/cls/bib), then everything else; ties break by path.
 * Returns a new array. No result cap here; callers slice for display.
 */
export function recoveryCandidateOrder(
  changes: FileChange[],
  diagnosticFiles: string[],
): FileChange[] {
  const diagnostic = new Set(diagnosticFiles);
  const rankOf = (change: FileChange): number => {
    if (diagnostic.has(change.path)) return 0;
    const ext = extensionOf(change.path);
    if (ext !== null && SOURCE_EXTENSIONS.has(ext)) return 1;
    return 2;
  };
  return [...changes].sort((a, b) => {
    const rank = rankOf(a) - rankOf(b);
    if (rank !== 0) return rank;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

/**
 * Render a change as removed lines followed by added lines, trimming only the
 * common line prefix and suffix. This is a simple prefix/suffix hunk, not a
 * minimal diff. Output is capped at maxLines (default 80) to bound DOM size.
 */
export function previewFileChange(change: FileChange, maxLines = 80): ChangePreviewLine[] {
  const cap = Math.max(0, Math.floor(maxLines));
  if (cap === 0) return [];
  const before = change.before === null ? null : splitLines(change.before);
  const after = change.after === null ? null : splitLines(change.after);

  let prefix = 0;
  let suffix = 0;
  if (before && after) {
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
    while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  }
  const out: ChangePreviewLine[] = [];
  for (const [kind, lines] of [["removed", before], ["added", after]] as const) {
    if (!lines) continue;
    for (let i = prefix; i < lines.length - suffix && out.length < cap; i++) {
      out.push({ kind, line: i + 1, text: lines[i] });
    }
  }
  return out;
}
