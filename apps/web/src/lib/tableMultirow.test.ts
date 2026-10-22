import { describe, it, expect } from "vitest";
import {
  parseVisualTable,
  tableDraft,
  patchesForVisualTable,
  pasteTableTsv,
  requiredTablePackages,
  longtableSectionForRow,
} from "./visualTable";
import { applyVisualSourcePatches as apply } from "./visualObjects";
import {
  mergeTableCells,
  mergeTableCellsVertical,
  splitTableCellVertical,
  tableRowAnchor,
  resizeTableGrid,
} from "./tableGrid";

const twoByTwo = String.raw`\begin{tabular}{ll}a & b \\c & d \\\end{tabular}`;
const applyDraft = (source: string, draft: ReturnType<typeof tableDraft>) =>
  apply(source, patchesForVisualTable(parseVisualTable(source)!, draft));

describe("vertical multirow merges", () => {
  it("parses multirow anchors and marks covered cells without losing bytes on no-op", () => {
    const source = String.raw`\begin{tabular}{ll}\multirow{2}{*}{A} & B \\ & C \\\end{tabular}`;
    const withBreaks = source.replaceAll("\\\\", "\\\\\n");
    const crlf = withBreaks.replace(/\n/g, "\r\n");
    const model = parseVisualTable(crlf)!;
    expect(model.cells[0]![0]!.rowSpan).toBe(2);
    expect(model.cells[0]![0]!.rowSpanSpec).toBe("*");
    expect(model.cells[1]![0]!.rowSpan).toBe(0);
    expect(model.cells[1]![0]!.rowCoveredBy).toBe(0);
    expect(model.eol).toBe("\r\n");
    expect(apply(crlf, patchesForVisualTable(model, tableDraft(model)))).toBe(
      crlf,
    );
    expect(requiredTablePackages(model)).toContain("multirow");
  });

  it("merges vertically preserving all contents and splits keeping the first cell", () => {
    const model = parseVisualTable(twoByTwo)!;
    const merged = mergeTableCellsVertical(tableDraft(model), 0, 1, 0);
    expect(merged.cells[0]![0]).toBe("a c");
    expect(merged.rowSpans![0]![0]).toBe(2);
    expect(merged.rowSpans![1]![0]).toBe(0);
    const source = apply(twoByTwo, patchesForVisualTable(model, merged));
    expect(source).toContain(String.raw`\multirow{2}{*}{a c}`);
    const reparsed = parseVisualTable(source)!;
    expect(reparsed.cells[0]![0]!.text).toBe("a c");
    expect(reparsed.cells[1]![0]!.rowSpan).toBe(0);
    const split = splitTableCellVertical(tableDraft(reparsed), 1, 0);
    expect(split.rowSpans![0]![0]).toBe(1);
    expect(split.rowSpans![1]![0]).toBe(1);
    expect(split.cells[0]![0]).toBe("a c");
  });

  it("validates rectangles, span bounds and refuses discarded covered content", () => {
    const model = parseVisualTable(
      String.raw`\begin{tabular}{lll}a & b & c \\d & e & f \\\end{tabular}`,
    )!;
    const draft = tableDraft(model);
    draft.rowSpans = [
      [2, 1, 1],
      [0, 1, 1],
    ];
    draft.rowSpanSpecs = [
      ["*", "", ""],
      ["", "", ""],
    ];
    draft.cells[1]![0] = "leftover";
    expect(() => patchesForVisualTable(model, draft)).toThrow(
      /discard content/,
    );
    const badBounds = tableDraft(model);
    badBounds.rowSpans = [
      [3, 1, 1],
      [0, 1, 1],
    ];
    expect(() => patchesForVisualTable(model, badBounds)).toThrow(
      /Invalid merged cell range/,
    );
    const badSpec = tableDraft(model);
    badSpec.rowSpans = [
      [2, 1, 1],
      [0, 1, 1],
    ];
    badSpec.rowSpanSpecs = [
      ["bad", "", ""],
      ["", "", ""],
    ];
    expect(() => patchesForVisualTable(model, badSpec)).toThrow(
      /multirow width/,
    );
  });

  it("refuses combined horizontal+vertical merges and unknown multirow shapes", () => {
    const model = parseVisualTable(twoByTwo)!;
    const horizontal = mergeTableCells(tableDraft(model), 0, 0, 1);
    expect(() =>
      mergeTableCellsVertical(horizontal, 0, 1, 0),
    ).toThrow(/horizontal/);
    const vertical = mergeTableCellsVertical(tableDraft(model), 0, 1, 0);
    expect(() => mergeTableCells(vertical, 0, 0, 1)).toThrow(/vertical/);
    expect(
      parseVisualTable(
        String.raw`\begin{tabular}{ll}\multirow{2}{*}{a \multicolumn{1}{c}{b}} & c \\ & d \\\end{tabular}`,
      ),
    ).toBeNull();
    expect(
      parseVisualTable(
        String.raw`\begin{tabular}{ll}\multicolumn{2}{c}{\multirow{2}{*}{a}} \\x & y \\\end{tabular}`,
      ),
    ).toBeNull();
    expect(
      parseVisualTable(
        String.raw`\begin{tabular}{ll}\multirow[fix]{2}{*}{a} & b \\ & c \\\end{tabular}`,
      ),
    ).toBeNull();
    expect(
      parseVisualTable(
        String.raw`\begin{tabular}{ll}\multirow{2}{bad}{a} & b \\ & c \\\end{tabular}`,
      ),
    ).toBeNull();
    expect(
      parseVisualTable(
        String.raw`\begin{tabular}{ll}\multirow{5}{*}{a} & b \\ & c \\\end{tabular}`,
      ),
    ).toBeNull();
    expect(() =>
      mergeTableCellsVertical(tableDraft(model), 0, 1, 5),
    ).toThrow(/adjacent/);
    expect(() =>
      splitTableCellVertical(tableDraft(model), 0, 0),
    ).toThrow(/merged cell to split/);
    expect(tableRowAnchor(tableDraft(model), 9, 0)).toBe(-1);
  });

  it("requires split before row insert/delete crossing a vertical span and consent for populated deletes", () => {
    const model = parseVisualTable(twoByTwo)!;
    const vertical = mergeTableCellsVertical(tableDraft(model), 0, 1, 0);
    expect(() => resizeTableGrid(vertical, "row", 1, "insert")).toThrow(
      /Split merged cells crossing this row/,
    );
    expect(() =>
      resizeTableGrid(vertical, "row", 0, "delete", true),
    ).toThrow(/Split merged cells crossing this row/);
    expect(() => resizeTableGrid(vertical, "row", 1, "delete", true)).toThrow(
      /Split merged cells crossing this row/,
    );
    expect(() => pasteTableTsv(vertical, 1, 0, "x")).toThrow(/merged/);
    const plain = tableDraft(model);
    expect(() => resizeTableGrid(plain, "row", 0, "delete")).toThrow(/Confirm/);
    expect(
      resizeTableGrid(plain, "row", 0, "delete", true).cells,
    ).toEqual([["c", "d"]]);
  });

  it("emits only the anchor range for vertical content edits", () => {
    const source = String.raw`\begin{tabular}{ll}\multirow{2}{*}{A} & B \\ & C \\\end{tabular}`;
    const model = parseVisualTable(source)!;
    const draft = tableDraft(model);
    draft.cells[0]![1] = "B2";
    const patches = patchesForVisualTable(model, draft);
    expect(patches).toHaveLength(1);
    expect(applyDraft(source, draft)).toBe(source.replace(" & B ", " & B2 "));
    const anchorEdit = tableDraft(model);
    anchorEdit.cells[0]![0] = "A2";
    expect(applyDraft(source, anchorEdit)).toBe(
      source.replace("{A}", "{A2}"),
    );
  });
});

