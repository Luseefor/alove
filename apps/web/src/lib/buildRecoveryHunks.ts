import { normalizeCompilePath } from "@alove/protocol";
import type { FileChange } from "./buildRecoveryCandidates";

export type FocusedRecoveryCandidate = FileChange & {
  scope: "hunk";
  hunk: {
    /** UTF-16 offset in the failed source where the failed fragment starts. */
    from: number;
    /** UTF-16 offset in the failed source where the failed fragment ends (exclusive). */
    to: number;
    /** Exact fragment from the good source that repairs this block. */
    before: string;
    /** Exact fragment from the failed source covered by [from, to). */
    after: string;
    /** 1-based first failed line covered by this block. */
    fromLine: number;
    /** 1-based last failed line covered by this block; equals fromLine for pure insertions. */
    toLine: number;
  };
};

const MAX_CHARS_PER_SIDE = 1_048_576;
const MAX_LINES_PER_SIDE = 10_000;
const MAX_LCS_CELLS = 250_000;
const MAX_RESIDUAL_LINES = 2_000;
const DEFAULT_MAX_CANDIDATES = 3;
const HARD_MAX_CANDIDATES = 8;

function isBinaryContent(content: string): boolean {
  return content.startsWith("data:") || content.includes("\0");
}

/** 0-based UTF-16 offsets where each "\n"-separated line starts. Length equals split("\n").length. */
function buildLineStarts(content: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

/** True when "\n"-separated lines exceed the cap. Bounded scan stops at the cap; never splits. */
function exceedsLineLimit(content: string): boolean {
  let newlines = 0;
  for (let i = 0; i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) {
      newlines += 1;
      if (newlines >= MAX_LINES_PER_SIDE) return true;
    }
  }
  return false;
}

function hunkDistance(fromLine: number, toLine: number, diagnosticLine: number): number {
  if (diagnosticLine >= fromLine && diagnosticLine <= toLine) return 0;
  const a = Math.abs(fromLine - diagnosticLine);
  const b = Math.abs(toLine - diagnosticLine);
  return a < b ? a : b;
}

type Block = { goodS: number; goodE: number; failedS: number; failedE: number };

/**
 * Split one modified file into separated change blocks without claiming a
 * minimal edit script. Common line prefix/suffix is trimmed, then a bounded
 * LCS over the residual middle groups adjacent insert/delete operations;
 * only exact unchanged lines separate blocks. Line comparison is exact
 * (including "\r"), and all fragments are exact slices, so CRLF, Unicode
 * (UTF-16), blank lines, and trailing newlines round-trip.
 *
 * Top-level `before` is the full repaired file (failed source with exactly
 * one block reverted to good); top-level `after` is the full failed source.
 * A single block always repairs to the whole good file, so it is skipped
 * early without materializing any repair (whole-file fallback covers it).
 * For many blocks, metadata is ranked and capped BEFORE any full repaired
 * string is built, so at most `cap` (hard max 8) full-size repairs exist.
 */
