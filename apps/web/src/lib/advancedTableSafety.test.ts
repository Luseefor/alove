import { describe, it, expect } from "vitest";
import {
  parseVisualTable,
  tableDraft,
  patchesForVisualTable,
  pasteTableTsv,
  createVisualTable,
  requiredTablePackages,
} from "./visualTable";
import { applyVisualSourcePatches as apply } from "./visualObjects";
import {
  mergeTableCells,
  splitTableCell,
  resizeTableGrid,
  tableBorderPreset,
} from "./tableGrid";
import {
  parseTableColumns,
  serializeTableColumns,
  isTableDimension,
} from "./visualTableColumns";
import {
  parseTableCellContent,
  formatTableCellSelection,
} from "./tableCellContent";

const twoByTwo = String.raw`\begin{tabular}{ll}a & b \\c & d \\\end{tabular}`;
const applyDraft = (source: string, draft: ReturnType<typeof tableDraft>) =>
  apply(source, patchesForVisualTable(parseVisualTable(source)!, draft));

describe("merge range cuts", () => {
  it("rejects spans that run past the row end", () => {
    const model = parseVisualTable(twoByTwo)!;
    const draft = tableDraft(model);
    draft.spans = [
      [3, 0],
      [1, 1],
    ];
    expect(() => patchesForVisualTable(model, draft)).toThrow(
      /Invalid merged cell range/,
    );
  });

  it("rejects zero and fractional anchor spans", () => {
    const model = parseVisualTable(twoByTwo)!;
    for (const spans of [
      [
        [0, 1],
        [1, 1],
      ],
      [
        [1.5, 1],
        [1, 1],
      ],
    ]) {
      const draft = tableDraft(model);
      draft.spans = spans;
      expect(() => patchesForVisualTable(model, draft)).toThrow(
        /Invalid merged cell range/,
      );
    }
  });

  it("refuses to discard content hidden under a merge", () => {
    const model = parseVisualTable(
      String.raw`\begin{tabular}{lll}a & b & c \\d & e & f \\\end{tabular}`,
    )!;
    const draft = tableDraft(model);
    draft.spans = [
      [2, 0, 1],
      [1, 1, 1],
    ];
    draft.cells[0]![1] = "leftover";
    expect(() => patchesForVisualTable(model, draft)).toThrow(
      /discard content/,
    );
  });

  it("refuses partial, empty, and out-of-range merges and splits of plain cells", () => {
    const draft = tableDraft(parseVisualTable(twoByTwo)!);
    const merged = mergeTableCells(draft, 0, 0, 1);
    expect(merged.spans![0]).toEqual([2, 0]);
    expect(() => mergeTableCells(merged, 0, 1, 1)).toThrow(/adjacent/);
    expect(() => mergeTableCells(draft, 0, 0, 0)).toThrow(/adjacent/);
    expect(() => mergeTableCells(draft, 5, 0, 1)).toThrow(/adjacent/);
    expect(() => splitTableCell(draft, 0, 0)).toThrow(/merged cell to split/);
  });

  it("refuses column insert/delete across a merge", () => {
    const draft = mergeTableCells(tableDraft(parseVisualTable(twoByTwo)!), 0, 0, 1);
    expect(() => resizeTableGrid(draft, "column", 1, "insert")).toThrow(
      /Split merged cells/,
    );
    expect(() => resizeTableGrid(draft, "column", 0, "delete", true)).toThrow(
      /Split merged cells/,
    );
  });

  it("merges rich source without loss and split keeps the joined text", () => {
    const source = String.raw`\begin{tabular}{ll}\textbf{A} & \(x\) \\c & d \\\end{tabular}`;
    const model = parseVisualTable(source)!;
    const merged = mergeTableCells(tableDraft(model), 0, 0, 1);
    expect(merged.cells[0]![0]).toBe(String.raw`\textbf{A} \(x\)`);
    expect(apply(source, patchesForVisualTable(model, merged))).toContain(
      String.raw`{\textbf{A} \(x\)}`,
    );
    expect(splitTableCell(merged, 0, 1).spans![0]).toEqual([1, 1]);
  });
});

