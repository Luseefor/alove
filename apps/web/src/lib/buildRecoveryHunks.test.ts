import { describe, expect, it } from "vitest";
import {
  createFocusedRecoveryCandidates,
  type FocusedRecoveryCandidate,
} from "./buildRecoveryHunks";
import type { FileChange } from "./buildRecoveryCandidates";

const change = (before: string, after: string, path = "main.tex"): FileChange => ({
  path,
  kind: "modified",
  before,
  after,
  firstChangedLine: 1,
});

function checkInvariants(candidates: FocusedRecoveryCandidate[], good: string, failed: string) {
  for (const c of candidates) {
    expect(c.scope).toBe("hunk");
    expect(c.path).toBe("main.tex");
    expect(c.kind).toBe("modified");
    expect(c.after).toBe(failed);
    expect(c.firstChangedLine).toBe(c.hunk.fromLine);
    expect(c.hunk.from).toBeGreaterThanOrEqual(0);
    expect(c.hunk.to).toBeGreaterThanOrEqual(c.hunk.from);
    expect(c.hunk.to).toBeLessThanOrEqual(failed.length);
    expect(c.hunk.after).toBe(failed.slice(c.hunk.from, c.hunk.to));
    expect(c.before).toBe(failed.slice(0, c.hunk.from) + c.hunk.before + failed.slice(c.hunk.to));
    expect(c.before).not.toBe(failed);
    expect(c.before).not.toBe(good);
    expect(c.hunk.fromLine).toBeGreaterThanOrEqual(1);
    expect(c.hunk.toLine).toBeGreaterThanOrEqual(c.hunk.fromLine);
  }
}

describe("createFocusedRecoveryCandidates separate edits", () => {
  it("preserves a separate prose edit while reverting a broken macro", () => {
    const good =
      "\\documentclass{article}\n\\begin{document}\nHello world.\n% keep\n\\newcommand{\\foo}{bar}\n\\end{document}\n";
    const failed =
      "\\documentclass{article}\n\\begin{document}\nHello brave world.\n% keep\n\\newcommand{\\foo}{\\broken}\n\\end{document}\n";
    const { candidates, limited } = createFocusedRecoveryCandidates(change(good, failed));
    expect(limited).toBe(false);
    expect(candidates).toHaveLength(2);
    checkInvariants(candidates, good, failed);

    const prose = candidates.find((c) => c.hunk.after.includes("brave"));
    const macro = candidates.find((c) => c.hunk.after.includes("broken"));
    expect(prose).toBeDefined();
    expect(macro).toBeDefined();
    // Reverting the macro block keeps the prose edit.
    expect(macro!.before).toContain("Hello brave world.");
    expect(macro!.before).toContain("\\newcommand{\\foo}{bar}");
    expect(macro!.hunk.before).toBe("\\newcommand{\\foo}{bar}\n");
    expect(macro!.hunk.after).toBe("\\newcommand{\\foo}{\\broken}\n");
    // Reverting the prose block keeps the broken macro.
    expect(prose!.before).toContain("Hello world.");
    expect(prose!.before).toContain("\\newcommand{\\foo}{\\broken}");
    // Offsets are exact UTF-16 slices of the failed source.
    for (const c of candidates) {
      expect(failed.slice(c.hunk.from, c.hunk.to)).toBe(c.hunk.after);
    }
    // Blocks are ordered by line when no diagnostic is given.
    expect(candidates[0].hunk.fromLine).toBeLessThan(candidates[1].hunk.fromLine);
    expect(candidates[0].firstChangedLine).toBe(candidates[0].hunk.fromLine);
  });

  it("maps insert and delete offsets exactly across two blocks", () => {
    const good = ["l1", "l2", "l3", "l4", "l5"].join("\n") + "\n";
    const failed = ["l1", "INSERTED", "l2", "l3", "l4 changed", "l5"].join("\n") + "\n";
    const { candidates } = createFocusedRecoveryCandidates(change(good, failed));
    expect(candidates).toHaveLength(2);
    checkInvariants(candidates, good, failed);
    const inserted = candidates.find((c) => c.hunk.after.includes("INSERTED"));
    expect(inserted).toBeDefined();
    expect(inserted!.hunk.before).toBe("");
    expect(inserted!.hunk.after).toBe("INSERTED\n");
    expect(inserted!.hunk.from).toBeLessThan(inserted!.hunk.to);
    // Removing only the insertion keeps the l4 edit.
    expect(inserted!.before).toBe(["l1", "l2", "l3", "l4 changed", "l5"].join("\n") + "\n");

    const good2 = ["l1", "GONE", "l2", "l3", "l4"].join("\n") + "\n";
    const failed2 = ["l1", "l2", "l3", "l4 changed"].join("\n") + "\n";
    const second = createFocusedRecoveryCandidates(change(good2, failed2));
    expect(second.candidates).toHaveLength(2);
    checkInvariants(second.candidates, good2, failed2);
    const deletion = second.candidates.find((c) => c.hunk.before.includes("GONE"));
    expect(deletion).toBeDefined();
    expect(deletion!.hunk.after).toBe("");
    expect(deletion!.hunk.before).toBe("GONE\n");
    expect(deletion!.hunk.from).toBe(deletion!.hunk.to);
    expect(deletion!.hunk.fromLine).toBe(deletion!.hunk.toLine);
    // Re-inserting only GONE keeps the l4 edit.
    expect(deletion!.before).toBe(["l1", "GONE", "l2", "l3", "l4 changed"].join("\n") + "\n");
  });
});

