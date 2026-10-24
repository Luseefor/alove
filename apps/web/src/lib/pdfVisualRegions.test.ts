import { describe, expect, it } from "vitest";
import { buildPdfTextBlocks } from "./pdfVisualEditing";
import { buildPdfTextRegions } from "./pdfVisualRegions";
import { SP_PER_BP } from "./synctex";
import type { PdfPageLayout } from "@/components/latex-ide/PdfCanvasViewer";
import type { SyncTexMapping } from "@alove/protocol";
const layout: PdfPageLayout = {
  page: 1,
  width: 600,
  height: 800,
  pageWidthBp: 600,
  pageHeightBp: 800,
  textRuns: [
    {
      text: "A precise scientific",
      left: 70,
      top: 100,
      width: 180,
      height: 12,
    },
    { text: "manuscript.", left: 70, top: 115, width: 80, height: 12 },
  ],
};
const mapping = (file = "main.tex", line = 1, y = 126): SyncTexMapping => ({
  version: 1,
  truncated: false,
  entries: [
    {
      file,
      line,
      page: 1,
      x: 70 * SP_PER_BP,
      y: y * SP_PER_BP,
      width: 180 * SP_PER_BP,
      height: 12 * SP_PER_BP,
    },
  ],
});
describe("PDF text region proof", () => {
  it("requires matching PDF text and nearby coordinates for the same file and lines", () => {
    const blocks = buildPdfTextBlocks({
      "main.tex": "A precise scientific\nmanuscript.",
    });
    expect(buildPdfTextRegions(blocks, layout, mapping())).toHaveLength(1);
    expect(
      buildPdfTextRegions(blocks, layout, mapping("other.tex")),
    ).toHaveLength(0);
    expect(
      buildPdfTextRegions(blocks, layout, mapping("main.tex", 20)),
    ).toHaveLength(0);
    expect(
      buildPdfTextRegions(blocks, layout, mapping("main.tex", 1, 500)),
    ).toHaveLength(0);
    expect(
      buildPdfTextRegions(
        blocks,
        {
          ...layout,
          textRuns: [
            { ...layout.textRuns[0], text: "A different manuscript." },
          ],
        },
        mapping(),
      ),
    ).toHaveLength(0);
  });
  it("refuses equally plausible duplicate text in multiple files", () => {
    const blocks = buildPdfTextBlocks({
      "a.tex": "A precise scientific manuscript.",
      "b.tex": "A precise scientific manuscript.",
    });
    const map = mapping("a.tex");
    map.entries.push(...mapping("b.tex").entries);
    expect(buildPdfTextRegions(blocks, layout, map)).toHaveLength(0);
  });
  it("uses current page and scaled PDF geometry", () => {
    const blocks = buildPdfTextBlocks({
      "main.tex": "A precise scientific manuscript.",
    });
    expect(
      buildPdfTextRegions(blocks, { ...layout, page: 2 }, mapping()),
    ).toHaveLength(0);
    const doubled = {
      ...layout,
      width: 1200,
      height: 1600,
      textRuns: layout.textRuns.map((r) => ({
        ...r,
        left: r.left * 2,
        top: r.top * 2,
        width: r.width * 2,
        height: r.height * 2,
      })),
    };
    const [r] = buildPdfTextRegions(blocks, doubled, mapping());
    expect(r.left).toBe(140);
    expect(r.width).toBe(360);
    expect(r.height).toBe(54);
  });
  it("refuses partial paragraphs spanning other pages", () => {
    const blocks = buildPdfTextBlocks({
      "main.tex": "A precise scientific manuscript. More text on another page.",
    });
    expect(buildPdfTextRegions(blocks, layout, mapping())).toHaveLength(0);
  });
  it("matches TeX punctuation and discretionary line-end hyphens without changing source", () => {
    const source = "We don't stop -- scientific writing.";
    const blocks = buildPdfTextBlocks({ "main.tex": source });
    const page = {
      ...layout,
      textRuns: [
        {
          text: "We don’t stop – scien-",
          left: 70,
          top: 100,
          width: 180,
          height: 12,
        },
        { text: "tific writing.", left: 70, top: 115, width: 80, height: 12 },
      ],
    };
    const [region] = buildPdfTextRegions(blocks, page, mapping());
    expect(region.block.source).toBe(source);
  });
});
