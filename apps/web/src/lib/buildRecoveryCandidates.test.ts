import { describe, expect, it } from "vitest";
import {
  compareBuildFiles,
  previewFileChange,
  recoveryCandidateOrder,
  restoreCandidateFile,
  type FileChange,
} from "./buildRecoveryCandidates";

const change = (over: Partial<FileChange>): FileChange => ({
  path: "main.tex",
  kind: "modified",
  before: "old",
  after: "new",
  firstChangedLine: 1,
  ...over,
});

describe("compareBuildFiles", () => {
  it("detects added files with null before", () => {
    const out = compareBuildFiles({}, { "new.tex": "hello" });
    expect(out).toEqual([
      { path: "new.tex", kind: "added", before: null, after: "hello", firstChangedLine: 1 },
    ]);
  });

  it("detects removed files with null after", () => {
    const out = compareBuildFiles({ "gone.tex": "bye" }, {});
    expect(out).toEqual([
      { path: "gone.tex", kind: "removed", before: "bye", after: null, firstChangedLine: 1 },
    ]);
  });

  it("detects modified files with 1-based first changed line", () => {
    const out = compareBuildFiles(
      { "main.tex": "a\nb\nc\nd" },
      { "main.tex": "a\nb\nX\nd" },
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("modified");
    expect(out[0].firstChangedLine).toBe(3);
  });

  it("reports appended lines past the common prefix", () => {
    const out = compareBuildFiles({ "m.tex": "a\nb" }, { "m.tex": "a\nb\nc" });
    expect(out[0].firstChangedLine).toBe(3);
  });

  it("treats empty string as valid content, not absence", () => {
    expect(compareBuildFiles({ "e.tex": "" }, { "e.tex": "" })).toEqual([]);
    const modified = compareBuildFiles({ "e.tex": "" }, { "e.tex": "x" });
    expect(modified[0].kind).toBe("modified");
    const added = compareBuildFiles({}, { "e.tex": "" });
    expect(added).toEqual([
      { path: "e.tex", kind: "added", before: null, after: "", firstChangedLine: 1 },
    ]);
  });

  it("ignores inherited and prototype keys", () => {
    const good = Object.create({ inherited: "x" });
    const failed = Object.create({ inherited: "y" });
    expect(compareBuildFiles(good, failed)).toEqual([]);
    expect(compareBuildFiles({}, {} as Record<string, string>)).toEqual([]);
  });

  it("is deterministic regardless of key insertion order", () => {
    const a = compareBuildFiles({ "b.tex": "1", "a.tex": "1" }, { "b.tex": "2", "c.tex": "3" });
    const b = compareBuildFiles({ "a.tex": "1", "b.tex": "1" }, { "c.tex": "3", "b.tex": "2" });
    expect(a).toEqual(b);
    expect(a.map((c) => c.path)).toEqual(["a.tex", "b.tex", "c.tex"]);
  });

  it("does not mutate its inputs", () => {
    const good = Object.freeze({ "m.tex": "a" });
    const failed = Object.freeze({ "m.tex": "b" });
    compareBuildFiles(good, failed);
    expect(good).toEqual({ "m.tex": "a" });
    expect(failed).toEqual({ "m.tex": "b" });
  });
});

describe("restoreCandidateFile", () => {
  it("restores modified content and preserves unrelated files", () => {
    const files = { "main.tex": "broken", "keep.tex": "same" };
    const out = restoreCandidateFile(files, change({ path: "main.tex", before: "fixed" }));
    expect(out).toEqual({ "main.tex": "fixed", "keep.tex": "same" });
    expect(files).toEqual({ "main.tex": "broken", "keep.tex": "same" });
  });

  it("deletes the file when before is null", () => {
    const out = restoreCandidateFile(
      { "new.tex": "x", "keep.tex": "y" },
      change({ path: "new.tex", kind: "added", before: null, after: "x" }),
    );
    expect(out).toEqual({ "keep.tex": "y" });
  });

  it("re-adds a removed file", () => {
    const out = restoreCandidateFile(
      { "keep.tex": "y" },
      change({ path: "old.tex", kind: "removed", before: "back", after: null }),
    );
    expect(out).toEqual({ "keep.tex": "y", "old.tex": "back" });
  });

  it("rejects unsafe paths", () => {
    for (const path of ["../evil.tex", "/abs.tex", "__proto__", "constructor", "a//b.tex", ""]) {
      expect(() => restoreCandidateFile({}, change({ path })), path).toThrow();
    }
  });

  it("never pollutes prototypes via __proto__ payloads", () => {
    const failed = JSON.parse('{"__proto__":"evil"}') as Record<string, string>;
    const diff = compareBuildFiles({}, failed);
    expect(diff.map((c) => c.path)).toEqual(["__proto__"]);
    expect(() => restoreCandidateFile({}, diff[0])).toThrow();
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("does not mutate the change object", () => {
    const c = Object.freeze(change({ path: "m.tex", before: "ok" }));
    restoreCandidateFile({ "m.tex": "bad", "other.tex": "z" }, c);
    expect(c.before).toBe("ok");
  });
});

describe("recoveryCandidateOrder", () => {
  const changes = [
    change({ path: "img.png" }),
    change({ path: "main.tex" }),
    change({ path: "notes.md" }),
    change({ path: "refs.bib" }),
    change({ path: "chapters/a.tex" }),
  ];

  it("prioritizes diagnostic files, then tex/sty/cls/bib, then others by path", () => {
    const out = recoveryCandidateOrder(changes, ["notes.md"]);
    expect(out.map((c) => c.path)).toEqual([
      "notes.md",
      "chapters/a.tex",
      "main.tex",
      "refs.bib",
      "img.png",
    ]);
  });

  it("returns every candidate without a cap and without mutating input", () => {
    const input = [...changes];
    const out = recoveryCandidateOrder(input, []);
    expect(out).toHaveLength(changes.length);
    expect(input.map((c) => c.path)).toEqual(changes.map((c) => c.path));
    expect(out).not.toBe(input);
  });
});

describe("previewFileChange", () => {
  it("trims common prefix/suffix and numbers removed then added lines", () => {
    const out = previewFileChange(
      change({ before: "l1\nl2\nX\nl4", after: "l1\nl2\nY\nl4" }),
    );
    expect(out).toEqual([
      { kind: "removed", line: 3, text: "X" },
      { kind: "added", line: 3, text: "Y" },
    ]);
  });

  it("previews added files as added lines from line 1", () => {
    expect(
      previewFileChange(change({ kind: "added", before: null, after: "a\nb" })),
    ).toEqual([
      { kind: "added", line: 1, text: "a" },
      { kind: "added", line: 2, text: "b" },
    ]);
  });

  it("previews removed files as removed lines from line 1", () => {
    expect(
      previewFileChange(change({ kind: "removed", before: "a\nb", after: null })),
    ).toEqual([
      { kind: "removed", line: 1, text: "a" },
      { kind: "removed", line: 2, text: "b" },
    ]);
  });

  it("bounds output to maxLines with default 80", () => {
    const big = Array.from({ length: 200 }, (_, i) => `line${i}`).join("\n");
    const c = change({ before: big, after: "other" });
    expect(previewFileChange(c)).toHaveLength(80);
    expect(previewFileChange(c, 5)).toHaveLength(5);
    expect(previewFileChange(c, 0)).toEqual([]);
  });
});
