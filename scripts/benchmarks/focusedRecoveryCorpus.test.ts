import { describe, expect, test } from "bun:test";
import { focusedRecoveryCorpus } from "./focusedRecoveryCorpus";

function splitLines(s: string): string[] {
  return s.split("\n");
}

function midSections(good: string, failed: string) {
  const g = splitLines(good);
  const f = splitLines(failed);
  let prefix = 0;
  const minLen = Math.min(g.length, f.length);
  while (prefix < minLen && g[prefix] === f[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < g.length - prefix &&
    suffix < f.length - prefix &&
    g[g.length - 1 - suffix] === f[f.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    goodMid: g.slice(prefix, g.length - suffix),
    failedMid: f.slice(prefix, f.length - suffix),
    prefix,
    suffix,
  };
}

function commonLines(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return [...new Set(a)].filter((line) => setB.has(line));
}

describe("focusedRecoveryCorpus", () => {
  test("has seven fixtures with unique ids", () => {
    expect(focusedRecoveryCorpus).toHaveLength(7);
    const ids = focusedRecoveryCorpus.map((c) => c.id);
    expect(new Set(ids).size).toBe(7);
  });

  test("has four hunk-verified positives plus file, unresolved, and incompatible controls", () => {
    const hunk = focusedRecoveryCorpus.filter(
      (c) => c.expected.status === "verified" && c.expected.scope === "hunk",
    );
    const file = focusedRecoveryCorpus.filter(
      (c) => c.expected.status === "verified" && c.expected.scope === "file",
    );
    const unresolved = focusedRecoveryCorpus.filter(
      (c) => c.expected.status === "unresolved",
    );
    const incompatible = focusedRecoveryCorpus.filter(
      (c) => c.expected.status === "incompatible",
    );
    expect(hunk).toHaveLength(4);
    expect(file).toHaveLength(1);
    expect(unresolved).toHaveLength(1);
    expect(incompatible).toHaveLength(1);
    expect(hunk.length + file.length + unresolved.length + incompatible.length).toBe(7);
  });

  test("roots stay present, engines stay comparable, and fixtures stay tiny", () => {
    for (const c of focusedRecoveryCorpus) {
      expect(c.good.mainFile).toBe(c.failed.mainFile);
      expect(Object.hasOwn(c.good.files, c.good.mainFile)).toBe(true);
      expect(Object.hasOwn(c.failed.files, c.failed.mainFile)).toBe(true);
      expect(c.good.engine).toBe("pdflatex");
      if (c.id === "focused-engine-changed-incompatible") {
        expect(c.failed.engine).toBe("xelatex");
      } else {
        expect(c.failed.engine).toBe("pdflatex");
      }
      for (const content of Object.values({
        ...c.good.files,
        ...c.failed.files,
      })) {
        expect(content.length).toBeLessThan(2048);
      }
      const total = Object.values(c.good.files).join("").length +
        Object.values(c.failed.files).join("").length;
      expect(total).toBeLessThan(10240);
      for (const files of [c.good.files, c.failed.files]) {
        const main = files[c.good.mainFile];
        expect(main).toContain(String.raw`\documentclass{article}`);
        expect(main).toContain(String.raw`\begin{document}`);
        expect(main).toContain(String.raw`\end{document}`);
      }
      for (const files of [c.good.files, c.failed.files]) {
        for (const content of Object.values(files)) {
          const packages = [...content.matchAll(/\\usepackage(\[[^\]]*\])?\{([^}]*)\}/g)].map(
            (m) => m[2],
          );
          for (const pkg of packages) {
            expect(pkg).toBe("amsmath");
          }
        }
      }
    }
  });

  test("hunk positives restore only the bad block and keep failed prose", () => {
    const positives = focusedRecoveryCorpus.filter(
      (c) => c.expected.status === "verified" && c.expected.scope === "hunk",
    );
    expect(positives).toHaveLength(4);
    for (const c of positives) {
      const path = c.expected.path!;
      const files = c.expected.files!;
      expect(path).toBeDefined();
      expect(Object.keys(files).sort()).toEqual(Object.keys(c.failed.files).sort());
      for (const p of Object.keys(files)) {
        if (p === path) continue;
        expect(files[p]).toBe(c.failed.files[p]);
      }
      expect(files[path]).not.toBe(c.failed.files[path]);
      expect(files[path]).not.toBe(c.good.files[path]);
      expect(c.retainedText).toBeDefined();
      expect(c.revertedText).toBeDefined();
      expect(files[path]).toContain(c.retainedText!);
      expect(files[path]).toContain(c.revertedText!);
      expect(c.good.files[path]).toContain(c.revertedText!);
      expect(c.good.files[path]).not.toContain(c.retainedText!);
      expect(c.failed.files[path]).toContain(c.retainedText!);
      expect(c.failed.files[path]).not.toContain(c.revertedText!);
    }
  });

  test("whole-file fallback restores the good file and honestly loses same-file prose", () => {
    const c = focusedRecoveryCorpus.find((f) => f.id === "focused-whole-file-fallback")!;
    expect(c.expected.status).toBe("verified");
    expect(c.expected.scope).toBe("file");
    expect(c.expected.path).toBe("main.tex");
    expect(c.expected.files).toEqual(c.good.files);
    expect(c.expected.files!["main.tex"]).toBe(c.good.files["main.tex"]);
    expect(c.retainedText).toBeDefined();
    expect(c.revertedText).toBeDefined();
    expect(c.failed.files["main.tex"]).toContain(c.retainedText!);
    expect(c.expected.files!["main.tex"]).not.toContain(c.retainedText!);
    expect(c.expected.files!["main.tex"]).toContain(c.revertedText!);
    const changed = Object.keys(c.good.files).filter(
      (p) => c.good.files[p] !== c.failed.files[p],
    );
    expect(changed).toEqual(["main.tex"]);
    const { goodMid, failedMid } = midSections(
      c.good.files["main.tex"],
      c.failed.files["main.tex"],
    );
    expect(commonLines(goodMid, failedMid).length).toBeGreaterThanOrEqual(2);
  });

  test("changed blocks stay separated by equal unchanged lines", () => {
    for (const c of focusedRecoveryCorpus.filter(
      (f) => f.expected.status === "verified" && f.expected.scope === "hunk",
    )) {
      const path = c.expected.path!;
      const { goodMid, failedMid } = midSections(
        c.good.files[path],
        c.failed.files[path],
      );
      expect(commonLines(goodMid, failedMid).length).toBeGreaterThanOrEqual(1);
    }
  });

  test("controls carry no restoration payload", () => {
    for (const c of focusedRecoveryCorpus.filter(
      (f) => f.expected.status === "unresolved" || f.expected.status === "incompatible",
    )) {
      expect(c.expected.files).toBeUndefined();
      expect(c.expected.scope).toBeUndefined();
      expect(c.expected.path).toBeUndefined();
    }
  });
});
