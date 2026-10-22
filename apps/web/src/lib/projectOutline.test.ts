import { describe, expect, it } from "vitest";
import {
  buildProjectOutline,
  PROJECT_OUTLINE_MAX_HEADINGS,
  PROJECT_OUTLINE_MAX_INCLUDEONLY,
  PROJECT_OUTLINE_MAX_TITLE_CHARS,
  PROJECT_OUTLINE_MAX_TOTAL_CHARS,
} from "./projectOutline";

describe("projectOutline basic headings", () => {
  it("parses all heading levels with star and short title", () => {
    const files = {
      "main.tex": [
        "\\section{Intro}",
        "\\subsection{Back}",
        "\\subsubsection{Deep}",
        "\\paragraph{Para}",
        "\\subparagraph{Sub}",
        "\\part{Top}",
        "\\chapter{Chap}",
        "\\section*{Starred}",
        "\\section[Short]{Long Title}",
      ].join("\n"),
    };
    const out = buildProjectOutline(files, "main.tex");
    expect(out.limited).toBe(false);
    expect(out.warnings).toEqual([]);
    expect(out.headings.map((h) => h.title)).toEqual([
      "Intro",
      "Back",
      "Deep",
      "Para",
      "Sub",
      "Top",
      "Chap",
      "Starred",
      "Long Title",
    ]);
    expect(out.headings.map((h) => h.level)).toEqual([2, 3, 4, 5, 6, 0, 1, 2, 2]);
    expect(out.headings.map((h) => h.line)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const h of out.headings) {
      expect(files["main.tex"].slice(h.from, h.to)).toContain("\\");
      expect(h.from).toBeGreaterThanOrEqual(0);
      expect(h.to).toBeGreaterThan(h.from);
      expect(h.to).toBeLessThanOrEqual(files["main.tex"].length);
    }
    const ids = out.headings.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("cleans formatted titles with nested braces", () => {
    const files = { "main.tex": "\\section{Intro to \\textbf{Bold} and \\emph{it}}\n\\section{A \\frac{1}{2} B}" };
    const out = buildProjectOutline(files, "main.tex");
    expect(out.headings[0]?.title).toBe("Intro to Bold and it");
    expect(out.headings[1]?.title).toBe("A 1 2 B");
  });

  it("skips comments, verbatim, verb and macro definitions and fake commands", () => {
    const files = {
      "main.tex": [
        "% \\section{Commented}",
        "\\section{Real}",
        "\\begin{verbatim}",
        "\\section{Verbatim}",
        "\\end{verbatim}",
        "Text \\verb|\\section{Verb}| more",
        "\\newcommand{\\foo}{\\section{Macro}}",
        "\\sectioning{Fake}",
        "\\mysection{Fake2}",
        "\\subsection{Also Real}",
      ].join("\n"),
    };
    const out = buildProjectOutline(files, "main.tex");
    expect(out.headings.map((h) => h.title)).toEqual(["Real", "Also Real"]);
  });

  it("handles escaped percent and preserves CRLF offsets exactly", () => {
    const content = "a\r\n\\section{T \\% ok}\r\nnext \u00e9\ud83d\ude00";
    const files = { "main.tex": content };
    const out = buildProjectOutline(files, "main.tex");
    expect(out.headings).toHaveLength(1);
    const h = out.headings[0]!;
    expect(h.line).toBe(2);
    expect(content.slice(h.from, h.to)).toBe("\\section{T \\% ok}");
    expect(h.title).toBe("T % ok");
    expect(content.slice(h.from, h.from + 9)).toBe("\\section{");
    // Unicode offsets are UTF-16 code units.
    expect(content.length).toBeGreaterThan(h.to);
  });
});

describe("projectOutline multi-file includes", () => {
  const paper = {
    "main.tex": [
      "\\documentclass{article}",
      "\\begin{document}",
      "\\section{Overview}",
      "\\input{sections/intro}",
      "\\include{sections/results}",
      "\\input{sections/missing}",
      "\\end{document}",
    ].join("\n"),
    "sections/intro.tex": "\\section{Introduction}\nIntro prose.\n\\input{sections/detail}\n",
    "sections/detail.tex": "\\subsection{Detail}\nDetail prose.\n",
    "sections/results.tex": "\\section{Results}\nResults prose.\n",
    "unused.tex": "\\section{Not included}",
  };

  it("follows includes in document order and warns on missing", () => {
    const out = buildProjectOutline(paper, "main.tex");
    expect(out.headings.map((h) => h.title)).toEqual(["Overview", "Introduction", "Detail", "Results"]);
    expect(out.headings.map((h) => h.path)).toEqual([
      "main.tex",
      "sections/intro.tex",
      "sections/detail.tex",
      "sections/results.tex",
    ]);
    expect(out.headings.every((h) => h.id.length > 0)).toBe(true);
    expect(new Set(out.headings.map((h) => h.id)).size).toBe(4);
    expect(out.warnings.some((w) => w.message.includes("sections/missing"))).toBe(true);
    expect(out.headings.some((h) => h.title === "Not included")).toBe(false);
  });

  it("resolves .tex fallback and including-dir fallback without traversal", () => {
    const files = {
      "main.tex": "\\input{ch1}\n\\input{../evil}\n",
      "ch1.tex": "\\section{One}",
    };
    const out = buildProjectOutline(files, "main.tex");
    expect(out.headings.map((h) => h.title)).toEqual(["One"]);
    expect(out.warnings.some((w) => w.message.includes("../evil"))).toBe(true);

    const nested = {
      "main.tex": "\\input{ch/a}\n",
      "ch/a.tex": "\\input{b}\n\\section{A}",
      "ch/b.tex": "\\section{B}",
    };
    const out2 = buildProjectOutline(nested, "main.tex");
    // b resolves via including-dir ch/ even though root b.tex is missing.
    expect(out2.headings.map((h) => h.title)).toEqual(["B", "A"]);
  });

  it("allows repeats with unique ids but guards cycles", () => {
    const files = {
      "main.tex": "\\input{a}\n\\input{a}\n",
      "a.tex": "\\section{A}",
    };
    const out = buildProjectOutline(files, "main.tex");
    expect(out.headings).toHaveLength(2);
    expect(out.headings[0]?.path).toBe("a.tex");
    expect(out.headings[1]?.path).toBe("a.tex");
    expect(out.headings[0]?.id).not.toBe(out.headings[1]?.id);

    const cyclic = {
      "main.tex": "\\section{Root}\n\\input{a}\n",
      "a.tex": "\\section{A}\n\\input{b}\n",
      "b.tex": "\\section{B}\n\\input{a}\n",
    };
    const cyc = buildProjectOutline(cyclic, "main.tex");
    expect(cyc.headings.map((h) => h.title)).toEqual(["Root", "A", "B"]);
    expect(cyc.warnings.some((w) => w.message.toLowerCase().includes("cycl"))).toBe(true);
  });

  it("warns on dynamic includes instead of hanging", () => {
    const files = { "main.tex": "\\section{Ok}\n\\input{\\foo}\n\\input{a#b}\n" };
    const out = buildProjectOutline(files, "main.tex");
    expect(out.headings.map((h) => h.title)).toEqual(["Ok"]);
    expect(out.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("only scans root body when markers exist; fragments allowed", () => {
    const files = {
      "main.tex": "\\newcommand{\\x}{\\section{Preamble}}\n\\begin{document}\n\\section{Body}\n\\end{document}\n\\section{Post}",
      "frag.tex": "\\section{Frag}",
    };
    const out = buildProjectOutline({ ...files, "main.tex": `${files["main.tex"]}\n\\input{frag}` }, "main.tex");
    // Preamble/postamble headings ignored; body + fragment included.
    // Note: \input after \end{document} is outside the body so it is ignored too.
    expect(out.headings.map((h) => h.title)).toEqual(["Body"]);

    const noMarkers = {
      "main.tex": "\\section{Top}\n\\input{frag}\n",
      "frag.tex": "\\section{Frag}",
    };
    const out2 = buildProjectOutline(noMarkers, "main.tex");
    expect(out2.headings.map((h) => h.title)).toEqual(["Top", "Frag"]);
  });
});

describe("projectOutline includeonly", () => {
  it("respects includeonly for \\include but not \\input", () => {
    const files = {
      "main.tex": "\\includeonly{keep}\n\\begin{document}\n\\include{keep}\n\\include{skip}\n\\input{always}\n\\end{document}",
      "keep.tex": "\\section{Keep}",
      "skip.tex": "\\section{Skip}",
      "always.tex": "\\section{Always}",
    };
    const out = buildProjectOutline(files, "main.tex");
    expect(out.headings.map((h) => h.title).sort()).toEqual(["Always", "Keep"]);
  });

  it("warns on dynamic includeonly and includes everything", () => {
    const files = {
      "main.tex": "\\includeonly{\\foo}\n\\begin{document}\n\\include{a}\n\\end{document}",
      "a.tex": "\\section{A}",
    };
    const out = buildProjectOutline(files, "main.tex");
    expect(out.headings.map((h) => h.title)).toEqual(["A"]);
    expect(out.warnings.some((w) => w.message.includes("includeonly"))).toBe(true);
  });
});

describe("projectOutline bounds and determinism", () => {
  it("caps headings with limited flag", () => {
    const many = Array.from({ length: PROJECT_OUTLINE_MAX_HEADINGS + 50 }, (_, i) => `\\section{S${i}}`).join("\n");
    const out = buildProjectOutline({ "main.tex": many }, "main.tex");
    expect(out.headings.length).toBe(PROJECT_OUTLINE_MAX_HEADINGS);
    expect(out.limited).toBe(true);
  });

  it("returns a warning for missing main file without hanging", () => {
    const out = buildProjectOutline({}, "main.tex");
    expect(out.headings).toEqual([]);
    expect(out.warnings.length).toBe(1);
    expect(out.limited).toBe(false);
  });

  it("is deterministic across runs and does not mutate input", () => {
    const files = {
      "main.tex": "\\section{B}\n\\input{b}\n\\section{A}\n",
      "b.tex": "\\subsection{Mid}",
    };
    const snapshot = JSON.stringify(files);
    const first = buildProjectOutline(files, "main.tex");
    const second = buildProjectOutline(files, "main.tex");
    expect(second).toEqual(first);
    expect(JSON.stringify(files)).toBe(snapshot);
  });

  it("terminates on pathological nesting without hanging", () => {
    const files: Record<string, string> = { "main.tex": "\\input{a}\n" };
    for (let i = 0; i < 60; i += 1) {
      files[i === 0 ? "a.tex" : `f${i}.tex`] = `\\input(f${i + 1})\n\\input{f${i + 1}}\n\\section{S${i}}\n`;
    }
    const start = Date.now();
    const out = buildProjectOutline(files, "main.tex");
    expect(Date.now() - start).toBeLessThan(5000);
    expect(out.limited || out.warnings.length > 0 || out.headings.length >= 0).toBe(true);
  });
});

describe("projectOutline review fixes", () => {
  it("skips fake begin/end markers inside macro and group args", () => {
    const fakeBegin = {
      "main.tex": "\\newcommand{\\x}{\\begin{document}\\section{Fake}}\n\\begin{document}\n\\section{Real}\n\\end{document}\n",
    };
    expect(buildProjectOutline(fakeBegin, "main.tex").headings.map((h) => h.title)).toEqual(["Real"]);

    const fakeBeginGroup = {
      "main.tex": "{\\begin{document}}\n\\begin{document}\n\\section{Real}\n\\end{document}\n",
    };
    expect(buildProjectOutline(fakeBeginGroup, "main.tex").headings.map((h) => h.title)).toEqual(["Real"]);

    const fakeEnd = {
      "main.tex":
        "\\begin{document}\n\\section{Real}\n\\newcommand{\\x}{\\end{document}}\n\\section{AlsoReal}\n\\end{document}\n\\section{Post}\n",
    };
    expect(buildProjectOutline(fakeEnd, "main.tex").headings.map((h) => h.title)).toEqual([
      "Real",
      "AlsoReal",
    ]);
  });

  it("skips fake includeonly inside macro and group args", () => {
    const files = {
      "main.tex":
        "\\newcommand{\\x}{\\includeonly{skip}}\n{\\includeonly{skip}}\n\\begin{document}\n\\include{keep}\n\\include{skip}\n\\end{document}",
      "keep.tex": "\\section{Keep}",
      "skip.tex": "\\section{Skip}",
    };
    const out = buildProjectOutline(files, "main.tex");
    expect(out.headings.map((h) => h.title).sort()).toEqual(["Keep", "Skip"]);
    expect(out.warnings.some((w) => w.message.includes("includeonly"))).toBe(false);
  });

  it("caps an oversize root before prepasses with limited flag", () => {
    const big = `\\begin{document}\n${"x".repeat(PROJECT_OUTLINE_MAX_TOTAL_CHARS + 1)}\n\\end{document}`;
    const start = Date.now();
    const out = buildProjectOutline({ "main.tex": big }, "main.tex");
    expect(Date.now() - start).toBeLessThan(5000);
    expect(out.limited).toBe(true);
    expect(out.headings).toEqual([]);
    expect(out.warnings.some((w) => w.message.includes("too large"))).toBe(true);
  });

  it("rejects absolute /foo include paths instead of stripping", () => {
    const files = {
      "main.tex": "\\input{/abs}\n\\section{Top}\n",
      "abs.tex": "\\section{Abs}",
    };
    const out = buildProjectOutline(files, "main.tex");
    expect(out.headings.map((h) => h.title)).toEqual(["Top"]);
    expect(out.warnings.some((w) => w.message.includes("/abs") && w.message.includes("outside"))).toBe(true);
  });

  it("rejects absolute /foo includeonly entries instead of stripping", () => {
    const files = {
      "main.tex": "\\includeonly{/keep}\n\\begin{document}\n\\include{keep}\n\\end{document}",
      "keep.tex": "\\section{Keep}",
    };
    const out = buildProjectOutline(files, "main.tex");
    expect(out.warnings.some((w) => w.message.includes("/keep"))).toBe(true);
    expect(out.headings.map((h) => h.title)).toEqual([]);
  });
});

describe("projectOutline latest review", () => {
  it("last includeonly wins instead of union", () => {
    const files = {
      "main.tex":
        "\\includeonly{keep}\n\\includeonly{skip}\n\\begin{document}\n\\include{keep}\n\\include{skip}\n\\end{document}",
      "keep.tex": "\\section{Keep}",
      "skip.tex": "\\section{Skip}",
    };
    expect(buildProjectOutline(files, "main.tex").headings.map((h) => h.title)).toEqual(["Skip"]);

    const dynamicLast = {
      "main.tex":
        "\\includeonly{keep}\n\\includeonly{\\foo}\n\\begin{document}\n\\include{keep}\n\\include{skip}\n\\end{document}",
      "keep.tex": "\\section{Keep}",
      "skip.tex": "\\section{Skip}",
    };
    const out = buildProjectOutline(dynamicLast, "main.tex");
    expect(out.headings.map((h) => h.title).sort()).toEqual(["Keep", "Skip"]);
    expect(out.warnings.some((w) => w.message.includes("includeonly"))).toBe(true);
  });

  it("caps includeonly occurrences with limited flag and includes all", () => {
    const many = Array.from({ length: PROJECT_OUTLINE_MAX_INCLUDEONLY + 20 }, () => "\\includeonly{skip}").join("\n");
    const files = {
      "main.tex": `${many}\n\\begin{document}\n\\include{keep}\n\\include{skip}\n\\end{document}`,
      "keep.tex": "\\section{Keep}",
      "skip.tex": "\\section{Skip}",
    };
    const start = Date.now();
    const out = buildProjectOutline(files, "main.tex");
    expect(Date.now() - start).toBeLessThan(5000);
    expect(out.limited).toBe(true);
    expect(out.warnings.some((w) => w.message.includes("too many"))).toBe(true);
    // Capped filtering is ignored rather than pretending: both includes resolve.
    expect(out.headings.map((h) => h.title).sort()).toEqual(["Keep", "Skip"]);
  });

  it("never throws on unsafe names and bounds title rendering", () => {
    expect(() => buildProjectOutline({}, "")).not.toThrow();
    expect(() => buildProjectOutline({}, "/abs.tex")).not.toThrow();
    expect(() => buildProjectOutline({}, "__proto__")).not.toThrow();
    expect(() => buildProjectOutline(null as unknown as Record<string, string>, "main.tex")).not.toThrow();
    expect(() => buildProjectOutline({ "main.tex": 123 as unknown as string }, "main.tex")).not.toThrow();
    expect(buildProjectOutline({}, "__proto__").headings).toEqual([]);

    const longTitle = `\\section{${"A".repeat(5000)}}`;
    const out = buildProjectOutline({ "main.tex": longTitle }, "main.tex");
    expect(out.headings).toHaveLength(1);
    expect(out.headings[0]!.title.length).toBeLessThanOrEqual(PROJECT_OUTLINE_MAX_TITLE_CHARS);
    expect(out.headings[0]!.title.endsWith("…")).toBe(true);
    // Offsets stay exact even though the rendered title is bounded.
    expect(out.headings[0]!.to - out.headings[0]!.from).toBeGreaterThan(5000);

    const emojiTitle = `\\section{${"😀".repeat(1000)}}`;
    const emojiOut = buildProjectOutline({ "main.tex": emojiTitle }, "main.tex");
    expect(emojiOut.headings[0]!.title.length).toBeLessThanOrEqual(PROJECT_OUTLINE_MAX_TITLE_CHARS);
    const lastCu = emojiOut.headings[0]!.title.charCodeAt(emojiOut.headings[0]!.title.length - 2);
    expect(lastCu >= 0xd800 && lastCu <= 0xdbff).toBe(false);

    const hugeInclude = { "main.tex": `\\section{Top}\n\\input{${"a".repeat(5000)}}\n` };
    const hugeOut = buildProjectOutline(hugeInclude, "main.tex");
    expect(hugeOut.headings.map((h) => h.title)).toEqual(["Top"]);
    expect(hugeOut.warnings.length).toBeGreaterThan(0);
    for (const w of hugeOut.warnings) expect(w.message.length).toBeLessThan(600);
  });
});