describe("repeated longtable headers", () => {
  const standard = [
    String.raw`\begin{longtable}{ll}`,
    String.raw`H1 & H2 \\`,
    String.raw`\endfirsthead`,
    String.raw`H1 & H2 \\`,
    String.raw`\endhead`,
    String.raw`F1 & F2 \\`,
    String.raw`\endfoot`,
    String.raw`L1 & L2 \\`,
    String.raw`\endlastfoot`,
    String.raw`A & B \\`,
    String.raw`\end{longtable}`,
  ].join("\n");

  it("records all four markers and shows every section row", () => {
    const model = parseVisualTable(standard)!;
    expect(model.environment).toBe("longtable");
    expect(model.cells).toHaveLength(5);
    expect(model.longtableMarkers).toEqual([
      null,
      "endfirsthead",
      "endhead",
      "endfoot",
      "endlastfoot",
      null,
    ]);
    expect(model.structureEditable).toBe(false);
    expect(model.cells.map((r) => r.map((c) => c.text))).toEqual([
      ["H1", "H2"],
      ["H1", "H2"],
      ["F1", "F2"],
      ["L1", "L2"],
      ["A", "B"],
    ]);
  });

  it("retains markers and repeated content on independent cell edits", () => {
    const model = parseVisualTable(standard)!;
    const draft = tableDraft(model);
    draft.cells[4]![1] = "B2";
    const result = applyDraft(standard, draft);
    expect(result).toContain(String.raw`\endfirsthead`);
    expect(result).toContain(String.raw`\endhead`);
    expect(result).toContain(String.raw`\endfoot`);
    expect(result).toContain(String.raw`\endlastfoot`);
    expect(result).toContain("H1 & H2");
    expect(result).toContain("A & B2");
    expect(apply(standard, patchesForVisualTable(model, tableDraft(model)))).toBe(
      standard,
    );
  });

  it("refuses structural rewrites where markers cannot be maintained", () => {
    const model = parseVisualTable(standard)!;
    expect(() =>
      patchesForVisualTable(model, {
        ...tableDraft(model),
        cells: [...tableDraft(model).cells, ["x", "y"]],
      }),
    ).toThrow(/Repeated longtable headers/);
    expect(() =>
      resizeTableGrid(tableDraft(model), "row", 5, "insert"),
    ).not.toThrow();
    const grown = resizeTableGrid(tableDraft(model), "row", 5, "insert");
    expect(() => patchesForVisualTable(model, grown)).toThrow(
      /Repeated longtable headers/,
    );
  });

  it("labels each row by its repeated section rather than as body", () => {
    const model = parseVisualTable(standard)!;
    expect(
      model.cells.map((_, r) => longtableSectionForRow(model.longtableMarkers, r)),
    ).toEqual(["firsthead", "head", "foot", "lastfoot", "body"]);
    const single = parseVisualTable(
      [String.raw`\begin{longtable}{ll}`, String.raw`H & V \\`, String.raw`\endhead`, String.raw`A & B \\`, String.raw`\end{longtable}`].join("\n"),
    )!;
    expect(longtableSectionForRow(single.longtableMarkers, 0)).toBe("head");
    expect(longtableSectionForRow(single.longtableMarkers, 1)).toBe("body");
    expect(longtableSectionForRow(undefined, 0)).toBe("body");
  });
});

