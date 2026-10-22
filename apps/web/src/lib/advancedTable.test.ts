import { describe, it, expect } from "vitest";
import {
  parseVisualTable,
  tableDraft,
  patchesForVisualTable,
  pasteTableTsv,
  requiredTablePackages,
  createVisualTable,
} from "./visualTable";
import {
  applyVisualSourcePatches as apply,
  parseVisualObjects,
} from "./visualObjects";
import {
  mergeTableCells,
  splitTableCell,
  resizeTableGrid,
  tableBorderPreset,
  setTableVerticalBorder,
} from "./tableGrid";
import {
  parseTableColumns,
  serializeTableColumns,
  isTableDimension,
} from "./visualTableColumns";
import {
  parseTableCellContent,
  formatTableCellSelection,
  tableCellPlainText,
} from "./tableCellContent";
const basic = String.raw`\begin{table}[!ht]
% retain float comment
\begin{tabular}{|l|r|}
\hline
Name & Value \\
Alpha & 2 \\
\hline
\end{tabular}
\caption{Original caption}
\label{tab:original}
\end{table}`;
const patch = (s: string, d: ReturnType<typeof tableDraft>) =>
  apply(s, patchesForVisualTable(parseVisualTable(s)!, d));
describe("advanced table grammar and preservation", () => {
  it("no-op preserves every byte and width-only changes touch only the column definition", () => {
    const s = basic.replace(/\n/g, "\r\n"),
      m = parseVisualTable(s)!;
    expect(m.structureEditable).toBe(true);
    expect(patch(s, tableDraft(m))).toBe(s);
    const d = tableDraft(m);
    d.columns![0] = { kind: "p", alignment: "j", width: "3cm" };
    d.alignments[0] = "j";
    const changes = patchesForVisualTable(m, d);
    expect(changes).toHaveLength(1);
    expect(apply(s, changes)).toBe(s.replace("{|l|r|}", "{|p{3cm}|r|}"));
  });
  it("parses multicolumn with safe offsets and patches only its inner content", () => {
    const s = String.raw`\begin{tabular}{|lcr|}\multicolumn{2}{|c|}{ \textbf{Merged} } & third \\ a & b & c \\\end{tabular}`,
      m = parseVisualTable(s)!;
    expect(m.cells[0]!.map((c) => c.colSpan)).toEqual([2, 0, 1]);
    expect(m.cells[0]![1]!.coveredBy).toBe(0);
    const d = tableDraft(m);
    d.cells[0]![0] = String.raw`\textbf{Revised}`;
    expect(patch(s, d)).toBe(s.replace("{Merged}", "{Revised}"));
  });
  it("merges without discarding any cell, and split retains content in the first cell", () => {
    const m = parseVisualTable(basic)!,
      d = mergeTableCells(tableDraft(m), 0, 0, 1),
      s = patch(basic, d),
      n = parseVisualTable(s)!;
    expect(s).toContain(String.raw`\multicolumn{2}{|l|}{Name Value}`);
    expect(n.cells[0]![0]!.text).toBe("Name Value");
    expect(s.slice(s.indexOf("\\caption"))).toBe(
      basic.slice(basic.indexOf("\\caption")),
    );
    const split = splitTableCell(tableDraft(n), 0, 1);
    expect(split.cells[0]).toEqual(["Name Value", ""]);
    expect(
      parseVisualTable(patch(s, split))!.cells[0]!.map((c) => c.colSpan),
    ).toEqual([1, 1]);
  });
  it("retains supported rich source during merges and validates edited rich cells", () => {
    const s = String.raw`\begin{tabular}{ll}\textbf{A} & \(x^2\) \\\end{tabular}`,
      m = parseVisualTable(s)!;
    expect(m.structureEditable).toBe(true);
    const d = mergeTableCells(tableDraft(m), 0, 0, 1);
    expect(patch(s, d)).toContain(String.raw`{\textbf{A} \(x^2\)}`);
    const edit = tableDraft(m);
    edit.cells[0]![0] = String.raw`\textit{New}`;
    expect(patch(s, edit)).toBe(s.replace("\\textbf{A}", "\\textit{New}"));
    edit.cells[0]![0] = String.raw`\input{evil}`;
    expect(() => patch(s, edit)).toThrow(/unsupported/);
  });
  it("refuses paste through merged cells and unsafe structural changes without changing drafts", () => {
    const m = parseVisualTable(basic)!,
      d = mergeTableCells(tableDraft(m), 0, 0, 1),
      before = JSON.stringify(d);
    expect(() => pasteTableTsv(d, 0, 0, "x\ty")).toThrow(/merged/);
    expect(() => pasteTableTsv(d, 0, 1, "x")).toThrow(/merged/);
    expect(JSON.stringify(d)).toBe(before);
    const custom = parseVisualTable(
      basic.replace("Alpha", String.raw`\custom{Alpha}`),
    )!;
    expect(custom.structureEditable).toBe(false);
    expect(() =>
      patch(custom.source, mergeTableCells(tableDraft(custom), 0, 0, 1)),
    ).toThrow(/Custom/);
  });
  it("preserves row comments and unknown cells on independent edits", () => {
    const s = basic
        .replace("Alpha & 2", String.raw`\custom{Alpha} & 2`)
        .replace("Name & Value", "% row note\nName & Value"),
      m = parseVisualTable(s)!,
      d = tableDraft(m);
    d.cells[1]![1] = "3";
    expect(patch(s, d)).toBe(s.replace(" & 2 ", " & 3 "));
    expect(() => patch(s, tableBorderPreset(d, "grid"))).toThrow(
      /Comments|Custom/,
    );
  });
  it("supports tabularx widths and X columns and exact local edits", () => {
    const s = String.raw`\begin{tabularx}{\linewidth}{|X|>{\raggedleft\arraybackslash}p{2cm}|}Text & Value \\\end{tabularx}`,
      m = parseVisualTable(s)!;
    expect(m.environment).toBe("tabularx");
    expect(requiredTablePackages(m)).toEqual(["tabularx", "array"]);
    const d = tableDraft(m);
    d.cells[0]![0] = "Changed";
    expect(patch(s, d)).toBe(s.replace("Text", "Changed"));
    d.tableWidth = "0.9\\linewidth";
    expect(patch(s, d)).toContain("{0.9\\linewidth}");
    expect(
      parseVisualObjects("\\begin{document}\n" + s + "\n\\end{document}")[0]
        ?.kind,
    ).toBe("table");
  });
  it("supports longtable caption/labels and preserves repeated headers during cell edits", () => {
    const s = String.raw`\begin{longtable}{lr}
\caption{Long results}\label{tab:long}\\
\toprule
Name & Value \\
\endfirsthead
Name & Value \\
\endhead
Alpha & 2 \\
\bottomrule
\end{longtable}`,
      m = parseVisualTable(s)!;
    expect(m.environment).toBe("longtable");
    expect(m.caption?.text).toBe("Long results");
    expect(m.structureEditable).toBe(false);
    const d = tableDraft(m);
    d.cells[2]![1] = "3";
    d.caption = "New results";
    expect(patch(s, d)).toBe(
      s
        .replace("Alpha & 2", "Alpha & 3")
        .replace("Long results", "New results"),
    );
    expect(requiredTablePackages(m)).toEqual(["longtable", "booktabs"]);
  });
  it("edits longtable bodies and missing metadata without overlapping changes", () => {
    const s = String.raw`\begin{longtable}{ll}A & B \\\end{longtable}`,
      m = parseVisualTable(s)!,
      d = tableBorderPreset(tableDraft(m), "grid");
    d.caption = "New caption";
    d.label = "tab:new";
    const result = patch(s, d);
    expect(parseVisualTable(result)?.caption?.text).toBe("New caption");
    expect(result).toContain("\\label{tab:new}");
  });
  it.each([
    String.raw`\begin{tabular}{*{2}{l}}a&b\\\end{tabular}`,
    String.raw`\begin{tabular}{l}\multicolumn{2}{l}{a}\\\end{tabular}`,
    String.raw`\begin{tabular}{ll}\multicolumn{2}{\custom}{a}\\\end{tabular}`,
    String.raw`\begin{tabular}{p{\evil}}x\\\end{tabular}`,
    String.raw`\begin{table}\begin{longtable}{l}x\\\end{longtable}\end{table}`,
  ])("protects unsupported or malformed syntax: %s", (s) =>
    expect(parseVisualTable(s)).toBeNull(),
  );
});
describe("columns, borders and grid operations", () => {
  it("roundtrips safe column specs and refuses injected or unbounded dimensions", () => {
    const spec = String.raw`|l||>{\centering\arraybackslash}m{2cm}|p{0.2\textwidth}b{15mm}X|`,
      m = parseTableColumns(spec, true)!;
    expect(serializeTableColumns(m.columns, m.borders)).toBe(spec);
    for (const v of [
      "-1cm",
      "0cm",
      "99999cm",
      String.raw`\input{evil}`,
      String.raw`2\linewidth`,
      "3cm}x",
    ])
      expect(isTableDimension(v)).toBe(false);
  });
  it("keeps borders and rich cells through safe row/column insertion, and requires deletion consent", () => {
    const d = tableDraft(parseVisualTable(basic)!);
    expect(() => resizeTableGrid(d, "row", 0, "delete")).toThrow(/Confirm/);
    const n = resizeTableGrid(d, "column", 1, "insert");
    expect(n.cells[0]).toEqual(["Name", "", "Value"]);
    expect(n.rules).toHaveLength(3);
    expect(n.verticalBorders).toEqual([1, 1, 0, 1]);
    expect(resizeTableGrid(n, "column", 1, "delete").cells).toEqual(d.cells);
    expect(resizeTableGrid(d, "row", 0, "delete", true).cells).toEqual([
      ["Alpha", "2"],
    ]);
  });
  it("serializes single, double, booktabs and partial horizontal borders", () => {
    const m = parseVisualTable(basic)!,
      d = tableBorderPreset(tableDraft(m), "booktabs");
    d.rules![1] = [{ kind: "cline", start: 1, end: 1 }];
    const result = patch(basic, d);
    expect(result).toContain("\\toprule");
    expect(result).toContain("\\cline{1-1}");
    expect(result).toContain("\\bottomrule");
    expect(requiredTablePackages(parseVisualTable(result)!)).toEqual([
      "booktabs",
    ]);
  });
  it("keeps original bounds and caps for additions/paste", () => {
    const d = tableDraft(parseVisualTable(createVisualTable(20, 12))!);
    expect(() => resizeTableGrid(d, "row", 20, "insert")).toThrow();
    expect(() => resizeTableGrid(d, "column", 12, "insert")).toThrow();
    expect(() => pasteTableTsv(d, 19, 11, "x\ty")).toThrow();
  });
});
describe("cell formatting safety", () => {
  it("parses nested formatting, inline math, escapes and Unicode without HTML execution", () => {
    const nodes = parseTableCellContent(
      String.raw`\textbf{A \textit{B}} \(x^2\) 50\% <img> 😀`,
    )!;
    expect(nodes).not.toBeNull();
    expect(tableCellPlainText(nodes)).toBe("A B x^2 50% <img> 😀");
    expect(formatTableCellSelection("alpha beta", 6, 10, "bold").source).toBe(
      String.raw`alpha \textbf{beta}`,
    );
  });
  it.each([
    String.raw`\input{evil}`,
    String.raw`\textbf{unfinished`,
    String.raw`x & y`,
    String.raw`$x\end{tabular}$`,
    String.raw`$$x$$`,
    "% hidden",
    "x".repeat(10001),
    "\\textbf{".repeat(20) + "x" + "}".repeat(20),
  ])("refuses unsupported or hostile source: %.40s", (s) =>
    expect(parseTableCellContent(s)).toBeNull(),
  );
  it("refuses formatting ranges crossing a wrapper and never modifies the input", () => {
    const s = String.raw`\textbf{alpha} beta`;
    expect(() => formatTableCellSelection(s, 4, 15, "italic")).toThrow();
    expect(s).toBe(String.raw`\textbf{alpha} beta`);
  });
});