describe("CRLF, Unicode, blank and trailing lines", () => {
  it("preserves CRLF, emoji, blank lines, and missing trailing newline", () => {
    const good = "a\r\n\r\ncaf\u00e9 \u{1F600}\r\nb\r\nc";
    const failed = "a\r\n\r\ncaf\u00e9 \u{1F600}!\r\nb\r\nC";
    const { candidates } = createFocusedRecoveryCandidates(change(good, failed));
    expect(candidates).toHaveLength(2);
    checkInvariants(candidates, good, failed);
    for (const c of candidates) {
      // No normalization: \r survives inside fragments.
      expect(c.before?.includes("\r\n")).toBe(true);
    }
    const unicode = candidates.find((c) => c.hunk.after.includes("\u{1F600}!"));
    expect(unicode).toBeDefined();
    expect(unicode!.hunk.before).toBe("caf\u00e9 \u{1F600}\r\n");
    expect(unicode!.hunk.after).toBe("caf\u00e9 \u{1F600}!\r\n");
    // Failed has no trailing newline; EOF block has no trailing newline either.
    const eof = candidates.find((c) => c.hunk.after === "C");
    expect(eof).toBeDefined();
    expect(eof!.hunk.before).toBe("c");
    expect(failed.slice(eof!.hunk.from, eof!.hunk.to)).toBe("C");
    // Blank line separates the two blocks and is preserved in the repair.
    expect(unicode!.before).toContain("a\r\n\r\n");
  });

  it("keeps trailing newline differences exact", () => {
    const good = "x\ny\n";
    const failed = "x\nY\n";
    // Single block reverts to the whole good file, so it is skipped.
    expect(createFocusedRecoveryCandidates(change(good, failed)).candidates).toEqual([]);
    const good2 = "x\ny\nz\n";
    const failed2 = "x\nY\nz";
    const { candidates } = createFocusedRecoveryCandidates(change(good2, failed2));
    // Two differences: Y line and missing trailing newline. They are adjacent
    // to the shared z line, so grouping may merge or split; either way every
    // candidate must round-trip exactly.
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    for (const c of candidates) {
      expect(c.before).toBe(failed2.slice(0, c.hunk.from) + c.hunk.before + failed2.slice(c.hunk.to));
    }
  });
});

describe("determinism with repeated lines", () => {
  it("is deterministic and splits only on exact unchanged lines", () => {
    const good = ["x", "y", "x", "y", "x"].join("\n") + "\n";
    const failed = ["x", "z", "x", "z", "x"].join("\n") + "\n";
    const first = createFocusedRecoveryCandidates(change(good, failed));
    const second = createFocusedRecoveryCandidates(change(good, failed));
    expect(first).toEqual(second);
    expect(first.candidates).toHaveLength(2);
    checkInvariants(first.candidates, good, failed);
    // The shared "x" lines separate the blocks; each hunk touches only "y"->"z".
    for (const c of first.candidates) {
      expect(c.hunk.before).toBe("y\n");
      expect(c.hunk.after).toBe("z\n");
    }
  });
});

