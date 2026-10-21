import { beforeEach, describe, expect, it } from "vitest";
import {
  applyReplaceToFiles,
  buildReplacePreview,
  globToRe2Source,
  isBinaryContent,
  isPathIncluded,
  matchToOffset,
  matchesAnyGlob,
  offsetToLineCol,
  searchProjectFiles,
} from "@/lib/projectSearch";
import { useWorkbenchStore } from "@/stores/workbenchStore";

function seedFiles(filesByPath: Record<string, string>, role: "owner" | "editor" | "viewer" = "owner") {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useWorkbenchStore.setState({
    projectId: "search-test",
    projectRole: role,
    activeFileId: "main.tex",
    openFiles: ["main.tex"],
    filesByPath,
    versionsByPath: Object.fromEntries(Object.keys(filesByPath).map((p) => [p, 1])),
    dirtyByPath: Object.fromEntries(Object.keys(filesByPath).map((p) => [p, false])),
  });
}

describe("projectSearch lib", () => {
  it("finds literal matches grouped by file with counts", () => {
    const files = {
      "main.tex": "hello world\nhello again",
      "chapter.tex": "say hello here",
      "notes.md": "hello md",
    };
    const out = searchProjectFiles(files, "hello", {});
    expect(out.totalMatches).toBe(4);
    expect(out.fileCount).toBe(3);
    expect(out.groups.map((g) => [g.path, g.matches.length])).toEqual([
      ["chapter.tex", 1],
      ["main.tex", 2],
      ["notes.md", 1],
    ]);
    const first = out.matches[0];
    expect(first?.path).toBe("main.tex");
    expect(first?.line).toBe(1);
    expect(first?.column).toBe(1);
    expect(first?.endColumn).toBe(6);
    expect(first?.length).toBe(5);
    expect(first?.matchText).toBe("hello");
  });

  it("respects case sensitivity", () => {
    const files = { "main.tex": "Hello hello HELLO" };
    expect(searchProjectFiles(files, "hello", {}).totalMatches).toBe(3);
    expect(searchProjectFiles(files, "hello", { caseSensitive: true }).totalMatches).toBe(1);
  });

  it("supports whole-word boundaries", () => {
    const files = { "main.tex": "cat concatenate cat." };
    const out = searchProjectFiles(files, "cat", { wholeWord: true });
    expect(out.totalMatches).toBe(2);
    expect(out.matches.map((m) => m.column)).toEqual([1, 17]);
  });

  it("supports regex with capture groups", () => {
    const files = { "main.tex": "sec 123 and 4567" };
    const out = searchProjectFiles(files, "\\d+", { regex: true });
    expect(out.totalMatches).toBe(2);
    expect(out.matches.map((m) => m.matchText)).toEqual(["123", "4567"]);
  });

  it("supports include/exclude globs", () => {
    const files = {
      "main.tex": "hit",
      "chapters/one.tex": "hit",
      "figures/a.txt": "hit",
    };
    expect(searchProjectFiles(files, "hit", { include: "*.tex" }).fileCount).toBe(1);
    expect(
      searchProjectFiles(files, "hit", { include: "chapters/**" }).matches[0]?.path,
    ).toBe("chapters/one.tex");
    expect(searchProjectFiles(files, "hit", { exclude: "figures/**" }).totalMatches).toBe(2);
    expect(
      searchProjectFiles(files, "hit", { include: "*.tex, chapters/**", exclude: "chapters/**" }).totalMatches,
    ).toBe(1);
  });

  it("honours texOnly", () => {
    const files = { "main.tex": "x", "data.bib": "x" };
    expect(searchProjectFiles(files, "x", { texOnly: true }).fileCount).toBe(1);
  });

  it("excludes binary content", () => {
    expect(isBinaryContent("data:image/png;base64,AAA")).toBe(true);
    expect(isBinaryContent("text\0with nul")).toBe(true);
    expect(isBinaryContent("plain tex")).toBe(false);
    const files = {
      "main.tex": "hello",
      "fig.png": "data:image/png;base64,hello",
      "blob.tex": "a\0hello",
    };
    const out = searchProjectFiles(files, "hello", {});
    expect(out.skippedBinary).toBe(2);
    expect(out.totalMatches).toBe(1);
    expect(out.matches[0]?.path).toBe("main.tex");
  });

  it("finds multiline matches and maps line/column", () => {
    const files = { "main.tex": "alpha\nbeta\ngamma" };
    const out = searchProjectFiles(files, "alpha\nbeta", {});
    expect(out.totalMatches).toBe(1);
    expect(out.matches[0]).toMatchObject({ line: 1, column: 1, endLine: 2 });
    // navigation roundtrip
    const off = matchToOffset(files["main.tex"], 2, 1);
    expect(files["main.tex"].slice(off, off + 4)).toBe("beta");
    expect(offsetToLineCol(files["main.tex"], 0)).toEqual({ line: 1, column: 1 });
  });

  it("handles unicode content", () => {
    const files = { "main.tex": "café naïve café\nemoji 🎉 party" };
    expect(searchProjectFiles(files, "café", {}).totalMatches).toBe(2);
    expect(searchProjectFiles(files, "🎉", {}).totalMatches).toBe(1);
    const out = searchProjectFiles(files, "naïve", { wholeWord: true });
    expect(out.totalMatches).toBe(1);
  });

  it("executes catastrophic patterns in linear time instead of hanging", () => {
    const bigA = "a".repeat(100_000);
    const start = Date.now();
    // Both patterns hang backtracking engines; RE2 stays linear.
    expect(searchProjectFiles({ "m.tex": `${bigA}b` }, "((a+)+)$", { regex: true }).totalMatches).toBe(0);
    expect(searchProjectFiles({ "m.tex": bigA }, "a+a+a+a+b", { regex: true }).totalMatches).toBe(0);
    expect(Date.now() - start).toBeLessThan(5000);
    // Finding matches on large input is fast too.
    const found = searchProjectFiles({ "m.tex": bigA }, "((a+)+)", { regex: true });
    expect(found.totalMatches).toBe(1);
    expect(found.matches[0]?.length).toBe(100_000);
    expect(Date.now() - start).toBeLessThan(5000);
  });

  it("rejects backreferences and lookaround with a clear RE2 error and no fallback", () => {
    const files = { "m.tex": "aa ab" };
    // All three MATCH under JavaScript RegExp: throwing proves no fallback.
    expect(() => searchProjectFiles(files, "(a)\\1", { regex: true })).toThrow(/RE2 syntax/);
    expect(() => searchProjectFiles(files, "a(?=b)", { regex: true })).toThrow(/RE2 syntax/);
    expect(() => searchProjectFiles(files, "(?<=a)b", { regex: true })).toThrow(/RE2 syntax/);
    expect(() => searchProjectFiles({ "m.tex": "x" }, "([", { regex: true })).toThrow(/Invalid regular expression/);
    expect(() => searchProjectFiles(files, "x".repeat(201), {})).toThrow(/too long/);
  });

  it("bounds total matches with truncation", () => {
    const files = { "m.tex": `${"x ".repeat(5000)}` };
    const out = searchProjectFiles(files, "x", { maxResults: 10 });
    expect(out.totalMatches).toBe(10);
    expect(out.truncated).toBe(true);
  });

  it("clamps non-finite maxResults to the default", () => {
    const files = { "m.tex": "x ".repeat(50) };
    expect(searchProjectFiles(files, "x", { maxResults: NaN }).totalMatches).toBe(50);
    expect(searchProjectFiles(files, "x", { maxResults: Infinity }).totalMatches).toBe(50);
    expect(searchProjectFiles(files, "x", { maxResults: -5 }).totalMatches).toBe(50);
    expect(searchProjectFiles(files, "x", { maxResults: 0 }).totalMatches).toBe(50);
    const floored = searchProjectFiles(files, "x", { maxResults: 2.7 });
    expect(floored.totalMatches).toBe(2);
    expect(floored.truncated).toBe(true);
  });

  it("marks per-file truncation and refuses replace-all while allowing single-target", () => {
    const content = "x ".repeat(600);
    const files = { "m.tex": content };
    const out = searchProjectFiles(files, "x", {});
    expect(out.totalMatches).toBe(500);
    expect(out.truncated).toBe(true);
    expect(() => applyReplaceToFiles(files, "x", "y", {})).toThrow(/Too many/);
    // The tail match sits beyond the per-file cap but verifies directly.
    const lastCol = 2 * 599 + 1;
    const single = applyReplaceToFiles(files, "x", "y", { target: { path: "m.tex", line: 1, column: lastCol } });
    expect(single.replacedMatches).toBe(1);
    expect(single.files["m.tex"]?.slice(1196)).toBe("x y ");
  });

  it("converts globs without executing RegExp", () => {
    expect(globToRe2Source("*.tex")).toBe("[^/]*\\.tex");
    expect(globToRe2Source("**/*.tex")).toBe("(?:.*/)?[^/]*\\.tex");
    expect(globToRe2Source("fig?.png")).toBe("fig[^/]\\.png");
    expect(matchesAnyGlob("main.tex", ["*.tex"])).toBe(true);
    expect(matchesAnyGlob("a/main.tex", ["*.tex"])).toBe(false);
    expect(isPathIncluded("a/b.tex", "*.tex", undefined, undefined)).toBe(false);
    expect(isPathIncluded("a/b.tex", "**/*.tex", undefined, undefined)).toBe(true);
  });

  it("match boundary navigation is exact", () => {
    const content = "line one\nsecond line here\nthird";
    expect(matchToOffset(content, 2, 8)).toBe(content.indexOf("line here"));
    expect(offsetToLineCol(content, content.indexOf("third"))).toEqual({ line: 3, column: 1 });
  });

  it("maps lines on large files without quadratic rescan", () => {
    const lines = Array.from({ length: 3000 }, (_, i) => (i % 10 === 0 ? `line ${i} needle` : `line ${i} filler`));
    const content = lines.join("\n");
    const start = Date.now();
    const out = searchProjectFiles({ "big.tex": content }, "needle", {});
    expect(Date.now() - start).toBeLessThan(5000);
    expect(out.totalMatches).toBe(300);
    expect(out.truncated).toBe(false);
    expect(out.matches[0]).toMatchObject({ line: 1, column: 8 });
    expect(out.matches[299]?.line).toBe(2991);
    expect(out.matches[150]?.line).toBe(1501);
  });

  it("replace-all previews and applies atomically", () => {
    const files = { "a.tex": "foo foo", "b.tex": "foo" };
    const preview = buildReplacePreview(files, "foo", "bar", {});
    expect(preview.totalMatches).toBe(3);
    expect(preview.fileCount).toBe(2);
    expect(preview.samples[0]).toMatchObject({ path: "a.tex", before: expect.stringContaining("foo") });
    const out = applyReplaceToFiles(files, "foo", "bar", {});
    expect(out.replacedMatches).toBe(3);
    expect(out.files["a.tex"]).toBe("bar bar");
    expect(out.files["b.tex"]).toBe("bar");
  });

  it("previews the exact occurrence, not the first on the line", () => {
    const files = { "a.tex": "foo foo" };
    const preview = buildReplacePreview(files, "foo", "bar", {});
    expect(preview.samples).toHaveLength(2);
    expect(preview.samples[0]).toMatchObject({ before: "foo foo", after: "bar foo" });
    // The second match splices at its own offset; a first-occurrence
    // replace would wrongly render "bar foo" here too.
    expect(preview.samples[1]).toMatchObject({ before: "foo foo", after: "foo bar" });
  });

  it("previews multiline matches without overrunning the start line", () => {
    const files = { "a.tex": "alpha beta\ngamma delta" };
    const preview = buildReplacePreview(files, "beta\ngamma", "X", {});
    expect(preview.totalMatches).toBe(1);
    expect(preview.samples[0]).toMatchObject({ line: 1, column: 7, before: "alpha beta", after: "alpha X" });
  });

  it("replace supports regex groups and literal dollars", () => {
    const out = applyReplaceToFiles({ "a.tex": "2026-01-04" }, "(\\d+)-(\\d+)-(\\d+)", "$3/$2/$1", { regex: true });
    expect(out.files["a.tex"]).toBe("04/01/2026");
    const literal = applyReplaceToFiles({ "a.tex": "price $5" }, "$5", "$10", {});
    expect(literal.files["a.tex"]).toBe("price $10");
  });

  it("single-target replace verifies stale content", () => {
    const files = { "a.tex": "alpha beta" };
    const out = applyReplaceToFiles(files, "beta", "GAMMA", { target: { path: "a.tex", line: 1, column: 7 } });
    expect(out.replacedMatches).toBe(1);
    expect(out.files["a.tex"]).toBe("alpha GAMMA");
    // Wrong column: stale target refused.
    const stale = applyReplaceToFiles({ "a.tex": "alpha CHANGED" }, "beta", "GAMMA", {
      target: { path: "a.tex", line: 1, column: 7 },
    });
    expect(stale.replacedMatches).toBe(0);
  });

  it("refuses over-broad replace instead of partial rewrite", () => {
    const files = { "a.tex": `${"x ".repeat(5000)}` };
    expect(() => applyReplaceToFiles(files, "x", "y", { maxResults: 5 })).toThrow(/Too many/);
  });
});

