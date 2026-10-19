import { describe, expect, test } from "bun:test";
import { recoveryCorpus } from "./recoveryCorpus";

describe("recoveryCorpus", () => {
  test("has exactly 20 cases with unique IDs", () => {
    expect(recoveryCorpus).toHaveLength(20);
    const ids = recoveryCorpus.map((c) => c.id);
    expect(new Set(ids).size).toBe(20);
  });

  test("has 15 verified, 2 unresolved, 3 incompatible", () => {
    const counts = { verified: 0, unresolved: 0, incompatible: 0 };
    for (const c of recoveryCorpus) counts[c.expected] += 1;
    expect(counts.verified).toBe(15);
    expect(counts.unresolved).toBe(2);
    expect(counts.incompatible).toBe(3);
  });

  test("preservePaths are unrelated files that actually changed", () => {
    for (const c of recoveryCorpus) {
      for (const p of c.preservePaths) {
        expect(Object.hasOwn(c.failed.files, p)).toBe(true);
        const before = Object.hasOwn(c.good.files, p)
          ? c.good.files[p]
          : undefined;
        const after = Object.hasOwn(c.failed.files, p)
          ? c.failed.files[p]
          : undefined;
        expect(before).not.toBe(after);
      }
      if (c.expected === "verified") {
        expect(c.preservePaths.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test("good roots exist in good file maps", () => {
    for (const c of recoveryCorpus) {
      expect(Object.hasOwn(c.good.files, c.good.mainFile)).toBe(true);
    }
  });

  test("expectedPath actually differs between good and failed", () => {
    for (const c of recoveryCorpus) {
      if (c.expectedPath === undefined) continue;
      const before = Object.hasOwn(c.good.files, c.expectedPath)
        ? c.good.files[c.expectedPath]
        : undefined;
      const after = Object.hasOwn(c.failed.files, c.expectedPath)
        ? c.failed.files[c.expectedPath]
        : undefined;
      expect(before).not.toBe(after);
    }
  });

  test("verified cases keep a stable main root", () => {
    for (const c of recoveryCorpus) {
      if (c.expected !== "verified") continue;
      expect(c.failed.mainFile).toBe(c.good.mainFile);
      expect(c.expectedPath).toBeDefined();
    }
  });
});
