import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { realProjectRecoveryCorpus } from "./realProjectRecoveryCorpus";

const FIXTURE_ROOT = resolve(
  import.meta.dir,
  "fixtures/real-projects/stanford-thesis-example",
);
const MANIFEST_PATH = resolve(
  import.meta.dir,
  "fixtures/real-projects/stanford-thesis-example.manifest.json",
);
const README_PATH = resolve(
  import.meta.dir,
  "fixtures/real-projects/README.md",
);

const CANONICAL_URL = "https://github.com/dcroote/stanford-thesis-example";
const PINNED_COMMIT = "ffef6af633d0716fb0592b83c8ce594ed38819d2";
const EXPECTED_TEXT_FILES = [
  "main.tex",
  "ch_intro.tex",
  "ch_paper1.tex",
  "ch_conclusion.tex",
  "preface_abstract.tex",
  "preface_acknowledgements.tex",
  "mybib.bib",
  "suthesis-2e.sty",
] as const;
const PNG_PATH = "figs/paper1/fig1.png";

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

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

describe("realProjectRecoveryCorpus", () => {
  test("has three fixtures with unique ids", () => {
    expect(realProjectRecoveryCorpus).toHaveLength(3);
    const ids = realProjectRecoveryCorpus.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toContain("real-thesis-chapter-typo-preserved");
    expect(ids).toContain("real-thesis-include-command-preserved");
    expect(ids).toContain("real-thesis-dual-fault-unresolved");
  });

  test("has two hunk-verified positives plus one unresolved control", () => {
    const hunk = realProjectRecoveryCorpus.filter(
      (c) => c.expected.status === "verified" && c.expected.scope === "hunk",
    );
    const unresolved = realProjectRecoveryCorpus.filter(
      (c) => c.expected.status === "unresolved",
    );
    expect(hunk).toHaveLength(2);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].id).toBe("real-thesis-dual-fault-unresolved");
    const paths = new Set(hunk.map((c) => c.expected.path));
    expect(paths).toEqual(new Set(["ch_paper1.tex", "main.tex"]));
  });

  test("roots stay present, engines stay comparable, payloads are text plus data PNG", () => {
    for (const c of realProjectRecoveryCorpus) {
      expect(c.good.mainFile).toBe("main.tex");
      expect(c.failed.mainFile).toBe("main.tex");
      expect(c.good.engine).toBe("pdflatex");
      expect(c.failed.engine).toBe("pdflatex");
      expect(c.good.timeoutMs).toBe(15000);
      expect(c.failed.timeoutMs).toBe(15000);
      for (const files of [c.good.files, c.failed.files]) {
        expect(Object.hasOwn(files, "main.tex")).toBe(true);
        for (const p of [...EXPECTED_TEXT_FILES]) {
          expect(Object.hasOwn(files, p)).toBe(true);
          expect(typeof files[p]).toBe("string");
          expect(files[p].length).toBeGreaterThan(0);
          expect(files[p].includes("\0")).toBe(false);
        }
        expect(Object.hasOwn(files, PNG_PATH)).toBe(true);
        const png = files[PNG_PATH];
        expect(png.startsWith("data:image/png;base64,")).toBe(true);
        const b64 = png.slice("data:image/png;base64,".length);
        const buf = Buffer.from(b64, "base64");
        expect(buf.length).toBeGreaterThan(1000);
        // PNG signature 89 50 4E 47 0D 0A 1A 0A
        expect([...buf.subarray(0, 8)]).toEqual([
          137, 80, 78, 71, 13, 10, 26, 10,
        ]);
      }
      // LICENSE is vendored for provenance only, never part of the compile payload.
      for (const files of [c.good.files, c.failed.files]) {
        expect(Object.hasOwn(files, "LICENSE")).toBe(false);
      }
    }
  });

  test("chapter typo case makes exactly the targeted fault plus separated prose", () => {
    const c = realProjectRecoveryCorpus.find(
      (f) => f.id === "real-thesis-chapter-typo-preserved",
    )!;
    const good = c.good.files["ch_paper1.tex"];
    const failed = c.failed.files["ch_paper1.tex"];
    // Exact targeted fault.
    expect(good).toContain("\\textbf{bold}, \\textit{italics}");
    expect(failed).toContain("\\textfb{bold}, \\textit{italics}");
    expect(failed).not.toContain("\\textbf{bold}, \\textit{italics}");
    // Exact separated prose addition.
    expect(good).toContain(
      "More text here.\n\nMore text here.\n\n\\section{Conclusions}",
    );
    expect(failed).toContain("Revised addition preserves legal prose.");
    expect(good).not.toContain("Revised addition preserves legal prose.");
    // Reconstructing failed from good via the two documented replacements proves
    // no other bytes changed in that file.
    const reconstructed = good
      .replace(
        "\\textbf{bold}, \\textit{italics}",
        "\\textfb{bold}, \\textit{italics}",
      )
      .replace(
        "More text here.\n\nMore text here.\n\n\\section{Conclusions}",
        "More text here.\n\nMore text here. Revised addition preserves legal prose.\n\n\\section{Conclusions}",
      );
    expect(failed).toBe(reconstructed);
    // All other payload files are byte-identical between good and failed.
    for (const p of Object.keys(c.good.files)) {
      if (p === "ch_paper1.tex") continue;
      expect(c.failed.files[p]).toBe(c.good.files[p]);
    }
    // Expected restores only the fault and keeps the prose.
    expect(c.expected.files!["ch_paper1.tex"]).toContain("\\textbf{bold}");
    expect(c.expected.files!["ch_paper1.tex"]).toContain(
      "Revised addition preserves legal prose.",
    );
    expect(c.expected.files!["ch_paper1.tex"]).not.toContain("\\textfb{bold}");
  });

  test("include typo case changes exactly the targeted command plus separated prose", () => {
    const c = realProjectRecoveryCorpus.find(
      (f) => f.id === "real-thesis-include-command-preserved",
    )!;
    const good = c.good.files["main.tex"];
    const failed = c.failed.files["main.tex"];
    expect(good).toContain("\\include{ch_paper1}");
    expect(failed).toContain("\\incldue{ch_paper1}");
    expect(failed).not.toContain("\\include{ch_paper1}");
    expect(failed).toContain("Revised note preserves legal prose.");
    expect(good).not.toContain("Revised note preserves legal prose.");
    const reconstructed = good
      .replace("\\include{ch_paper1}", "\\incldue{ch_paper1}")
      .replace(
        "% adds a non-numbered signature page at end (for printing on ACID-FREE paper)",
        "Revised note preserves legal prose.\n% adds a non-numbered signature page at end (for printing on ACID-FREE paper)",
      );
    expect(failed).toBe(reconstructed);
    for (const p of Object.keys(c.good.files)) {
      if (p === "main.tex") continue;
      expect(c.failed.files[p]).toBe(c.good.files[p]);
    }
    expect(c.expected.files!["main.tex"]).toContain("\\include{ch_paper1}");
    expect(c.expected.files!["main.tex"]).toContain(
      "Revised note preserves legal prose.",
    );
    expect(c.expected.files!["main.tex"]).not.toContain("\\incldue{ch_paper1}");
  });

  test("dual-fault control has independent faults in two files and nothing else", () => {
    const c = realProjectRecoveryCorpus.find(
      (f) => f.id === "real-thesis-dual-fault-unresolved",
    )!;
    const changed = Object.keys(c.good.files).filter(
      (p) => c.good.files[p] !== c.failed.files[p],
    );
    expect(new Set(changed)).toEqual(
      new Set(["ch_intro.tex", "ch_paper1.tex"]),
    );
    expect(c.failed.files["ch_intro.tex"]).toContain("\\UndefinedIntroCommand");
    expect(c.good.files["ch_intro.tex"]).not.toContain(
      "\\UndefinedIntroCommand",
    );
    expect(c.failed.files["ch_paper1.tex"]).toContain("\\textfb{bold}");
    expect(c.good.files["ch_paper1.tex"]).toContain("\\textbf{bold}");
    expect(c.expected.status).toBe("unresolved");
    expect(c.expected.files).toBeUndefined();
    expect(c.expected.scope).toBeUndefined();
    expect(c.expected.path).toBeUndefined();
  });

  test("hunk positives restore only the bad block and keep failed prose", () => {
    const positives = realProjectRecoveryCorpus.filter(
      (c) => c.expected.status === "verified" && c.expected.scope === "hunk",
    );
    expect(positives).toHaveLength(2);
    for (const c of positives) {
      const path = c.expected.path!;
      const files = c.expected.files!;
      expect(Object.keys(files).sort()).toEqual(
        Object.keys(c.failed.files).sort(),
      );
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

  test("changed blocks stay separated by equal unchanged lines", () => {
    for (const c of realProjectRecoveryCorpus.filter(
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

  test("good baseline matches vendored upstream bytes and manifest hashes", async () => {
    const manifestRaw = await readFile(MANIFEST_PATH, "utf8");
    const manifest = JSON.parse(manifestRaw) as {
      project: string;
      sourceUrl: string;
      branch: string;
      commit: string;
      baseline: string;
      buildClaim: string;
      files: Array<{ path: string; sha256: string; bytes: number }>;
    };
    expect(manifest.sourceUrl).toBe(CANONICAL_URL);
    expect(manifest.branch).toBe("master");
    expect(manifest.commit).toBe(PINNED_COMMIT);
    expect(manifest.baseline).toMatch(/no adaptations/i);
    expect(manifest.buildClaim).toMatch(/no build claim/i);
    const byPath = new Map(manifest.files.map((f) => [f.path, f]));
    for (const p of [...EXPECTED_TEXT_FILES, PNG_PATH, "LICENSE"]) {
      const entry = byPath.get(p);
      expect(entry).toBeDefined();
      const disk = await readFile(resolve(FIXTURE_ROOT, p));
      expect(disk.length).toBe(entry!.bytes);
      expect(sha256Hex(disk)).toBe(entry!.sha256);
    }
    // Corpus good payload is the unchanged upstream baseline.
    for (const c of realProjectRecoveryCorpus) {
      for (const p of EXPECTED_TEXT_FILES) {
        const diskText = await readFile(resolve(FIXTURE_ROOT, p), "utf8");
        expect(c.good.files[p]).toBe(diskText);
      }
      const diskPng = await readFile(resolve(FIXTURE_ROOT, PNG_PATH));
      const payloadPng = c.good.files[PNG_PATH];
      const payloadBytes = Buffer.from(
        payloadPng.slice("data:image/png;base64,".length),
        "base64",
      );
      expect(sha256Hex(payloadBytes)).toBe(sha256Hex(diskPng));
      expect(sha256Hex(payloadBytes)).toBe(byPath.get(PNG_PATH)!.sha256);
    }
  });

  test("licensing fixture files preserve all copyright notices", async () => {
    const license = await readFile(resolve(FIXTURE_ROOT, "LICENSE"), "utf8");
    expect(license).toContain("Copyright 2019 Derek Croote");
    expect(license).toContain("Permission is hereby granted");
    expect(license).toContain("MIT");
    const sty = await readFile(
      resolve(FIXTURE_ROOT, "suthesis-2e.sty"),
      "utf8",
    );
    expect(sty).toContain("People are free to borrow");
    expect(sty).toContain("acknowledge");
    expect(sty).toContain("Joseph Pallas");
    expect(sty).toContain("Emma Pease");
    const main = await readFile(resolve(FIXTURE_ROOT, "main.tex"), "utf8");
    expect(main).toContain("Stanford University PhD thesis style");
    // Corpus embeds preserve the same notices byte-for-byte.
    for (const c of realProjectRecoveryCorpus) {
      expect(c.good.files["suthesis-2e.sty"]).toContain(
        "People are free to borrow",
      );
      expect(c.good.files["main.tex"]).toContain(
        "Stanford University PhD thesis style",
      );
    }
  });

  test("provenance README distinguishes template from manuscript and user study", async () => {
    const readme = await readFile(README_PATH, "utf8");
    expect(readme).toContain(CANONICAL_URL);
    expect(readme).toContain(PINNED_COMMIT);
    expect(readme).toMatch(/TEMPLATE/i);
    expect(readme.toLowerCase()).toContain("not a real");
    expect(readme.toLowerCase()).toContain("submitted manuscript");
    expect(readme.toLowerCase()).toContain("user study");
    expect(readme.toLowerCase()).toContain("not a representative");
    expect(readme.toLowerCase()).toContain("unclaimed");
    expect(readme).toMatch(/verification CLI/i);
  });
});