describe("bounds and skips", () => {
  it("refuses oversized inputs with limited=true", () => {
    const big = `a`.repeat(1_048_577);
    expect(createFocusedRecoveryCandidates(change(big, "small"))).toEqual({ candidates: [], limited: true });
    expect(createFocusedRecoveryCandidates(change("small", big))).toEqual({ candidates: [], limited: true });

    const manyLines = Array.from({ length: 10_001 }, (_, i) => `line${i}`).join("\n");
    const small = "hello";
    expect(createFocusedRecoveryCandidates(change(manyLines, small)).limited).toBe(true);
    expect(createFocusedRecoveryCandidates(change(small, manyLines)).limited).toBe(true);
  });

  it("refuses unbounded LCS work with limited=true", () => {
    const good = Array.from({ length: 600 }, (_, i) => `good-${i}`).join("\n");
    const failed = Array.from({ length: 600 }, (_, i) => `failed-${i}`).join("\n");
    const out = createFocusedRecoveryCandidates(change(good, failed));
    expect(out.candidates).toEqual([]);
    expect(out.limited).toBe(true);
  });

  it("refuses residual lines beyond the cap", () => {
    const good = Array.from({ length: 2001 }, (_, i) => `g${i}`).join("\n");
    const failed = Array.from({ length: 2001 }, (_, i) => `f${i}`).join("\n");
    const out = createFocusedRecoveryCandidates(change(good, failed));
    expect(out.limited).toBe(true);
  });

  it("skips added, removed, binary, and unchanged inputs without limiting", () => {
    expect(
      createFocusedRecoveryCandidates({ path: "n.tex", kind: "added", before: null, after: "x", firstChangedLine: 1 }),
    ).toEqual({ candidates: [], limited: false });
    expect(
      createFocusedRecoveryCandidates({ path: "o.tex", kind: "removed", before: "x", after: null, firstChangedLine: 1 }),
    ).toEqual({ candidates: [], limited: false });
    expect(createFocusedRecoveryCandidates(change("same", "same"))).toEqual({ candidates: [], limited: false });
    expect(createFocusedRecoveryCandidates(change("data:image/png;base64,AAA", "data:image/png;base64,BBB"))).toEqual({
      candidates: [],
      limited: false,
    });
    expect(createFocusedRecoveryCandidates(change("a\0b", "a\0c"))).toEqual({ candidates: [], limited: false });
    expect(createFocusedRecoveryCandidates(change("a", "a\0"))).toEqual({ candidates: [], limited: false });
  });

  it("refuses unsafe paths", () => {
    for (const path of ["../evil.tex", "/abs.tex", "__proto__", "constructor", "a//b.tex", ""]) {
      expect(() => createFocusedRecoveryCandidates(change("a", "b", path))).toThrow();
    }
  });

  it("skips a single-block duplicate already covered by whole-file fallback", () => {
    const good = "l1\nl2\nl3\n";
    const failed = "l1\nCHANGED\nl3\n";
    expect(createFocusedRecoveryCandidates(change(good, failed))).toEqual({ candidates: [], limited: false });
  });
});

describe("performance regression: cap before materializing repairs", () => {
  const hugeManyBlocks = () => {
    const prefix = Array.from({ length: 8000 }, (_, i) => `p${i}`.padEnd(100, "x"));
    const goodMid: string[] = [];
    const failedMid: string[] = [];
    for (let k = 1; k <= 30; k += 1) {
      goodMid.push(`keep${k}`, `good${k}`);
      failedMid.push(`keep${k}`, `bad${k}`);
    }
    const suffix = Array.from({ length: 50 }, (_, i) => `tail${i}`);
    const good = [...prefix, ...goodMid, ...suffix].join("\n") + "\n";
    const failed = [...prefix, ...failedMid, ...suffix].join("\n") + "\n";
    // Last bad block sits at 1-based failed line 8000 + 2*30 = 8060.
    return { good, failed, lastBadLine: 8000 + 2 * 30 };
  };

  it("returns one ranked hunk without building every full repair", () => {
    const { good, failed, lastBadLine } = hugeManyBlocks();
    expect(good.length).toBeLessThan(1_048_576);
    expect(failed.length).toBeLessThan(1_048_576);
    const out = createFocusedRecoveryCandidates(change(good, failed), {
      maxCandidates: 1,
      diagnosticLine: lastBadLine,
    });
    expect(out.candidates).toHaveLength(1);
    expect(out.limited).toBe(true);
    const [only] = out.candidates;
    // Ranking on metadata selects the diagnostic block before any repair is built.
    expect(only.hunk.fromLine).toBe(lastBadLine);
    expect(only.hunk.before).toBe("good30\n");
    expect(only.hunk.after).toBe("bad30\n");
    // The single repair is full-size; at most `cap` (here 1) such strings exist.
    expect(only.before!.length).toBeGreaterThan(700_000);
    expect(only.before).toContain("bad1\n");
    expect(only.before).toContain("good30\n");
    expect(only.before).not.toContain("bad30\n");
    expect(only.after).toBe(failed);
  });

  it("exposes the hard-8 bound structurally on the same huge input", () => {
    const { good, failed } = hugeManyBlocks();
    const out = createFocusedRecoveryCandidates(change(good, failed), { maxCandidates: 100 });
    // At most 8 full-size repairs are ever returned/built (hard cap), even
    // though ~30 blocks were found. Review: ranking+cap run on metadata.
    expect(out.candidates).toHaveLength(8);
    expect(out.limited).toBe(true);
    for (const c of out.candidates) {
      expect(c.before!.length).toBeGreaterThan(700_000);
    }
  });

  it("allows exactly 10000 lines but refuses 10001 without huge splitting", () => {
    const atCap = Array.from({ length: 9999 }, () => "a").join("\n") + "\nnope";
    // 9999 newlines + final line = 10000 lines; single trailing diff is a
    // whole-file duplicate after the shared prefix.
    const goodAtCap = `${Array.from({ length: 9999 }, () => "a").join("\n")}\nok`;
    const failedAtCap = `${Array.from({ length: 9999 }, () => "a").join("\n")}\nnope`;
    expect(goodAtCap.split("\n")).toHaveLength(10000);
    expect(createFocusedRecoveryCandidates(change(goodAtCap, failedAtCap))).toEqual({
      candidates: [],
      limited: false,
    });
    expect(atCap.split("\n")).toHaveLength(10000);
    const over = `${atCap}\nextra`;
    expect(over.split("\n")).toHaveLength(10001);
    expect(createFocusedRecoveryCandidates(change(over, "small")).limited).toBe(true);
  });
});

