import { describe, expect, it } from "vitest";
import {
  buildPdfTextBlocks,
  pdfTextReplacement,
  type PdfTextBlock,
} from "./pdfVisualEditing";

function applyPatch(
  source: string,
  patch: { from: number; to: number; insert: string },
) {
  return source.slice(0, patch.from) + patch.insert + source.slice(patch.to);
}

describe("pdfVisualEditing source segmentation", () => {
  it("segments multi-line wrapped prose as one paragraph with exact offsets", () => {
    const src = "First line\nsecond line\n\nSecond para";
    const blocks = buildPdfTextBlocks({ "main.tex": src });
    expect(blocks).toHaveLength(2);
    const first = blocks[0]!;
    expect(first.kind).toBe("paragraph");
    expect(first.file).toBe("main.tex");
    expect(first.source).toBe("First line\nsecond line");
    expect(src.slice(first.from, first.to)).toBe(first.source);
    expect(first.text).toBe("First line\nsecond line");
    expect(first.startLine).toBe(1);
    expect(first.endLine).toBe(2);
    const second = blocks[1]!;
    expect(second.text).toBe("Second para");
    expect(second.startLine).toBe(4);
    const patch = pdfTextReplacement(
      first,
      "First line\nsecond line edited",
      src,
    );
    expect(patch.from).toBe(first.from);
    expect(patch.to).toBe(first.to);
    expect(applyPatch(src, patch)).toBe(
      "First line\nsecond line edited\n\nSecond para",
    );
  });

  it("exposes standalone heading content and preserves wrappers on replace", () => {
    const src = "\\section{Intro}\n\nBody";
    const blocks = buildPdfTextBlocks({ "main.tex": src });
    const heading = blocks.find((b) => b.kind === "heading")!;
    expect(heading).toBeDefined();
    expect(heading.text).toBe("Intro");
    expect(heading.source).toBe("Intro");
    expect(src.slice(heading.from, heading.to)).toBe("Intro");
    expect(heading.startLine).toBe(1);
    const patch = pdfTextReplacement(heading, "Overview", src);
    expect(applyPatch(src, patch)).toBe("\\section{Overview}\n\nBody");
  });

  it("supports subsection, subsubsection and starred headings", () => {
    const src =
      "\\section*{Star}\n\n\\subsection{Sub}\n\n\\subsubsection{Deep}";
    const blocks = buildPdfTextBlocks({ "main.tex": src });
    const headings = blocks.filter((b) => b.kind === "heading");
    expect(headings.map((h) => h.text)).toEqual(["Star", "Sub", "Deep"]);
    for (const h of headings) {
      expect(src.slice(h.from, h.to)).toBe(h.source);
    }
    const patch = pdfTextReplacement(headings[0]!, "Nova", src);
    expect(applyPatch(src, patch).startsWith("\\section*{Nova}")).toBe(true);
  });

  it("rejects headings with optional args or trailing prose", () => {
    const optional = buildPdfTextBlocks({
      "main.tex": "\\section[short]{Intro}\n\nBody",
    });
    expect(optional.filter((b) => b.kind === "heading")).toHaveLength(0);
    const trailing = buildPdfTextBlocks({
      "main.tex": "\\section{Intro} trailing\n\nBody",
    });
    expect(trailing.filter((b) => b.kind === "heading")).toHaveLength(0);
    // Body paragraph after the invalid heading is still offered.
    expect(trailing.some((b) => b.text === "Body")).toBe(true);
  });

  it("segments simple item text without list wrappers", () => {
    const src = "\\begin{itemize}\n\\item Foo\n\\item Bar\n\\end{itemize}";
    const blocks = buildPdfTextBlocks({ "main.tex": src });
    const items = blocks.filter((b) => b.kind === "item");
    expect(items.map((i) => i.text)).toEqual(["Foo", "Bar"]);
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(src.slice(item.from, item.to)).toBe(item.source);
    }
    const patch = pdfTextReplacement(items[0]!, "Baz", src);
    const next = applyPatch(src, patch);
    expect(next).toContain("\\item Baz");
    expect(next).toContain("\\begin{itemize}");
    expect(next).toContain("\\end{itemize}");
  });

  it("splits item content around retained bold wrappers", () => {
    const src = "\\begin{itemize}\n\\item A \\textbf{B}\n\\end{itemize}";
    const blocks = buildPdfTextBlocks({ "main.tex": src });
    const items = blocks.filter((b) => b.kind === "item");
    expect(items.map((i) => i.text)).toEqual(["A", "B"]);
    for (const item of items) {
      expect(src.slice(item.from, item.to)).toBe(item.source);
      expect(item.source).not.toContain("\\textbf");
    }
    const patch = pdfTextReplacement(items[1]!, "C", src);
    expect(applyPatch(src, patch)).toBe(
      "\\begin{itemize}\n\\item A \\textbf{C}\n\\end{itemize}",
    );
  });

  it("splits paragraph prose around retained bold/italic wrappers", () => {
    const src = "Hello \\textbf{bold} and \\textit{italic} world";
    const blocks = buildPdfTextBlocks({ "main.tex": src });
    expect(blocks.map((b) => b.text)).toEqual([
      "Hello",
      "bold",
      "and",
      "italic",
      "world",
    ]);
    for (const b of blocks) {
      expect(b.kind).toBe("paragraph");
      expect(src.slice(b.from, b.to)).toBe(b.source);
      expect(b.source).not.toContain("\\textbf");
      expect(b.source).not.toContain("\\textit");
    }
    const bold = blocks[1]!;
    const patch = pdfTextReplacement(bold, "strong", src);
    expect(applyPatch(src, patch)).toBe(
      "Hello \\textbf{strong} and \\textit{italic} world",
    );
    const outer = blocks[0]!;
    const outerPatch = pdfTextReplacement(outer, "Hi", src);
    expect(applyPatch(src, outerPatch)).toBe(
      "Hi \\textbf{bold} and \\textit{italic} world",
    );
  });

  it("splits heading content around retained bold wrappers", () => {
    const src = "\\section{A \\textbf{B}}\n\nBody";
    const blocks = buildPdfTextBlocks({ "main.tex": src });
    const headings = blocks.filter((b) => b.kind === "heading");
    expect(headings.map((h) => h.text)).toEqual(["A", "B"]);
    for (const h of headings) {
      expect(src.slice(h.from, h.to)).toBe(h.source);
    }
    const patch = pdfTextReplacement(headings[1]!, "C", src);
    expect(applyPatch(src, patch)).toBe("\\section{A \\textbf{C}}\n\nBody");
  });

  it("does not offer regions crossing math, cites, comments, groups or unknown commands", () => {
    const cases: Array<[string, string]> = [
      ["math", "Before\n\n$x+y$ and more\n\nAfter"],
      ["cite", "Intro\n\n\\cite{key} ok\n\nOutro"],
      ["comment", "Hello % hidden\nWorld"],
      ["group", "a {group} b"],
      ["unknown", "\\custom{body} rest"],
      ["verbatim-env", "\\begin{verbatim}\\textbf{x}\\end{verbatim}"],
      ["display-math", "a $$d$$ b"],
    ];
    for (const [label, src] of cases) {
      const blocks = buildPdfTextBlocks({ "main.tex": src });
      for (const b of blocks) {
        const slice = src.slice(b.from, b.to);
        expect(slice).toBe(b.source);
        // No block slice itself may contain the unsupported marker.
        if (label === "math") expect(slice).not.toContain("$");
        if (label === "cite") expect(slice).not.toContain("\\cite");
        if (label === "comment") expect(slice).not.toContain("%");
        if (label === "unknown") expect(slice).not.toContain("\\custom");
      }
    }
    // C отдельно: cite line alone yields no block.
    expect(buildPdfTextBlocks({ "main.tex": "\\cite{key} ok" })).toHaveLength(
      0,
    );
    expect(buildPdfTextBlocks({ "main.tex": "$x+y$" })).toHaveLength(0);
  });

  it("keeps preamble fully protected while body prose stays editable", () => {
    const src =
      "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}";
    const blocks = buildPdfTextBlocks({ "main.tex": src });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe("Hello");
    expect(blocks[0]!.kind).toBe("paragraph");
  });

  it("decodes supported escaped literals and re-escapes on replacement", () => {
    const src = "A 50\\% result with \\& and \\textbackslash{}.";
    const blocks = buildPdfTextBlocks({ "main.tex": src });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe("A 50% result with & and \\.");
    const patch = pdfTextReplacement(blocks[0]!, "B 60% & \\", src);
    expect(patch.insert).toBe("B 60\\% \\& \\textbackslash{}");
    expect(applyPatch(src, patch)).toBe("B 60\\% \\& \\textbackslash{}");
  });

  it("preserves CRLF bytes with exact UTF-16 endpoints", () => {
    const src = "First\r\nsecond\r\n\r\nThird";
    const blocks = buildPdfTextBlocks({ "main.tex": src });
    expect(blocks).toHaveLength(2);
    const first = blocks[0]!;
    expect(src.slice(first.from, first.to)).toBe(first.source);
    expect(first.source).toBe("First\r\nsecond");
    expect(first.text).toBe("First\nsecond");
    const patch = pdfTextReplacement(first, "First\nsecond edited", src);
    expect(patch.insert).toBe("First\r\nsecond edited");
    expect(applyPatch(src, patch)).toBe("First\r\nsecond edited\r\n\r\nThird");
  });

  it("keeps UTF-16 surrogate pairs exact", () => {
    const src = "Hello \u{1F600} world";
    const blocks = buildPdfTextBlocks({ "main.tex": src });
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(src.length).toBe(block.source.length);
    expect(src.slice(block.from, block.to)).toBe(block.source);
    expect(block.text).toContain("\u{1F600}");
    const patch = pdfTextReplacement(block, "Hi \u{1F600}", src);
    expect(applyPatch(src, patch)).toBe("Hi \u{1F600}");
  });

  it("splits included files per file with stable ids", () => {
    const blocks = buildPdfTextBlocks({
      "ch1.tex": "Chapter one",
      "main.tex": "Hello",
    });
    expect(blocks.map((b) => b.file)).toEqual(["ch1.tex", "main.tex"]);
    const ids = new Set(blocks.map((b) => b.id));
    expect(ids.size).toBe(blocks.length);
    for (const b of blocks) {
      expect(b.id).toContain(b.file);
    }
  });

  it("rejects stale slices and blank or boundary-breaking replacements", () => {
    const src = "\\section{Intro}\n\nHello world";
    const blocks = buildPdfTextBlocks({ "main.tex": src });
    const para = blocks.find((b) => b.kind === "paragraph")!;
    const heading = blocks.find((b) => b.kind === "heading")!;
    const stale: PdfTextBlock = { ...para, source: "changed" };
    expect(() => pdfTextReplacement(stale, "X", src)).toThrow(/stale/i);
    expect(() => pdfTextReplacement(para, "   ", src)).toThrow(/blank/i);
    expect(() => pdfTextReplacement(para, "a\n\nb", src)).toThrow(/blank/i);
    expect(() => pdfTextReplacement(para, "\nleading", src)).toThrow(
      /boundary/i,
    );
    expect(() => pdfTextReplacement(para, "trailing\n", src)).toThrow(
      /boundary/i,
    );
    expect(() => pdfTextReplacement(heading, "two\nlines", src)).toThrow(
      /one line/i,
    );
    // Out-of-bounds block is rejected without touching source.
    const moved: PdfTextBlock = { ...para, from: 9999, to: 10000 };
    expect(() => pdfTextReplacement(moved, "X", src)).toThrow();
  });

  it("bounds output to 1024 blocks", () => {
    const files: Record<string, string> = {};
    let src = "";
    for (let i = 0; i < 2000; i++) src += `Para ${i}\n\n`;
    files["main.tex"] = src;
    const blocks = buildPdfTextBlocks(files);
    expect(blocks).toHaveLength(1024);
  });

  it("bounds total source near 1MiB", () => {
    const big = "x".repeat(1024 * 1024 + 1);
    expect(buildPdfTextBlocks({ "main.tex": big })).toEqual([]);
    const half = "a\n\n".repeat(150 * 1024).slice(0, 600 * 1024);
    const half2 = "b\n\n".repeat(150 * 1024).slice(0, 600 * 1024);
    const blocks = buildPdfTextBlocks({
      "a.tex": half,
      "b.tex": half2,
    });
    // Second file exceeds the 1MiB project budget and is skipped.
    expect(blocks.every((b) => b.file === "a.tex")).toBe(true);
  });

  it("returns no blocks for fully unsupported input", () => {
    expect(buildPdfTextBlocks({ "main.tex": "" })).toEqual([]);
    expect(buildPdfTextBlocks({})).toEqual([]);
    expect(buildPdfTextBlocks({ "main.tex": "% only a comment" })).toEqual([]);
  });
});