it("explicit border presets update merged overrides without changing content or alignment", () => {
  const s = String.raw`\begin{tabular}{ll}\multicolumn{2}{|c|}{Merged} \\ A & B \\\end{tabular}`;
  const m = parseVisualTable(s)!,
    d = tableBorderPreset(tableDraft(m), "booktabs");
  expect(d.spanSpecs![0]![0]).toBe("c");
  expect(patch(s, d)).toContain(String.raw`\multicolumn{2}{c}{Merged}`);
  expect(d.cells[0]![0]).toBe("Merged");
});
it("one boundary change updates touching merged overrides and preserves other edges", () => {
  const s = String.raw`\begin{tabular}{lll}\multicolumn{2}{|r||}{Merged} & tail \\ A & B & C \\\end{tabular}`;
  const d = tableDraft(parseVisualTable(s)!);
  const n = setTableVerticalBorder(d, 0, 2);
  expect(n.spanSpecs![0]![0]).toBe("||r||");
  expect(n.verticalBorders).toEqual([2, 0, 0, 0]);
  expect(d.spanSpecs![0]![0]).toBe("|r||");
  expect(setTableVerticalBorder(d, 1, 1).spanSpecs![0]![0]).toBe("|r||");
  expect(() => setTableVerticalBorder(d, 4, 1)).toThrow();
});