describe("cline adjustments", () => {
  const clineSource = String.raw`\begin{tabular}{lll}a & b & c \\\cline{2-3}d & e & f \\\end{tabular}`;

  it("shifts a cline on insert before it and expands it on insert inside", () => {
    const draft = tableDraft(parseVisualTable(clineSource)!);
    expect(resizeTableGrid(draft, "column", 0, "insert").rules![1]).toEqual([
      { kind: "cline", start: 3, end: 4 },
    ]);
    expect(resizeTableGrid(draft, "column", 1, "insert").rules![1]).toEqual([
      { kind: "cline", start: 2, end: 4 },
    ]);
  });

  it("drops a single-column cline on column delete and shrinks wider clines", () => {
    const single = String.raw`\begin{tabular}{ll}a & b \\\cline{1-1}c & d \\\end{tabular}`;
    expect(
      resizeTableGrid(tableDraft(parseVisualTable(single)!), "column", 0, "delete", true)
        .rules![1],
    ).toEqual([]);
    expect(
      resizeTableGrid(tableDraft(parseVisualTable(single)!), "column", 1, "delete", true)
        .rules![1],
    ).toEqual([{ kind: "cline", start: 1, end: 1 }]);
    const draft = tableDraft(parseVisualTable(clineSource)!);
    expect(
      resizeTableGrid(draft, "column", 1, "delete", true).rules![1],
    ).toEqual([{ kind: "cline", start: 2, end: 2 }]);
  });

  it("rejects invalid cline ranges and oversized rule lists", () => {
    const model = parseVisualTable(twoByTwo)!;
    for (const middle of [
      [{ kind: "cline", start: 0, end: 1 }],
      [{ kind: "cline", start: 2, end: 1 }],
      [{ kind: "cline", start: 1, end: 5 }],
    ]) {
      const draft = tableDraft(model);
      draft.rules = [[], middle as typeof draft.rules extends (infer U)[] | undefined ? U : never, []];
      expect(() => patchesForVisualTable(model, draft)).toThrow(
        /Invalid horizontal border range/,
      );
    }
    const oversized = tableDraft(model);
    oversized.rules = [Array(25).fill({ kind: "hline" }), [], []];
    expect(() => patchesForVisualTable(model, oversized)).toThrow(
      /Invalid horizontal border range/,
    );
  });
});

describe("malformed rich text and math", () => {
  it.each([
    "$$x$$",
    String.raw`\(\)`,
    "$x",
    String.raw`\(a & b\)`,
    String.raw`\[x\]`,
    String.raw`\(a\\b\)`,
    String.raw`\textbf{unfinished`,
    String.raw`\input{evil}`,
    "% hidden",
    "a_b",
    "a%b",
    "a^b",
    "a~b",
    "a#b",
    "a&b",
    "a{b",
    "a\u0000b",
    "x".repeat(10001),
    "\\textbf{".repeat(20) + "x" + "}".repeat(20),
    String.raw`\textbf{a}`.repeat(300),
  ])("refuses hostile cell source: %.40s", (source) => {
    expect(parseTableCellContent(source)).toBeNull();
  });

  it("keeps escapes, newline commands, and inline math usable", () => {
    expect(parseTableCellContent(String.raw`a\%b \& \_ \#`)).not.toBeNull();
    expect(parseTableCellContent(String.raw`a\newline b`)!.some((n) => n.kind === "break")).toBe(
      true,
    );
    expect(parseTableCellContent("$x$")!).toEqual([{ kind: "math", tex: "x" }]);
    expect(parseTableCellContent(String.raw`\(x^2\)`)!).toEqual([
      { kind: "math", tex: "x^2" },
    ]);
  });

  it("refuses formatting across wrappers and out-of-range selections", () => {
    const source = String.raw`\textbf{alpha} beta`;
    expect(() => formatTableCellSelection(source, 4, 15, "italic")).toThrow(
      /complete text/,
    );
    expect(() => formatTableCellSelection("abc", 0, 5, "bold")).toThrow(
      /supported cell text/,
    );
    expect(() =>
      formatTableCellSelection(String.raw`\input{evil}`, 0, 1, "bold"),
    ).toThrow(/supported cell text/);
    expect(source).toBe(String.raw`\textbf{alpha} beta`);
  });

  it("validates edited rich cells instead of encoding them", () => {
    const source = String.raw`\begin{tabular}{ll}\textbf{A} & \(x\) \\\end{tabular}`;
    const model = parseVisualTable(source)!;
    const draft = tableDraft(model);
    draft.cells[0]![0] = String.raw`\input{evil}`;
    expect(() => patchesForVisualTable(model, draft)).toThrow(/unsupported/);
  });
});