describe("workbenchStore project search integration", () => {
  beforeEach(() => {
    seedFiles({ "main.tex": "hello world", "chapter.tex": "hello again" });
  });

  it("search populates typed results and clears", () => {
    const n = useWorkbenchStore.getState().runProjectSearch("hello", {});
    expect(n).toBe(2);
    const state = useWorkbenchStore.getState();
    expect(state.projectSearchResults).toHaveLength(2);
    expect(state.projectSearchResults[0]).toMatchObject({ line: 1, column: 1, matchText: "hello" });
    useWorkbenchStore.getState().clearProjectSearch();
    expect(useWorkbenchStore.getState().projectSearchResults).toHaveLength(0);
  });

  it("replace is atomic and bumps one revision", () => {
    seedFiles({ "main.tex": "foo foo", "chapter.tex": "foo" });
    const before = useWorkbenchStore.getState().documentRevision;
    const rev = useWorkbenchStore.getState().documentRevision;
    const n = useWorkbenchStore.getState().replaceAcrossFiles("foo", "bar", { expectedDocumentRevision: rev });
    expect(n).toBe(3);
    const state = useWorkbenchStore.getState();
    expect(state.filesByPath["main.tex"]).toBe("bar bar");
    expect(state.documentRevision).toBeGreaterThan(before);
  });

  it("stale revision refuses replacement without mutation", () => {
    seedFiles({ "main.tex": "foo" });
    const rev = useWorkbenchStore.getState().documentRevision;
    useWorkbenchStore.getState().updateActiveFileContent("foo edited");
    const edited = useWorkbenchStore.getState().filesByPath["main.tex"];
    const n = useWorkbenchStore.getState().replaceAcrossFiles("foo", "bar", { expectedDocumentRevision: rev });
    expect(n).toBe(0);
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toBe(edited);
  });

  it("viewer role can search but cannot replace", () => {
    seedFiles({ "main.tex": "hello world" }, "viewer");
    expect(useWorkbenchStore.getState().runProjectSearch("hello", {})).toBe(1);
    expect(useWorkbenchStore.getState().replaceAcrossFiles("hello", "bye", {})).toBe(0);
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toBe("hello world");
  });
});
