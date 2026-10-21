import fs from "node:fs";
import path from "node:path";
import NSpell from "nspell";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkDocument,
  createWordListChecker,
  loadEnglishChecker,
  resetSpellcheckServiceForTests,
  type SpellChecker,
} from "@/lib/spellcheckService";

const EN_DIR = path.join(__dirname, "../../public/dictionaries/en");

function loadRealChecker(): SpellChecker {
  const aff = fs.readFileSync(path.join(EN_DIR, "index.aff"), "utf8");
  const dic = fs.readFileSync(path.join(EN_DIR, "index.dic"), "utf8");
  const engine = NSpell(aff, dic);
  return {
    correct: (word) =>
      engine.correct(word) || engine.correct(word.toLowerCase()),
    suggest: (word, max = 3) => engine.suggest(word).slice(0, max ?? 3),
  };
}

describe("spellcheckService with dictionary-en", () => {
  it("serves affix + dictionary assets with provenance and license", () => {
    expect(fs.existsSync(path.join(EN_DIR, "index.aff"))).toBe(true);
    expect(fs.existsSync(path.join(EN_DIR, "index.dic"))).toBe(true);
    expect(fs.existsSync(path.join(EN_DIR, "LICENSE.txt"))).toBe(true);
    const provenance = fs.readFileSync(
      path.join(EN_DIR, "PROVENANCE.txt"),
      "utf8",
    );
    expect(provenance).toContain("dictionary-en");
  });

  it("handles affix expansions, not just stems", () => {
    const checker = loadRealChecker();
    // Valid only through Hunspell affix rules (absent as raw stems).
    const dic = fs.readFileSync(path.join(EN_DIR, "index.dic"), "utf8");
    const stems = new Set(
      dic.split("\n").slice(1).map((l) => l.split("/")[0]!.toLowerCase()),
    );
    expect(stems.has("happier")).toBe(false);
    expect(checker.correct("happier")).toBe(true);
    expect(stems.has("nationalities")).toBe(false);
    expect(checker.correct("nationalities")).toBe(true);
  });

  it("flags real misspellings and offers the intended word", () => {
    const checker = loadRealChecker();
    const hits = checkDocument("The teh recieve speling occured.", checker);
    const flagged = hits.map((h) => h.word.toLowerCase());
    expect(flagged).toEqual(
      expect.arrayContaining(["teh", "recieve", "speling", "occured"]),
    );
    const byWord = new Map(hits.map((h) => [h.word.toLowerCase(), h]));
    expect(
      byWord.get("recieve")!.suggestions.map((s) => s.toLowerCase()),
    ).toContain("receive");
    expect(
      byWord.get("speling")!.suggestions.map((s) => s.toLowerCase()),
    ).toContain("spelling");
    expect(
      byWord.get("occured")!.suggestions.map((s) => s.toLowerCase()),
    ).toContain("occurred");
    // Offsets slice back to source words.
    for (const hit of hits) {
      expect("The teh recieve speling occured.".slice(hit.from, hit.to)).toBe(
        hit.word,
      );
    }
  });

  it("leaves correct academic prose unflagged", () => {
    const checker = loadRealChecker();
    expect(
      checkDocument(
        "The quick brown fox jumps over the lazy dog.\n\\section{Introduction}\nSee \\cite{knuth1984} and $x$.",
        checker,
      ),
    ).toHaveLength(0);
  });

  it("layers the personal dictionary over the full engine", () => {
    const checker = loadRealChecker();
    const doc = "The TehCustomWord appears here.";
    expect(checkDocument(doc, checker).length).toBeGreaterThan(0);
    expect(
      checkDocument(doc, checker, { customWords: ["tehcustomword"] }),
    ).toHaveLength(0);
  });

  it("bounds misspelling counts", () => {
    const alpha = Array.from({ length: 50 }, (_, i) =>
      `zzq${"abcdefghij"[i % 10]}xx`,
    ).join(" ");
    const hits = checkDocument(alpha, loadRealChecker(), {
      maxMisspellings: 5,
    });
    expect(hits.length).toBeLessThanOrEqual(5);
  });
});

describe("createWordListChecker (test seam)", () => {
  it("checks and suggests over an explicit list", () => {
    const checker = createWordListChecker(["the", "then", "ten"]);
    expect(checker.correct("The")).toBe(true);
    expect(checker.correct("teh")).toBe(false);
    expect(checker.suggest("teh", 3)).toContain("the");
  });
});

describe("loadEnglishChecker", () => {
  beforeEach(() => {
    resetSpellcheckServiceForTests();
    vi.unstubAllGlobals();
  });

  it("lazy-loads once and shares the in-flight promise", async () => {
    const aff = fs.readFileSync(path.join(EN_DIR, "index.aff"), "utf8");
    const dic = fs.readFileSync(path.join(EN_DIR, "index.dic"), "utf8");
    const fetchMock = vi.fn(async (url: string) => {
      await new Promise((r) => setTimeout(r, 5));
      return {
        ok: true,
        text: async () => (String(url).endsWith(".aff") ? aff : dic),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const [first, second] = await Promise.all([
      loadEnglishChecker(),
      loadEnglishChecker(),
    ]);
    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(2); // one aff + one dic fetch
    expect(first.correct("the")).toBe(true);
    // Ranked corrections surface the intended word, not just engine order.
    expect(first.suggest("teh", 4).map((s) => s.toLowerCase())).toContain(
      "the",
    );
    expect(first.suggest("recieve", 3)[0]?.toLowerCase()).toBe("receive");
  });

  it("surfaces fetch failures and allows retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(loadEnglishChecker()).rejects.toThrow("offline");
    const aff = fs.readFileSync(path.join(EN_DIR, "index.aff"), "utf8");
    const dic = fs.readFileSync(path.join(EN_DIR, "index.dic"), "utf8");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        text: async () => (String(url).endsWith(".aff") ? aff : dic),
      })),
    );
    const checker = await loadEnglishChecker();
    expect(checker.correct("the")).toBe(true);
  });
});