describe("malformed columns", () => {
  it.each([
    "l|||r",
    "X",
    "p",
    String.raw`p{\evil}`,
    "*{2}{l}",
    String.raw`>{\custom}l`,
    String.raw`>{\centering\arraybackslash}l`,
    "l".repeat(13),
    "",
  ])("refuses unsafe column spec: %s", (spec) => {
    expect(parseTableColumns(spec)).toBeNull();
  });

  it("round-trips a safe spec but rejects bad serialization inputs", () => {
    const spec = String.raw`|l||>{\centering\arraybackslash}m{2cm}|`;
    const parsed = parseTableColumns(spec, true)!;
    expect(serializeTableColumns(parsed.columns, parsed.borders)).toBe(spec);
    expect(() =>
      serializeTableColumns(
        [{ kind: "natural", alignment: "j", width: "" }],
        [0, 0],
      ),
    ).toThrow(/Justified/);
    expect(() =>
      serializeTableColumns(
        [{ kind: "natural", alignment: "l", width: "" }],
        [0],
      ),
    ).toThrow(/border/);
    expect(() =>
      serializeTableColumns(
        [{ kind: "natural", alignment: "l", width: "" }],
        [0, 3],
      ),
    ).toThrow(/border/);
    expect(() =>
      serializeTableColumns(
        [{ kind: "weird" as unknown as "natural", alignment: "l", width: "" }],
        [0, 0],
      ),
    ).toThrow(/Unknown column/);
  });

  it("enforces positive bounded dimensions", () => {
    for (const value of [
      "3cm",
      "50cm",
      "500mm",
      String.raw`0.25\textwidth`,
      String.raw`1\textwidth`,
    ])
      expect(isTableDimension(value)).toBe(true);
    for (const value of [
      "0cm",
      "-1cm",
      "51cm",
      "501mm",
      String.raw`0\textwidth`,
      String.raw`1.5\linewidth`,
      String.raw`2\linewidth`,
      String.raw`\input{evil}`,
      "3cm}x",
    ])
      expect(isTableDimension(value)).toBe(false);
  });

  it("refuses X columns, bad widths, and bad merge alignments in plain tabular", () => {
    const model = parseVisualTable(twoByTwo)!;
    const withX = tableDraft(model);
    withX.columns = [
      { kind: "X", alignment: "j", width: "" },
      { kind: "natural", alignment: "l", width: "" },
    ];
    withX.alignments = ["j", "l"];
    expect(() => patchesForVisualTable(model, withX)).toThrow(/tabularx/);

    const badWidth = tableDraft(model);
    badWidth.columns = [
      { kind: "p", alignment: "j", width: "0cm" },
      { kind: "natural", alignment: "l", width: "" },
    ];
    badWidth.alignments = ["j", "l"];
    expect(() => patchesForVisualTable(model, badWidth)).toThrow(/positive width/);

    const single = parseVisualTable(String.raw`\begin{tabular}{ll}a & b \\\end{tabular}`)!;
    const badMerge = tableDraft(single);
    badMerge.spans = [[2, 0]];
    badMerge.spanSpecs = [["bad", ""]];
    badMerge.cells = [["a", ""]];
    expect(() => patchesForVisualTable(single, badMerge)).toThrow(
      /merged-cell alignment/,
    );
  });

  it("refuses bad table widths and labels and protects custom captions", () => {
    const tabularx = parseVisualTable(
      String.raw`\begin{tabularx}{\linewidth}{ll}a & b \\\end{tabularx}`,
    )!;
    const widthDraft = tableDraft(tabularx);
    widthDraft.tableWidth = "0cm";
    expect(() => patchesForVisualTable(tabularx, widthDraft)).toThrow(
      /positive table width/,
    );

    const wrapped = parseVisualTable(
      String.raw`\begin{table}\begin{tabular}{ll}a & b \\\end{tabular}\caption{hi}\label{tab:ok}\end{table}`,
    )!;
    const labelDraft = tableDraft(wrapped);
    labelDraft.label = String.raw`bad\label`;
    expect(() => patchesForVisualTable(wrapped, labelDraft)).toThrow(
      /simple label/,
    );

    const customCaption = parseVisualTable(
      String.raw`\begin{table}\begin{tabular}{ll}a & b \\\end{tabular}\caption{\custom{x}}\label{tab:ok}\end{table}`,
    )!;
    expect(customCaption.caption?.text).toBeNull();
    const captionDraft = tableDraft(customCaption);
    captionDraft.caption = "new";
    expect(() => patchesForVisualTable(customCaption, captionDraft)).toThrow(
      /custom caption/,
    );
  });
});