export function createFocusedRecoveryCandidates(
  change: FileChange,
  options?: { maxCandidates?: number; diagnosticLine?: number },
): { candidates: FocusedRecoveryCandidate[]; limited: boolean } {
  if (normalizeCompilePath(change.path) !== change.path) {
    throw new Error(`unsafe file path: ${change.path}`);
  }
  const good = change.before;
  const failed = change.after;
  if (change.kind !== "modified" || good === null || failed === null) {
    return { candidates: [], limited: false };
  }
  if (isBinaryContent(good) || isBinaryContent(failed)) {
    return { candidates: [], limited: false };
  }
  if (good.length > MAX_CHARS_PER_SIDE || failed.length > MAX_CHARS_PER_SIDE) {
    return { candidates: [], limited: true };
  }
  if (exceedsLineLimit(good) || exceedsLineLimit(failed)) {
    return { candidates: [], limited: true };
  }

  const goodLines = good.split("\n");
  const failedLines = failed.split("\n");
  if (good === failed) {
    return { candidates: [], limited: false };
  }

  let prefix = 0;
  const minLen = Math.min(goodLines.length, failedLines.length);
  while (prefix < minLen && goodLines[prefix] === failedLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < goodLines.length - prefix &&
    suffix < failedLines.length - prefix &&
    goodLines[goodLines.length - 1 - suffix] === failedLines[failedLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const goodMid = goodLines.slice(prefix, goodLines.length - suffix);
  const failedMid = failedLines.slice(prefix, failedLines.length - suffix);
  if (goodMid.length === 0 && failedMid.length === 0) {
    return { candidates: [], limited: false };
  }

  const blocks: Block[] = [];
  if (goodMid.length === 0 || failedMid.length === 0) {
    // Single contiguous insertion/deletion between common prefix/suffix.
    // Reverting it always yields the good file, so it is a whole-file duplicate.
    return { candidates: [], limited: false };
  }

  if (
    goodMid.length > MAX_RESIDUAL_LINES ||
    failedMid.length > MAX_RESIDUAL_LINES ||
    goodMid.length * failedMid.length > MAX_LCS_CELLS
  ) {
    return { candidates: [], limited: true };
  }

  const m = goodMid.length;
  const n = failedMid.length;
  const stride = n + 1;
  const dp = new Int32Array((m + 1) * stride);
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (goodMid[i] === failedMid[j]) {
        dp[i * stride + j] = dp[(i + 1) * stride + (j + 1)] + 1;
      } else {
        const del = dp[(i + 1) * stride + j];
        const ins = dp[i * stride + (j + 1)];
        dp[i * stride + j] = del >= ins ? del : ins;
      }
    }
  }

  let i = 0;
  let j = 0;
  let cur: Block | null = null;
  const pushCur = () => {
    if (cur !== null) {
      blocks.push(cur);
      cur = null;
    }
  };
  while (i < m && j < n) {
    if (goodMid[i] === failedMid[j]) {
      pushCur();
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * stride + j] >= dp[i * stride + (j + 1)]) {
      if (cur === null) {
        cur = { goodS: prefix + i, goodE: prefix + i + 1, failedS: prefix + j, failedE: prefix + j };
      } else {
        cur.goodE += 1;
      }
      i += 1;
    } else {
      if (cur === null) {
        cur = { goodS: prefix + i, goodE: prefix + i, failedS: prefix + j, failedE: prefix + j + 1 };
      } else {
        cur.failedE += 1;
      }
      j += 1;
    }
  }
  while (i < m) {
    if (cur === null) {
      cur = { goodS: prefix + i, goodE: prefix + i + 1, failedS: prefix + j, failedE: prefix + j };
    } else {
      cur.goodE += 1;
    }
    i += 1;
  }
  while (j < n) {
    if (cur === null) {
      cur = { goodS: prefix + i, goodE: prefix + i, failedS: prefix + j, failedE: prefix + j + 1 };
    } else {
      cur.failedE += 1;
    }
    j += 1;
  }
  pushCur();

  if (blocks.length === 0) {
    return { candidates: [], limited: false };
  }
  if (blocks.length === 1) {
    // The lone block spans the entire prefix/suffix residual, so reverting it
    // yields the whole good file. Skip it without building any repair string;
    // the whole-file fallback already covers this case.
    return { candidates: [], limited: false };
  }

  const goodStarts = buildLineStarts(good);
  const failedStarts = buildLineStarts(failed);
  const offsetOf = (starts: number[], full: string, line: number): number =>
    line >= starts.length ? full.length : starts[line];

  type RankedBlock = { b: Block; from: number; to: number; fromLine: number; toLine: number };
  const meta: RankedBlock[] = blocks.map((b) => {
    const fromLine = b.failedS + 1;
    return {
      b,
      from: offsetOf(failedStarts, failed, b.failedS),
      to: offsetOf(failedStarts, failed, b.failedE),
      fromLine,
      toLine: b.failedE > b.failedS ? b.failedE : fromLine,
    };
  });

  let cap = DEFAULT_MAX_CANDIDATES;
  if (options?.maxCandidates !== undefined) {
    const floored = Math.floor(options.maxCandidates);
    if (Number.isFinite(floored)) {
      cap = Math.max(0, Math.min(HARD_MAX_CANDIDATES, floored));
    }
  }

  const diagnosticLine = options?.diagnosticLine;
  const ranked = [...meta];
  if (typeof diagnosticLine === "number" && Number.isFinite(diagnosticLine)) {
    ranked.sort((a, b) => {
      const da = hunkDistance(a.fromLine, a.toLine, diagnosticLine);
      const db = hunkDistance(b.fromLine, b.toLine, diagnosticLine);
      if (da !== db) return da - db;
      if (a.fromLine !== b.fromLine) return a.fromLine - b.fromLine;
      if (a.toLine !== b.toLine) return a.toLine - b.toLine;
      return a.from - b.from;
    });
  } else {
    ranked.sort((a, b) => {
      if (a.fromLine !== b.fromLine) return a.fromLine - b.fromLine;
      return a.from - b.from;
    });
  }

  const limited = ranked.length > cap;
  const selected = ranked.slice(0, cap);
  if (selected.length === 0) {
    return { candidates: [], limited };
  }

  // Materialize full repaired strings only for the capped selection, so at
  // most `cap` (hard max 8) full-size docs are ever built.
  const candidates: FocusedRecoveryCandidate[] = [];
  for (const s of selected) {
    const goodFrom: number = offsetOf(goodStarts, good, s.b.goodS);
    const goodTo: number = offsetOf(goodStarts, good, s.b.goodE);
    const beforeFrag: string = good.slice(goodFrom, goodTo);
    const afterFrag: string = failed.slice(s.from, s.to);
    const repaired: string = failed.slice(0, s.from) + beforeFrag + failed.slice(s.to);
    if (repaired === good) continue;
    candidates.push({
      path: change.path,
      kind: "modified",
      before: repaired,
      after: failed,
      firstChangedLine: s.fromLine,
      scope: "hunk",
      hunk: { from: s.from, to: s.to, before: beforeFrag, after: afterFrag, fromLine: s.fromLine, toLine: s.toLine },
    });
  }

  if (candidates.length === 0) {
    return { candidates: [], limited: false };
  }
  return { candidates, limited };
}
