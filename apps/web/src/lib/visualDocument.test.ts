import { describe, expect, it } from "vitest";
import { parseVisualDocument } from "@alove/editor";

function slices(source: string, ranges: { from: number; to: number }[]) {
  return ranges.map((r) => source.slice(r.from, r.to));
}

function expectBounds(source: string) {
  const doc = parseVisualDocument(source);
  for (const r of [
    ...doc.hidden,
    ...doc.marks,
    ...doc.protected,
    ...doc.literals,
    doc.body,
  ]) {
    expect(r.from).toBeGreaterThanOrEqual(0);
    expect(r.to).toBeLessThanOrEqual(source.length);
    expect(r.to).toBeGreaterThanOrEqual(r.from);
  }
  return doc;
}

describe("visualDocument projection", () => {
  it("leaves plain prose editable with whole body", () => {
    const src = "hello";
    const doc = expectBounds(src);
    expect(doc.body).toEqual({ from: 0, to: 5 });
    expect(doc.hidden).toEqual([]);
    expect(doc.marks).toEqual([]);
    expect(doc.headings).toEqual([]);
    expect(doc.protected).toEqual([]);
    expect(doc.literals).toEqual([]);
    expect(doc.limited).toBe(false);
  });

  it("hides section wrappers and reports a line-start heading", () => {
    const src = "\\section{Intro}";
    const doc = expectBounds(src);
    expect(doc.hidden).toEqual([
      { from: 0, to: 9 },
      { from: 14, to: 15 },
    ]);
    expect(slices(src, doc.hidden)).toEqual(["\\section{", "}"]);
    expect(doc.headings).toEqual([{ from: 0, level: 1 }]);
    expect(doc.protected).toEqual(doc.hidden);
    expect(doc.body).toEqual({ from: 0, to: 15 });
  });

  it("maps subsection levels and starred headings", () => {
    const levels = parseVisualDocument(
      "\\section{A}\n\\subsection{B}\n\\subsubsection{C}",
    );
    expect(levels.headings.map((h) => h.level)).toEqual([1, 2, 3]);
    expect(levels.hidden).toHaveLength(6);
    expect(levels.protected).toEqual(levels.hidden);

    const starred = parseVisualDocument("\\section*{Star}");
    expect(starred.headings).toEqual([{ from: 0, level: 1 }]);
    expect(slices("\\section*{Star}", starred.hidden)).toEqual([
      "\\section*{",
      "}",
    ]);
  });

  it("falls back to fully protected when a heading has an optional arg", () => {
    const src = "\\section[short]{Intro}";
    const doc = expectBounds(src);
    expect(doc.hidden).toEqual([]);
    expect(doc.headings).toEqual([]);
    expect(doc.marks).toEqual([]);
    expect(doc.protected).toEqual([{ from: 0, to: src.length }]);
  });

  it("nests bold and italic marks with hidden wrappers", () => {
    const src = "\\textbf{A \\textit{B}}";
    const doc = expectBounds(src);
    expect(doc.hidden).toEqual([
      { from: 0, to: 8 },
      { from: 10, to: 18 },
      { from: 19, to: 20 },
      { from: 20, to: 21 },
    ]);
    expect(slices(src, doc.hidden)).toEqual([
      "\\textbf{",
      "\\textit{",
      "}",
      "}",
    ]);
    expect(doc.marks).toEqual([
      { from: 8, to: 20, kind: "bold" },
      { from: 18, to: 19, kind: "italic" },
    ]);
  });

  it("treats emph as italic and starred bold as protected fallback", () => {
    const src = "\\emph{hey} and \\textit{yo}";
    const doc = expectBounds(src);
    expect(doc.marks).toEqual([
      { from: 6, to: 9, kind: "italic" },
      { from: 23, to: 25, kind: "italic" },
    ]);
    expect(doc.hidden).toHaveLength(4);

    const starred = parseVisualDocument("\\textbf*{x}");
    expect(starred.hidden).toEqual([]);
    expect(starred.marks).toEqual([]);
    expect(starred.protected).toEqual([
      { from: 0, to: 8 },
      { from: 8, to: 11 },
    ]);
  });

  it("renders literal escapes as protected literals never hidden", () => {
    const src =
      "\\%\\&\\#\\_\\$\\{\\} \\textbackslash{} \\textasciitilde{} \\textasciicircum{}";
    const doc = expectBounds(src);
    expect(doc.hidden).toEqual([]);
    expect(doc.literals.map((l) => l.text)).toEqual([
      "%",
      "&",
      "#",
      "_",
      "$",
      "{",
      "}",
      "\\",
      "~",
      "^",
    ]);
    for (const lit of doc.literals) {
      expect(
        doc.protected.some((p) => p.from <= lit.from && p.to >= lit.to),
      ).toBe(true);
      expect(doc.hidden.some((h) => lit.from >= h.from && lit.to <= h.to)).toBe(
        false,
      );
    }
    // No braces variant falls back without a literal.
    const bare = parseVisualDocument("\\textbackslash ok");
    expect(bare.literals).toEqual([]);
    expect(bare.protected).toEqual([{ from: 0, to: 14 }]);
  });

  it("protects comments while escaped percent stays a literal", () => {
    const src = "a \\% b % c\nnext";
    const doc = expectBounds(src);
    expect(doc.literals).toEqual([{ from: 2, to: 4, text: "%" }]);
    expect(doc.protected).toEqual([
      { from: 2, to: 4 },
      { from: 7, to: 10 },
    ]);
    expect(src.slice(7, 10)).toBe("% c");

    const leading = parseVisualDocument("% comment\nhello \\% world");
    expect(leading.protected).toEqual([
      { from: 0, to: 9 },
      { from: 16, to: 18 },
    ]);
  });

  it("hides document preamble and postamble and sets body bounds", () => {
    const full = parseVisualDocument(
      "\\begin{document}\nhello\n\\end{document}",
    );
    expect(full.hidden).toEqual([
      { from: 0, to: 16 },
      { from: 23, to: 37 },
    ]);
    expect(full.body).toEqual({ from: 16, to: 23 });
    expect(
      full.body && "\\begin{document}\nhello\n\\end{document}".slice(16, 23),
    ).toBe("\nhello\n");

    const beginOnly = parseVisualDocument("\\begin{document} only-begin");
    expect(beginOnly.hidden).toEqual([]);
    expect(beginOnly.body).toEqual({ from: 0, to: 0 });
    expect(beginOnly.limited).toBe(false);
    expect(beginOnly.protected).toEqual([{ from: 0, to: 27 }]);

    const none = parseVisualDocument("hello");
    expect(none.hidden).toEqual([]);
    expect(none.body).toEqual({ from: 0, to: 5 });
  });

  it("parses inside itemize but keeps custom envs opaque", () => {
    const src = "\\begin{itemize}\n\\item A \\textbf{B}\n\\end{itemize}";
    const doc = expectBounds(src);
    expect(doc.hidden).toEqual([
      { from: 0, to: 15 },
      { from: 24, to: 32 },
      { from: 33, to: 34 },
      { from: 35, to: 48 },
    ]);
    expect(doc.items).toEqual([{ from: 16, to: 21, text: "•" }]);
    expect(doc.marks).toEqual([{ from: 32, to: 33, kind: "bold" }]);
    expect(doc.protected).toContainEqual({ from: 0, to: 15 });
    expect(doc.protected).toContainEqual({ from: 16, to: 21 });

    const custom = parseVisualDocument(
      "\\begin{custom}x \\textbf{y}\\end{custom}",
    );
    expect(custom.hidden).toEqual([]);
    expect(custom.marks).toEqual([]);
    expect(custom.protected).toEqual([{ from: 0, to: 38 }]);
  });

  it("keeps verbatim and listing envs opaque", () => {
    for (const src of [
      "\\begin{verbatim}\\textbf{x}\\end{verbatim}",
      "\\begin{minted}{js}x\\end{minted}",
    ]) {
      const doc = expectBounds(src);
      expect(doc.hidden).toEqual([]);
      expect(doc.marks).toEqual([]);
      expect(doc.headings).toEqual([]);
      expect(doc.protected).toEqual([{ from: 0, to: src.length }]);
    }
  });

  it("protects inline display and env math as opaque source", () => {
    const src = "$x+y$ and \\(a\\) and $$d$$";
    const doc = expectBounds(src);
    expect(doc.hidden).toEqual([]);
    expect(doc.marks).toEqual([]);
    expect(doc.protected).toEqual([
      { from: 0, to: 5 },
      { from: 10, to: 15 },
      { from: 20, to: 25 },
    ]);
    expect(slices(src, doc.protected)).toEqual(["$x+y$", "\\(a\\)", "$$d$$"]);

    const env = parseVisualDocument("\\begin{equation}x\\end{equation}");
    expect(env.protected).toEqual([{ from: 0, to: 31 }]);
    expect(env.marks).toEqual([]);
  });

  it("keeps verb single-line and stops malformed verb at line end", () => {
    const ok = parseVisualDocument("\\verb|x| ok");
    expect(ok.protected).toEqual([{ from: 0, to: 8 }]);
    expect(ok.hidden).toEqual([]);

    const broken = parseVisualDocument("\\verb|x\n\\textbf{B}");
    expect(broken.hidden).toEqual([]);
    expect(broken.marks).toEqual([]);
    expect(broken.body).toEqual({ from: 0, to: 0 });
    expect(broken.protected).toEqual([{ from: 0, to: 18 }]);
  });

  it("keeps unknown commands cite groups and stray markers visible but protected", () => {
    const cite = parseVisualDocument("\\cite{key} ok");
    expect(cite.hidden).toEqual([]);
    expect(cite.protected).toEqual([
      { from: 0, to: 5 },
      { from: 5, to: 10 },
    ]);

    const group = parseVisualDocument("a {group} b");
    expect(group.hidden).toEqual([]);
    expect(group.protected).toEqual([{ from: 2, to: 9 }]);

    const custom = parseVisualDocument("\\custom[opt]{arg} rest");
    expect(custom.hidden).toEqual([]);
    expect(custom.protected).toEqual([
      { from: 0, to: 7 },
      { from: 7, to: 12 },
      { from: 12, to: 17 },
    ]);

    const stray = parseVisualDocument("\\end{itemize} stray");
    expect(stray.hidden).toEqual([]);
    expect(stray.protected).toEqual([{ from: 0, to: 13 }]);
  });

  it("falls back to protected on malformed and unbalanced input", () => {
    const unclosed = parseVisualDocument("\\textbf{unclosed");
    expect(unclosed.hidden).toEqual([]);
    expect(unclosed.marks).toEqual([]);
    expect(unclosed.protected).toEqual([{ from: 0, to: 16 }]);

    const strayClose = parseVisualDocument("a } b");
    expect(strayClose.protected).toEqual([{ from: 2, to: 3 }]);

    const dollar = parseVisualDocument("$unclosed");
    expect(dollar.protected).toEqual([{ from: 0, to: 9 }]);

    const display = parseVisualDocument("\\[unclosed");
    expect(display.protected).toEqual([{ from: 0, to: 10 }]);

    const bareSection = parseVisualDocument("\\section");
    expect(bareSection.headings).toEqual([]);
    expect(bareSection.protected).toEqual([{ from: 0, to: 8 }]);

    const unclosedEnv = parseVisualDocument("\\begin{itemize}\nhello");
    expect(unclosedEnv.hidden).toEqual([]);
    expect(unclosedEnv.protected).toEqual([{ from: 0, to: 21 }]);

    const optBold = parseVisualDocument("\\textbf[opt]{x}");
    expect(optBold.hidden).toEqual([]);
    expect(optBold.marks).toEqual([]);
    expect(optBold.protected).toEqual([{ from: 0, to: 15 }]);
  });

  it("uses UTF-16 offsets across CRLF and Unicode and preserves bytes", () => {
    const src = "a\r\n\\section{T}\r\nb \u00e9\ud83d\ude00";
    expect(src.length).toBe(21);
    const doc = expectBounds(src);
    expect(doc.hidden).toEqual([
      { from: 3, to: 12 },
      { from: 13, to: 14 },
    ]);
    expect(doc.headings).toEqual([{ from: 3, level: 1 }]);
    expect(src.slice(3, 12)).toBe("\\section{");
    expect(src.slice(13, 14)).toBe("}");
    expect(src.slice(16, 17)).toBe("b");
    expect(src.slice(18, 19)).toBe("\u00e9");
    expect(src.slice(19, 21)).toBe("\ud83d\ude00");
  });

  it("keeps input and include directives protected and visible", () => {
    const single = parseVisualDocument("\\input{ch1} ok");
    expect(single.hidden).toEqual([]);
    expect(single.protected).toEqual([
      { from: 0, to: 6 },
      { from: 6, to: 11 },
    ]);

    const both = parseVisualDocument("\\include{ch1} and \\input{ch2}");
    expect(both.hidden).toEqual([]);
    expect(both.protected).toEqual([
      { from: 0, to: 8 },
      { from: 8, to: 13 },
      { from: 18, to: 24 },
      { from: 24, to: 29 },
    ]);
  });

  it("allows headings only at body top level", () => {
    const inBold = parseVisualDocument("\\textbf{\\section{No}}");
    expect(inBold.headings).toEqual([]);
    expect(inBold.marks).toEqual([{ from: 8, to: 20, kind: "bold" }]);

    const inGroup = parseVisualDocument("{\\section{No}}");
    expect(inGroup.headings).toEqual([]);
    expect(inGroup.hidden).toEqual([]);

    const inList = parseVisualDocument(
      "\\begin{itemize}\n\\section{No}\n\\end{itemize}",
    );
    expect(inList.headings).toEqual([]);
    expect(
      slices("\\begin{itemize}\n\\section{No}\n\\end{itemize}", inList.hidden),
    ).toEqual(["\\begin{itemize}", "\\end{itemize}"]);

    const inHeading = parseVisualDocument("\\section{A \\textbf{B}}");
    expect(inHeading.headings).toEqual([{ from: 0, level: 1 }]);
    expect(inHeading.marks).toEqual([{ from: 19, to: 20, kind: "bold" }]);
  });

  it("bounds work with limited output for oversize sources", () => {
    const big = "x".repeat(1024 * 1024 + 1);
    const bigDoc = parseVisualDocument(big);
    expect(bigDoc.limited).toBe(true);
    expect(bigDoc.hidden).toEqual([]);
    expect(bigDoc.marks).toEqual([]);
    expect(bigDoc.protected).toEqual([{ from: 0, to: big.length }]);

    const manyLines = Array(20001).fill("a").join("\n");
    const linesDoc = parseVisualDocument(manyLines);
    expect(linesDoc.limited).toBe(true);
    expect(linesDoc.protected).toEqual([{ from: 0, to: manyLines.length }]);
  });

  it("keeps every hidden range protected and preserves source bytes", () => {
    const src =
      "\\section{T}\n\\textbf{B} % c\n\\begin{itemize}\n\\item \\% ok\n\\end{itemize}";
    const before = src;
    const doc = expectBounds(src);
    expect(src).toBe(before);
    expect(doc.headings).toEqual([{ from: 0, level: 1 }]);
    for (const h of doc.hidden) {
      expect(doc.protected.some((p) => p.from <= h.from && p.to >= h.to)).toBe(
        true,
      );
    }
    for (const lit of doc.literals) {
      expect(doc.hidden.some((h) => lit.from >= h.from && lit.to <= h.to)).toBe(
        false,
      );
    }
    const sorted = [...doc.hidden].sort((a, b) => a.from - b.from);
    expect(doc.hidden).toEqual(sorted);
    // Spot-check wrapper bytes are never lost.
    expect(slices(src, doc.hidden).join("")).toContain("\\section{");
    expect(doc.literals.some((l) => l.text === "%")).toBe(true);
  });

  it("ignores fake document markers in macro args comments and verbatim", () => {
    const macro = parseVisualDocument(
      "\\newcommand{\\foo}{\\begin{document}}\n\\begin{document}\nhello\n\\end{document}",
    );
    expect(macro.hidden).toEqual([
      { from: 0, to: 52 },
      { from: 59, to: 73 },
    ]);
    expect(macro.body).toEqual({ from: 52, to: 59 });
    expect(
      macro.body &&
        "\\newcommand{\\foo}{\\begin{document}}\n\\begin{document}\nhello\n\\end{document}".slice(
          52,
          59,
        ),
    ).toBe("\nhello\n");

    const verbatim = parseVisualDocument(
      "\\begin{verbatim}\n\\begin{document}\n\\end{verbatim}\n\\begin{document}\nhello\n\\end{document}",
    );
    expect(verbatim.hidden).toEqual([
      { from: 0, to: 65 },
      { from: 72, to: 86 },
    ]);
    expect(verbatim.body).toEqual({ from: 65, to: 72 });

    const comment = parseVisualDocument(
      "% \\begin{document}\n\\begin{document}\nhello\n\\end{document}",
    );
    expect(comment.hidden).toEqual([
      { from: 0, to: 35 },
      { from: 42, to: 56 },
    ]);
    expect(comment.body).toEqual({ from: 35, to: 42 });
  });

  it("fails closed to whole-readonly on duplicate or missing document markers", () => {
    for (const src of [
      "\\begin{document}\nhello\n\\begin{document}\nbye\n\\end{document}",
      "\\begin{document}\nhello\n\\end{document}\n\\end{document}",
      "\\begin{document}\nhello",
      "hello\n\\end{document}",
      "\\begin{document} only-begin",
    ]) {
      const doc = parseVisualDocument(src);
      expect(doc.body).toEqual({ from: 0, to: 0 });
      expect(doc.limited).toBe(false);
      expect(doc.hidden).toEqual([]);
      expect(doc.marks).toEqual([]);
      expect(doc.headings).toEqual([]);
      expect(doc.protected).toEqual([{ from: 0, to: src.length }]);
    }
  });

  it("requires headings to be standalone single-line", () => {
    const before = parseVisualDocument("hi \\section{Intro}");
    expect(before.headings).toEqual([]);
    expect(before.hidden).toEqual([]);
    expect(before.protected).toEqual([{ from: 3, to: 18 }]);

    const after = parseVisualDocument("\\section{Intro} trailing");
    expect(after.headings).toEqual([]);
    expect(after.hidden).toEqual([]);
    expect(after.protected).toEqual([{ from: 0, to: 15 }]);

    const withComment = parseVisualDocument("\\section{Intro} % ok");
    expect(withComment.headings).toEqual([{ from: 0, level: 1 }]);
    expect(withComment.hidden).toEqual([
      { from: 0, to: 9 },
      { from: 14, to: 15 },
    ]);

    const indented = parseVisualDocument("  \\section{T}");
    expect(indented.headings).toEqual([{ from: 0, level: 1 }]);

    const multiline = parseVisualDocument("\\section{A\nB}");
    expect(multiline.headings).toEqual([]);
    expect(multiline.hidden).toEqual([]);
  });

  it("keeps protected ranges touching but never overlapping", () => {
    const adj = parseVisualDocument("\\%\\&");
    expect(adj.protected).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ]);
    expect(adj.literals).toEqual([
      { from: 0, to: 2, text: "%" },
      { from: 2, to: 4, text: "&" },
    ]);

    const wrappers = parseVisualDocument("\\textbf{B}\\textit{C}");
    expect(wrappers.protected).toEqual([
      { from: 0, to: 8 },
      { from: 9, to: 10 },
      { from: 10, to: 18 },
      { from: 19, to: 20 },
    ]);
    for (const doc of [adj, wrappers]) {
      const sorted = [...doc.protected].sort(
        (a, b) => a.from - b.from || a.to - b.to,
      );
      expect(doc.protected).toEqual(sorted);
      for (let k = 1; k < sorted.length; k++) {
        expect(sorted[k - 1]!.to).toBeLessThanOrEqual(sorted[k]!.from);
      }
    }
  });

  it("scans verbatim with a literal end marker and preserves raw CR bytes", () => {
    const src = "\\begin{verbatim}$x$ % hi \\(a\\) \\textbf{y}\\end{verbatim}";
    const doc = parseVisualDocument(src);
    expect(doc.hidden).toEqual([]);
    expect(doc.marks).toEqual([]);
    expect(doc.literals).toEqual([]);
    expect(doc.protected).toEqual([{ from: 0, to: src.length }]);

    const cr = parseVisualDocument("a\rb\r\n\\section{T}\r\nc");
    expect(cr.headings).toEqual([{ from: 5, level: 1 }]);
    expect("a\rb\r\n\\section{T}\r\nc".slice(5, 14)).toBe("\\section{");
    expect("a\rb\r\n\\section{T}\r\nc".slice(1, 2)).toBe("\r");
  });
});