describe("caps and ranking", () => {
  const fiveBlocks = (): FileChange => {
    const good = ["c0", "a1", "c1", "a2", "c2", "a3", "c3", "a4", "c4", "a5", "c5"].join("\n") + "\n";
    const failed = ["c0", "b1", "c1", "b2", "c2", "b3", "c3", "b4", "c4", "b5", "c5"].join("\n") + "\n";
    return change(good, failed);
  };

  it("caps at default 3 and hard 8 with limited=true", () => {
    const c = fiveBlocks();
    const def = createFocusedRecoveryCandidates(c);
    expect(def.candidates).toHaveLength(3);
    expect(def.limited).toBe(true);
    const two = createFocusedRecoveryCandidates(c, { maxCandidates: 2 });
    expect(two.candidates).toHaveLength(2);
    expect(two.limited).toBe(true);
    const all = createFocusedRecoveryCandidates(c, { maxCandidates: 5 });
    expect(all.candidates).toHaveLength(5);
    expect(all.limited).toBe(false);
    const clamped = createFocusedRecoveryCandidates(c, { maxCandidates: 100 });
    expect(clamped.candidates).toHaveLength(5);
    expect(clamped.limited).toBe(false);

    const manyGood: string[] = ["start"];
    const manyFailed: string[] = ["start"];
    for (let k = 1; k <= 10; k += 1) {
      manyGood.push(`keep${k}`, `good${k}`);
      manyFailed.push(`keep${k}`, `bad${k}`);
    }
    manyGood.push("end");
    manyFailed.push("end");
    const many = createFocusedRecoveryCandidates(
      change(manyGood.join("\n"), manyFailed.join("\n")),
      { maxCandidates: 100 },
    );
    expect(many.candidates).toHaveLength(8);
    expect(many.limited).toBe(true);
  });

  it("ranks by diagnosticLine distance then line", () => {
    const c = fiveBlocks();
    const nearLast = createFocusedRecoveryCandidates(c, { maxCandidates: 2, diagnosticLine: 10 });
    expect(nearLast.candidates).toHaveLength(2);
    expect(nearLast.limited).toBe(true);
    // Failed b-lines are at 2,4,6,8,10 (1-based). Diagnostic 10 prefers lines 10 then 8.
    expect(nearLast.candidates[0].hunk.fromLine).toBe(10);
    expect(nearLast.candidates[1].hunk.fromLine).toBe(8);

    const nearFirst = createFocusedRecoveryCandidates(c, { maxCandidates: 5, diagnosticLine: 2 });
    expect(nearFirst.candidates.map((x) => x.hunk.fromLine)).toEqual([2, 4, 6, 8, 10]);
    expect(nearFirst.limited).toBe(false);
  });

  it("does not mutate frozen inputs", () => {
    const c = Object.freeze(fiveBlocks());
    const opts = Object.freeze({ maxCandidates: 2, diagnosticLine: 4 });
    const out = createFocusedRecoveryCandidates(c, opts);
    expect(out.candidates).toHaveLength(2);
    expect(c.before).toContain("a1");
    expect(opts.maxCandidates).toBe(2);
  });
});