describe("exact source preservation", () => {
  it("preserves CRLF bytes on a no-op", () => {
    const source =
      "\\begin{tabular}{ll}\r\na & b \\\\\r\nc & d \\\\\r\n\\end{tabular}";
    const model = parseVisualTable(source)!;
    expect(model.eol).toBe("\r\n");
    expect(apply(source, patchesForVisualTable(model, tableDraft(model)))).toBe(
      source,
    );
  });

  it("keeps row comments byte-identical through an independent cell edit", () => {
    const source = String.raw`\begin{tabular}{ll}% lead
a & b \\
c & d \\\end{tabular}`;
    const model = parseVisualTable(source)!;
    const draft = tableDraft(model);
    draft.cells[0]![0] = "x";
    const result = applyDraft(source, draft);
    expect(result).toContain("% lead");
    expect(result).toContain("x & b");
    expect(result).toContain("c & d");
  });

  it("keeps custom cells byte-identical through an independent cell edit", () => {
    const source = String.raw`\begin{tabular}{ll}\custom{x} & b \\c & d \\\end{tabular}`;
    const model = parseVisualTable(source)!;
    const draft = tableDraft(model);
    draft.cells[0]![1] = "B2";
    expect(applyDraft(source, draft)).toBe(
      source.replace(" & b ", " & B2 "),
    );
  });

  it("does not split cells on & inside math or brace groups", () => {
    const math = parseVisualTable(
      String.raw`\begin{tabular}{ll}$a & b$ & c \\d & e \\\end{tabular}`,
    )!;
    expect(math.cells).toHaveLength(2);
    expect(math.cells[0]).toHaveLength(2);
    const grouped = parseVisualTable(
      String.raw`\begin{tabular}{ll}{a & b} & c \\d & e \\\end{tabular}`,
    )!;
    expect(grouped.cells).toHaveLength(2);
  });

  it("emits only the edited cell range for a plain content change", () => {
    const model = parseVisualTable(twoByTwo)!;
    const draft = tableDraft(model);
    draft.cells[1]![1] = "D2";
    const patches = patchesForVisualTable(model, draft);
    expect(patches).toHaveLength(1);
    expect(apply(twoByTwo, patches)).toBe(
      twoByTwo.replace("c & d", "c & D2"),
    );
  });
});