describe("multirow safety refusals", () => {
  it("rejects orphan rowSpan=0 without a covering anchor", () => {
    const model = parseVisualTable(twoByTwo)!;
    const orphan = tableDraft(model);
    orphan.rowSpans = [
      [1, 1],
      [0, 1],
    ];
    orphan.cells[1]![0] = "";
    expect(() => patchesForVisualTable(model, orphan)).toThrow(
      /Invalid merged cell range/,
    );
  });

  it("rejects overlapping vertical spans", () => {
    const model = parseVisualTable(
      String.raw`\begin{tabular}{ll}a & b \\c & d \\e & f \\\end{tabular}`,
    )!;
    const overlap = tableDraft(model);
    overlap.rowSpans = [
      [2, 1],
      [2, 1],
      [0, 1],
    ];
    overlap.rowSpanSpecs = [
      ["*", ""],
      ["*", ""],
      ["", ""],
    ];
    expect(() => patchesForVisualTable(model, overlap)).toThrow(
      /discard content|Invalid merged cell range/,
    );
  });

  it("rejects a multirow crossing a longtable section marker in parser and patches", () => {
    const crossing = [
      String.raw`\begin{longtable}{ll}`,
      String.raw`\multirow{2}{*}{A} & B \\`,
      String.raw`\endhead`,
      String.raw` & C \\`,
      String.raw`\end{longtable}`,
    ].join("\n");
    expect(parseVisualTable(crossing)).toBeNull();
    const valid = parseVisualTable(
      [
        String.raw`\begin{longtable}{ll}`,
        String.raw`H1 & H2 \\`,
        String.raw`\endhead`,
        String.raw`A & B \\`,
        String.raw`C & D \\`,
        String.raw`\end{longtable}`,
      ].join("\n"),
    )!;
    const draft = tableDraft(valid);
    draft.rowSpans = [
      [1, 1],
      [2, 1],
      [0, 1],
    ];
    draft.rowSpanSpecs = [
      ["", ""],
      ["*", ""],
      ["", ""],
    ];
    draft.cells[1]![0] = "A C";
    draft.cells[2]![0] = "";
    expect(() => patchesForVisualTable(valid, draft)).toThrow(
      /Repeated longtable headers|cannot cross/,
    );
  });
});

describe("longtable marker ordering", () => {
  it.each([
    [
      "duplicate endhead",
      [String.raw`\begin{longtable}{ll}`, String.raw`a & b \\`, String.raw`\endhead`, String.raw`c & d \\`, String.raw`\endhead`, String.raw`e & f \\`, String.raw`\end{longtable}`].join("\n"),
    ],
    [
      "out-of-order foot before head",
      [String.raw`\begin{longtable}{ll}`, String.raw`a & b \\`, String.raw`\endfoot`, String.raw`c & d \\`, String.raw`\endhead`, String.raw`e & f \\`, String.raw`\end{longtable}`].join("\n"),
    ],
    [
      "out-of-order lastfoot before firsthead",
      [String.raw`\begin{longtable}{ll}`, String.raw`a & b \\`, String.raw`\endlastfoot`, String.raw`c & d \\`, String.raw`\endfirsthead`, String.raw`\end{longtable}`].join("\n"),
    ],
  ])("refuses invalid marker sequence: %s", (_, source) => {
    expect(parseVisualTable(source)).toBeNull();
  });

  it("accepts ordered subsets and empty tables without markers", () => {
    const subset = parseVisualTable(
      [String.raw`\begin{longtable}{ll}`, String.raw`H & V \\`, String.raw`\endhead`, String.raw`A & B \\`, String.raw`\end{longtable}`].join("\n"),
    )!;
    expect(subset.longtableMarkers).toEqual([null, "endhead", null]);
    expect(
      parseVisualTable(
        String.raw`\begin{longtable}{ll}a & b \\c & d \\\end{longtable}`,
      )!.longtableMarkers,
    ).toEqual([null, null, null]);
  });
});
