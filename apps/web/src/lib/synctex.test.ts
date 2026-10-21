import { describe, expect, it } from "vitest";
import type { SyncTexMapping } from "@alove/protocol";
import {
  SP_PER_BP,
  findPdfForSource,
  findSourceForPdf,
  forwardHighlight,
  isSynctexStale,
  isSyncTexMappingBounded,
  pdfPointToSyncTop,
  syncTexEntryToBp,
  syncTexScale,
} from "@/lib/synctex";

function mapping(): SyncTexMapping {
  return {
    version: 1,
    truncated: false,
    preamble: { magnification: 1000, unit: 1, xOffset: 0, yOffset: 0 },
    entries: [
      { file: "main.tex", line: 3, page: 1, x: 8799518, y: 8865054, width: 983040 },
      { file: "main.tex", line: 3, page: 1, x: 11257121, y: 8865054 },
      { file: "main.tex", line: 10, page: 1, x: 300, y: 400 },
      { file: "sections/chap.tex", line: 1, page: 2, x: 100, y: 200 },
      { file: "sections/chap.tex", line: 7, page: 2, x: 150, y: 250 },
    ],
  };
}

describe("synctex coordinate conversion", () => {
  it("scales raw points by 65781.76 sp per big point", () => {
    expect(SP_PER_BP).toBe(65781.76);
    expect(syncTexScale(mapping())).toBeCloseTo(1 / 65781.76, 12);
  });

  it("matches synctex CLI ground truth (pdflatex fixture)", () => {
    // CLI: synctex view -i "3:0:./main.tex" -> h:133.768356 y:134.764618.
    const rect = syncTexEntryToBp(mapping(), mapping().entries[0]!);
    expect(rect.xBp).toBeCloseTo(133.768356, 4);
    expect(rect.yTopBp).toBeCloseTo(134.764618, 4);
    expect(rect.wBp).toBeCloseTo(983040 / 65781.76, 6);
  });

  it("applies preamble offsets (xelatex fixture: 4736287 sp)", () => {
    const offset: SyncTexMapping = {
      version: 1,
      truncated: false,
      preamble: { magnification: 1000, unit: 1, xOffset: 4736287, yOffset: 4736287 },
      entries: [{ file: "main.tex", line: 3, page: 1, x: 4063232, y: 4128768 }],
    };
    // CLI h:133.768372 y:134.764633 for the same visual line.
    const rect = syncTexEntryToBp(offset, offset.entries[0]!);
    expect(rect.xBp).toBeCloseTo(133.768372, 4);
    expect(rect.yTopBp).toBeCloseTo(134.764633, 4);
  });

  it("falls back to defaults on missing or corrupt preambles", () => {
    expect(syncTexScale(null)).toBeCloseTo(1 / 65781.76, 12);
    expect(
      syncTexScale({ version: 1, truncated: false, entries: [] }),
    ).toBeCloseTo(1 / 65781.76, 12);
    expect(
      syncTexScale({
        version: 1,
        truncated: false,
        entries: [],
        preamble: { magnification: 0, unit: -1, xOffset: NaN, yOffset: NaN },
      }),
    ).toBeCloseTo(1 / 65781.76, 12);
  });

  it("converts pdf.js bottom-left points to top-based SyncTeX points", () => {
    // Letter page (792 bp): a click at PDF y 657.24 is y ~134.76 from top.
    const point = pdfPointToSyncTop(792, 133.77, 657.24)!;
    expect(point.xBp).toBe(133.77);
    expect(point.yTopBp).toBeCloseTo(134.76, 2);
    expect(pdfPointToSyncTop(NaN, 1, 1)).toBeNull();
  });
});

describe("synctex navigation helpers", () => {
  it("resolves source->PDF highlights on exact line hits", () => {
    const target = findPdfForSource(mapping(), "main.tex", 3)!;
    expect(target.page).toBe(1);
    expect(target.line).toBe(3);
    // Bbox unions both line-3 anchors: 8799518..11257121 sp wide.
    expect(target.rect.xBp).toBeCloseTo(133.768356, 4);
    expect(target.rect.wBp).toBeCloseTo((11257121 - 8799518) / 65781.76, 4);
    expect(target.rect.yTopBp).toBeCloseTo(134.764618, 4);
  });

  it("falls back to the nearest line in the same file", () => {
    expect(findPdfForSource(mapping(), "main.tex", 9)?.line).toBe(10);
  });

  it("applies the caret-height fallback without extents", () => {
    const bare: SyncTexMapping = {
      version: 1,
      truncated: false,
      entries: [{ file: "a.tex", line: 1, page: 1, x: 100, y: 200 }],
    };
    const target = forwardHighlight(bare, "a.tex", 1)!;
    expect(target.rect.hBp).toBe(10);
    expect(target.rect.wBp).toBe(0);
  });

  it("returns null without a mapping or for unknown files", () => {
    expect(findPdfForSource(null, "main.tex", 3)).toBeNull();
    expect(findPdfForSource(mapping(), "missing.tex", 1)).toBeNull();
    expect(findPdfForSource(mapping(), "main.tex", 0)).toBeNull();
  });

  it("resolves PDF->source at page granularity without coordinates", () => {
    expect(findSourceForPdf(mapping(), 1)).toEqual({ file: "main.tex", line: 3 });
    expect(findSourceForPdf(mapping(), 2)).toEqual({ file: "sections/chap.tex", line: 1 });
    expect(findSourceForPdf(mapping(), 99)).toBeNull();
  });

  it("picks the nearest anchor for top-based big-point clicks", () => {
    // Click near the second line-3 anchor (171.13 bp from the CLI fixture).
    expect(findSourceForPdf(mapping(), 1, 171.1, 134.8)).toEqual({
      file: "main.tex",
      line: 3,
    });
    expect(findSourceForPdf(mapping(), 1, 0, 0)).toEqual({
      file: "main.tex",
      line: 10,
    });
  });

  it("guards stale navigation by revision", () => {
    expect(isSynctexStale(5, 5)).toBe(false);
    expect(isSynctexStale(6, 5)).toBe(true);
    expect(isSynctexStale(5, null)).toBe(true);
  });

  it("enforces transport bounds on mappings", () => {
    expect(isSyncTexMappingBounded(mapping())).toBe(true);
    expect(isSyncTexMappingBounded(null)).toBe(true);
    expect(
      isSyncTexMappingBounded({
        version: 1,
        truncated: true,
        entries: Array.from({ length: 20001 }, (_, i) => ({
          file: "main.tex",
          line: i + 1,
          page: 1,
          x: 0,
          y: 0,
        })),
      }),
    ).toBe(false);
  });
});