describe("refusal of unsafe structural edits", () => {
  it("blocks grid changes with comments but allows cell edits", () => {
    const source = String.raw`\begin{tabular}{ll}% lead
a & b \\
c & d \\\end{tabular}`;
    const model = parseVisualTable(source)!;
    expect(model.structureEditable).toBe(false);
    expect(() =>
      patchesForVisualTable(model, tableBorderPreset(tableDraft(model), "grid")),
    ).toThrow(/Comments between rows/);
    const draft = tableDraft(model);
    draft.cells[0]![0] = "x";
    expect(() => patchesForVisualTable(model, draft)).not.toThrow();
  });

  it("blocks grid changes with in-cell comments and custom cells", () => {
    const commented = parseVisualTable(
      String.raw`\begin{tabular}{ll}a% c
& b \\c & d \\\end{tabular}`,
    )!;
    expect(commented.structureEditable).toBe(false);
    expect(() =>
      patchesForVisualTable(
        commented,
        tableBorderPreset(tableDraft(commented), "grid"),
      ),
    ).toThrow(/Comments inside cells/);

    const custom = parseVisualTable(
      String.raw`\begin{tabular}{ll}\custom{x} & b \\c & d \\\end{tabular}`,
    )!;
    expect(custom.structureEditable).toBe(false);
    expect(() =>
      patchesForVisualTable(custom, tableBorderPreset(tableDraft(custom), "grid")),
    ).toThrow(/Custom cells/);
    const direct = tableDraft(custom);
    direct.cells[0]![0] = "changed";
    expect(() => patchesForVisualTable(custom, direct)).toThrow(
      /custom cell markup/,
    );
  });

  it("blocks structural rewrites under repeated longtable headers", () => {
    const source = String.raw`\begin{longtable}{ll}a & b \\\endfirsthead c & d \\\end{longtable}`;
    const model = parseVisualTable(source)!;
    expect(model.structureEditable).toBe(false);
    const draft = tableDraft(model);
    draft.cells.push(["x", "y"]);
    expect(() => patchesForVisualTable(model, draft)).toThrow(
      /Repeated longtable headers/,
    );
  });

  it("rejects invalid sizes and overlong content", () => {
    const model = parseVisualTable(twoByTwo)!;
    for (const mutate of [
      (d: ReturnType<typeof tableDraft>) => {
        d.cells = [];
      },
      (d: ReturnType<typeof tableDraft>) => {
        d.cells = [["a"]];
      },
      (d: ReturnType<typeof tableDraft>) => {
        d.cells[0]![0] = "x".repeat(10001);
      },
    ]) {
      const draft = tableDraft(model);
      mutate(draft);
      expect(() => patchesForVisualTable(model, draft)).toThrow(
        /Invalid table size/,
      );
    }
    const wrapped = parseVisualTable(
      String.raw`\begin{table}\begin{tabular}{ll}a & b \\\end{tabular}\caption{hi}\label{tab:x}\end{table}`,
    )!;
    const captionDraft = tableDraft(wrapped);
    captionDraft.caption = "x".repeat(10001);
    expect(() => patchesForVisualTable(wrapped, captionDraft)).toThrow(
      /Invalid table size/,
    );
  });

  it("enforces paste bounds and never mutates the input draft", () => {
    const draft = tableDraft(parseVisualTable(twoByTwo)!);
    const before = JSON.stringify(draft);
    expect(() => pasteTableTsv(draft, 0, 0, "x".repeat(65537))).toThrow(
      /64 Ki/,
    );
    expect(() =>
      pasteTableTsv(draft, 0, 0, Array(22).fill("a").join("\n")),
    ).toThrow(/20 rows/);
    expect(() => pasteTableTsv(draft, 0, 11, "a\tb")).toThrow(/12 columns/);
    expect(JSON.stringify(draft)).toBe(before);
    expect(pasteTableTsv(draft, 0, 0, "X").cells[0]![0]).toBe("X");
    expect(JSON.stringify(draft)).toBe(before);
  });

  it("requires explicit consent to delete content and enforces grid bounds", () => {
    const draft = tableDraft(parseVisualTable(twoByTwo)!);
    expect(() => resizeTableGrid(draft, "row", 0, "delete")).toThrow(/Confirm/);
    expect(
      resizeTableGrid(
        { ...draft, cells: [["", ""], ["c", "d"]] },
        "row",
        0,
        "delete",
      ).cells,
    ).toEqual([["c", "d"]]);
    const full = tableDraft(parseVisualTable(createVisualTable(20, 12))!);
    expect(() => resizeTableGrid(full, "row", 20, "insert")).toThrow(
      /20 rows and 12 columns/,
    );
    expect(() => resizeTableGrid(full, "column", 12, "insert")).toThrow(
      /20 rows and 12 columns/,
    );
    expect(() => createVisualTable(0, 2)).toThrow(/1–20 rows/);
    expect(() => createVisualTable(2, 13)).toThrow(/1–12 columns/);
  });

  it("merges vertical borders by keeping the stronger edge on column delete", () => {
    const model = parseVisualTable(String.raw`\begin{tabular}{|l||r|}a & b \\\end{tabular}`)!;
    expect(model.verticalBorders).toEqual([1, 2, 1]);
    const next = resizeTableGrid(tableDraft(model), "column", 0, "delete", true);
    expect(next.verticalBorders).toEqual([2, 1]);
    expect(requiredTablePackages(model)).toEqual([]);
  });
});
