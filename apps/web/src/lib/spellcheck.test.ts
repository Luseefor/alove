import { describe, expect, it } from "vitest";
import {
  extractProseTokens,
  getBaseDictionary,
  maskLatexProse,
  normalizeCustomWord,
  suggestCorrections,
} from "@alove/editor";
import {
  checkSpelling,
  sanitizeCustomWords,
} from "@/lib/spellcheck";

describe("extractProseTokens", () => {
  it("extracts prose but skips command names", () => {
    const tokens = extractProseTokens("\\section{Introduction} hello");
    const words = tokens.map((t) => t.word);
    expect(words).toContain("Introduction");
    expect(words).toContain("hello");
    expect(words).not.toContain("section");
  });

  it("skips math, cite keys, labels, urls and comments", () => {
    const doc = [
      "The quick brown fox.",
      "% \\label{sec:commented} commented",
      "\\cite{einstein1905} and \\ref{sec:intro}",
      "Inline $x^2 + \\alpha$ math.",
      "Visit https://example.com/path for more.",
      "\\begin{verbatim}\ncodez with mispelledd\n\\end{verbatim}",
      "\\url{https://example.com} done",
    ].join("\n");
    const words = extractProseTokens(doc).map((t) => t.word.toLowerCase());
    expect(words).toContain("quick");
    expect(words).not.toContain("cite");
    expect(words).not.toContain("einstein1905");
    expect(words).not.toContain("sec");
    expect(words).not.toContain("alpha");
    expect(words).not.toContain("example");
    expect(words).not.toContain("mispelledd");
  });

  it("keeps offsets aligned to the source", () => {
    const doc = "hello world";
    const tokens = extractProseTokens(doc);
    expect(doc.slice(tokens[0]!.from, tokens[0]!.to)).toBe("hello");
    expect(doc.slice(tokens[1]!.from, tokens[1]!.to)).toBe("world");
  });
});

describe("findMisspellings", () => {
  it("flags prose misspellings with suggestions", () => {
    const hits = checkSpelling("The teh recieve speling occured.");
    const flagged = hits.map((h) => h.word.toLowerCase());
    expect(flagged).toContain("teh");
    expect(flagged).toContain("recieve");
    // Sentence-final words (before `.`) are checkable, not path fragments.
    expect(flagged).toContain("occured");
    const teh = hits.find((h) => h.word.toLowerCase() === "teh");
    expect(teh?.suggestions.map((s) => s.toLowerCase())).toContain("the");
    const recieve = hits.find((h) => h.word.toLowerCase() === "recieve");
    expect(recieve?.suggestions.map((s) => s.toLowerCase())).toContain(
      "receive",
    );
  });

  it("does not flag correct prose or LaTeX machinery", () => {
    const hits = checkSpelling(
      "The quick brown fox jumps over the lazy dog.\n\\section{Introduction}\nSee \\cite{knuth1984} and $x$.",
    );
    expect(hits).toHaveLength(0);
  });

  it("honors custom words and session ignore lists", () => {
    const doc = "The TehCustomWord appears here.";
    expect(checkSpelling(doc).map((h) => h.word)).toContain("TehCustomWord");
    expect(
      checkSpelling(doc, { customWords: ["tehcustomword"] }),
    ).toHaveLength(0);
    expect(
      checkSpelling(doc, { ignoreWords: ["TehCustomWord"] }),
    ).toHaveLength(0);
  });
});

describe("suggestCorrections", () => {
  it("ranks close dictionary words first", () => {
    const dict = getBaseDictionary();
    expect(
      suggestCorrections("teh", dict, 5).map((s) => s.toLowerCase()),
    ).toContain("the");
    expect(
      suggestCorrections("speling", dict, 3).map((s) => s.toLowerCase()),
    ).toContain("spelling");
  });
});

describe("maskLatexProse offsets", () => {
  const doc =
    "See \\href{https://example.com}{a link here} with teh eror after.\n" +
    "Cost \\$5 and \\$10 today.\n" +
    "See \\verb|100%| and teh again.\n" +
    "\\begin{itemize}\n\\item hello world\n\\end{itemize}\n";

  it("preserves document length through every masking branch", () => {
    expect(maskLatexProse(doc).length).toBe(doc.length);
  });

  it("keeps href prose at original positions and later offsets exact", () => {
    const tokens = extractProseTokens(doc);
    const byWord = new Map(tokens.map((t) => [t.word, t]));
    // Href display text stays checkable at its source offset.
    expect(doc.slice(byWord.get("link")!.from, byWord.get("link")!.to)).toBe(
      "link",
    );
    expect(byWord.get("link")!.from).toBe(doc.indexOf("link"));
    // Misspellings after the href slice back to the exact source words.
    const hits = checkSpelling(doc);
    for (const hit of hits) {
      expect(doc.slice(hit.from, hit.to)).toBe(hit.word);
    }
    expect(hits.map((h) => h.word)).toContain("teh");
    // URL payload and command wrapper contribute no tokens.
    expect(byWord.has("example")).toBe(false);
    expect(byWord.has("href")).toBe(false);
  });

  it("treats escaped dollars as literal text, not math delimiters", () => {
    const tokens = extractProseTokens(doc).map((t) => t.word);
    // `and` between \$5 and \$10 must survive (previously paired as math).
    expect(tokens).toContain("and");
    expect(tokens).toContain("today");
  });

  it("keeps prose after inline verbatim containing a percent sign", () => {
    const tokens = extractProseTokens(doc);
    const teh = tokens.filter((t) => t.word === "teh");
    expect(teh).toHaveLength(2);
    for (const t of teh) {
      expect(doc.slice(t.from, t.to)).toBe("teh");
    }
  });

  it("blanks environment names while keeping item prose", () => {
    const words = extractProseTokens(doc).map((t) => t.word);
    expect(words).not.toContain("itemize");
    expect(words).toContain("hello");
  });
});

describe("dictionary helpers", () => {
  it("normalizes custom words", () => {
    expect(normalizeCustomWord("  TeXWorks ")).toBe("texworks");
    expect(normalizeCustomWord("x")).toBe("");
    expect(normalizeCustomWord("123")).toBe("");
  });

  it("sanitizes persisted custom-word lists", () => {
    expect(sanitizeCustomWords([" Beta ", "alpha", "ALPHA", "x"])).toEqual([
      "alpha",
      "beta",
    ]);
  });
});
