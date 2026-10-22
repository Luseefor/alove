import {
  draftCellSource,
  type TableDraft,
  type TableRule,
} from "./visualTable";
import { parseTableColumns, serializeTableColumns } from "./visualTableColumns";
export function cloneTableDraft(d: TableDraft): TableDraft {
  const nr = d.cells.length,
    nc = d.alignments.length;
  return {
    ...d,
    cells: d.cells.map((r) => [...r]),
    alignments: [...d.alignments],
    columns: Array.from({ length: nc }, (_, c) => ({
      ...(d.columns?.[c] ?? {
        kind: "natural",
        alignment: d.alignments[c] as "l" | "c" | "r",
        width: "",
      }),
    })),
    verticalBorders: Array.from(
      { length: nc + 1 },
      (_, c) => d.verticalBorders?.[c] ?? 0,
    ),
    rules: Array.from({ length: nr + 1 }, (_, r) =>
      (d.rules?.[r] ?? []).map((x) => ({ ...x })),
    ),
    spans: Array.from({ length: nr }, (_, r) =>
      Array.from({ length: nc }, (_, c) => d.spans?.[r]?.[c] ?? 1),
    ),
    spanSpecs: Array.from({ length: nr }, (_, r) =>
      Array.from({ length: nc }, (_, c) => d.spanSpecs?.[r]?.[c] ?? ""),
    ),
    rowSpans: Array.from({ length: nr }, (_, r) =>
      Array.from({ length: nc }, (_, c) => d.rowSpans?.[r]?.[c] ?? 1),
    ),
    rowSpanSpecs: Array.from({ length: nr }, (_, r) =>
      Array.from({ length: nc }, (_, c) => d.rowSpanSpecs?.[r]?.[c] ?? ""),
    ),
    sourceCells: Array.from({ length: nr }, (_, r) =>
      Array.from({ length: nc }, (_, c) => d.sourceCells?.[r]?.[c] ?? false),
    ),
  };
}
export function tableCellAnchor(
  d: TableDraft,
  row: number,
  col: number,
): number {
  if (!d.cells[row] || col < 0 || col >= d.alignments.length) return -1;
  let c = col;
  while (c > 0 && (d.spans?.[row]?.[c] ?? 1) === 0) c--;
  return c;
}
export function tableRowAnchor(
  d: TableDraft,
  row: number,
  col: number,
): number {
  if (!d.cells[row] || col < 0 || col >= d.alignments.length) return -1;
  let r = row;
  while (r > 0 && (d.rowSpans?.[r]?.[col] ?? 1) === 0) r--;
  return r;
}
export function mergeTableCells(
  d: TableDraft,
  row: number,
  start: number,
  end: number,
): TableDraft {
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    !d.cells[row] ||
    start < 0 ||
    end <= start ||
    end >= d.alignments.length ||
    tableCellAnchor(d, row, start) !== start
  )
    throw new Error("Select adjacent cells in one row to merge.");
  for (let c = start; c <= end; c++) {
    if ((d.rowSpans?.[row]?.[c] ?? 1) !== 1)
      throw new Error("Split vertical merges first, then merge horizontally.");
  }
  const next = cloneTableDraft(d),
    values: string[] = [],
    raw: string[] = [];
  let source = false;
  for (let c = start; c <= end; ) {
    const span = next.spans![row]![c]!;
    if (span < 1 || c + span - 1 > end)
      throw new Error("Select the whole merged cell, or split it first.");
    values.push(next.cells[row]![c]!);
    raw.push(draftCellSource(next, row, c));
    source ||= next.sourceCells![row]![c]!;
    c += span;
  }
  next.cells[row]![start] = (source ? raw : values)
    .filter((x) => x !== "")
    .join(" ");
  next.sourceCells![row]![start] = source;
  next.spans![row]![start] = end - start + 1;
  const column = {
    ...next.columns![start]!,
    kind: "natural" as const,
    alignment:
      next.alignments[start] === "j"
        ? ("l" as const)
        : (next.alignments[start] as "l" | "c" | "r"),
    width: "",
  };
  next.spanSpecs![row]![start] = serializeTableColumns(
    [column],
    [next.verticalBorders![start]!, next.verticalBorders![end + 1]!],
  );
  for (let c = start + 1; c <= end; c++) {
    next.cells[row]![c] = "";
    next.sourceCells![row]![c] = false;
    next.spans![row]![c] = 0;
    next.spanSpecs![row]![c] = "";
  }
  return next;
}
export function splitTableCell(
  d: TableDraft,
  row: number,
  column: number,
): TableDraft {
  const col = tableCellAnchor(d, row, column),
    span = d.spans?.[row]?.[col] ?? 1;
  if (col < 0 || span < 2) throw new Error("Choose a merged cell to split.");
  const next = cloneTableDraft(d);
  for (let c = col; c < col + span; c++) {
    next.spans![row]![c] = 1;
    next.spanSpecs![row]![c] = "";
  }
  return next;
}
export function mergeTableCellsVertical(
  d: TableDraft,
  startRow: number,
  endRow: number,
  column: number,
): TableDraft {
  const nc = d.alignments.length,
    nr = d.cells.length;
  if (
    !Number.isInteger(startRow) ||
    !Number.isInteger(endRow) ||
    !Number.isInteger(column) ||
    startRow < 0 ||
    endRow <= startRow ||
    endRow >= nr ||
    column < 0 ||
    column >= nc ||
    !d.cells[startRow] ||
    tableRowAnchor(d, startRow, column) !== startRow
  )
    throw new Error("Select adjacent cells in one column to merge.");
  for (let r = startRow; r <= endRow; r++) {
    if ((d.spans?.[r]?.[column] ?? 1) !== 1)
      throw new Error("Split horizontal merges first, then merge vertically.");
    if (r > startRow && (d.rowSpans?.[r]?.[column] ?? 1) !== 1)
      throw new Error("Select the whole merged cell, or split it first.");
  }
  const anchorSpan = d.rowSpans?.[startRow]?.[column] ?? 1;
  if (anchorSpan !== 1)
    throw new Error("Select the whole merged cell, or split it first.");
  const endSpan = d.rowSpans?.[endRow]?.[column] ?? 1;
  if (endSpan !== 1)
    throw new Error("Select the whole merged cell, or split it first.");
  const next = cloneTableDraft(d),
    values: string[] = [],
    raw: string[] = [];
  let source = false;
  for (let r = startRow; r <= endRow; r++) {
    values.push(next.cells[r]![column]!);
    raw.push(draftCellSource(next, r, column));
    source ||= next.sourceCells![r]![column]!;
  }
  next.cells[startRow]![column] = (source ? raw : values)
    .filter((x) => x !== "")
    .join(" ");
  next.sourceCells![startRow]![column] = source;
  next.rowSpans![startRow]![column] = endRow - startRow + 1;
  next.rowSpanSpecs![startRow]![column] = "*";
  for (let r = startRow + 1; r <= endRow; r++) {
    next.cells[r]![column] = "";
    next.sourceCells![r]![column] = false;
    next.rowSpans![r]![column] = 0;
    next.rowSpanSpecs![r]![column] = "";
  }
  return next;
}
export function splitTableCellVertical(
  d: TableDraft,
  row: number,
  column: number,
): TableDraft {
  const anchor = tableRowAnchor(d, row, column),
    span = d.rowSpans?.[anchor]?.[column] ?? 1;
  if (anchor < 0 || span < 2) throw new Error("Choose a merged cell to split.");
  const next = cloneTableDraft(d);
  for (let r = anchor; r < anchor + span; r++) {
    next.rowSpans![r]![column] = 1;
    next.rowSpanSpecs![r]![column] = "";
  }
  return next;
}
function adjustClines(
  rules: TableRule[][],
  column: number,
  delta: 1 | -1,
): TableRule[][] {
  return rules.map((row) =>
    row.flatMap((rule) => {
      if (rule.kind !== "cline") return [{ ...rule }];
      let start = rule.start!,
        end = rule.end!;
      if (delta === 1) {
        if (column < start) start++;
        if (column <= end) end++;
      } else {
        if (column < start) start--;
        if (column <= end) end--;
      }
      return start > end ? [] : [{ kind: "cline" as const, start, end }];
    }),
  );
}
export function resizeTableGrid(
  d: TableDraft,
  axis: "row" | "column",
  index: number,
  action: "insert" | "delete",
  allowContentRemoval = false,
): TableDraft {
  const nr = d.cells.length,
    nc = d.alignments.length,
    n = axis === "row" ? nr : nc;
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index > (action === "insert" ? n : n - 1) ||
    (action === "delete" && n <= 1) ||
    (action === "insert" && n >= (axis === "row" ? 20 : 12))
  )
    throw new Error("Table size must stay within 20 rows and 12 columns.");
  if (
    action === "delete" &&
    !allowContentRemoval &&
    (axis === "row"
      ? d.cells[index]!.some(Boolean)
      : d.cells.some((r) => !!r[index]))
  )
    throw new Error(
      "This deletion removes cell content. Confirm the deletion first.",
    );
  const next = cloneTableDraft(d);
  if (axis === "row") {
    if (
      action === "insert" &&
      index < nr &&
      (next.rowSpans![index] ?? []).some((s) => s === 0)
    )
      throw new Error(
        "Split merged cells crossing this row before changing rows.",
      );
    if (action === "delete") {
      const rowSpans = next.rowSpans![index]!;
      if (rowSpans!.some((s) => s !== 1))
        throw new Error(
          "Split merged cells crossing this row before changing rows.",
        );
    }
    if (action === "insert") {
      next.cells.splice(index, 0, Array(nc).fill(""));
      next.sourceCells!.splice(index, 0, Array(nc).fill(false));
      next.spans!.splice(index, 0, Array(nc).fill(1));
      next.spanSpecs!.splice(index, 0, Array(nc).fill(""));
      next.rowSpans!.splice(index, 0, Array(nc).fill(1));
      next.rowSpanSpecs!.splice(index, 0, Array(nc).fill(""));
      next.rules!.splice(index === nr ? nr : index + 1, 0, []);
    } else {
      next.cells.splice(index, 1);
      next.sourceCells!.splice(index, 1);
      next.spans!.splice(index, 1);
      next.spanSpecs!.splice(index, 1);
      next.rowSpans!.splice(index, 1);
      next.rowSpanSpecs!.splice(index, 1);
      next.rules!.splice(index === nr - 1 ? index : index + 1, 1);
    }
  } else {
    if (
      next.cells.some((_, r) =>
        action === "insert"
          ? index < nc && tableCellAnchor(next, r, index) !== index
          : (next.spans![r]![index] ?? 1) !== 1,
      )
    )
      throw new Error(
        "Split merged cells crossing this column before changing columns.",
      );
    if (action === "insert") {
      next.cells.forEach((r) => r.splice(index, 0, ""));
      next.sourceCells!.forEach((r) => r.splice(index, 0, false));
      next.spans!.forEach((r) => r.splice(index, 0, 1));
      next.spanSpecs!.forEach((r) => r.splice(index, 0, ""));
      next.rowSpans!.forEach((r) => r.splice(index, 0, 1));
      next.rowSpanSpecs!.forEach((r) => r.splice(index, 0, ""));
      next.alignments.splice(index, 0, "l");
      next.columns!.splice(index, 0, {
        kind: "natural",
        alignment: "l",
        width: "",
      });
      next.verticalBorders!.splice(index === nc ? nc : index + 1, 0, 0);
    } else {
      next.cells.forEach((r) => r.splice(index, 1));
      next.sourceCells!.forEach((r) => r.splice(index, 1));
      next.spans!.forEach((r) => r.splice(index, 1));
      next.spanSpecs!.forEach((r) => r.splice(index, 1));
      next.rowSpans!.forEach((r) => r.splice(index, 1));
      next.rowSpanSpecs!.forEach((r) => r.splice(index, 1));
      next.alignments.splice(index, 1);
      next.columns!.splice(index, 1);
      next.verticalBorders![index] = Math.max(
        next.verticalBorders![index]!,
        next.verticalBorders![index + 1]!,
      );
      next.verticalBorders!.splice(index + 1, 1);
    }
    next.rules = adjustClines(
      next.rules!,
      index + 1,
      action === "insert" ? 1 : -1,
    );
  }
  return next;
}
export function tableBorderPreset(
  d: TableDraft,
  preset: "none" | "outer" | "grid" | "booktabs",
): TableDraft {
  const next = cloneTableDraft(d),
    nr = next.cells.length,
    nc = next.alignments.length;
  next.verticalBorders = Array.from({ length: nc + 1 }, (_, c) =>
    preset === "grid" || (preset === "outer" && (c === 0 || c === nc)) ? 1 : 0,
  );
  next.rules = Array.from({ length: nr + 1 }, (_, r): TableRule[] =>
    preset === "grid"
      ? [{ kind: "hline" }]
      : preset === "outer" && (r === 0 || r === nr)
        ? [{ kind: "hline" }]
        : preset === "booktabs"
          ? r === 0
            ? [{ kind: "toprule" }]
            : r === nr
              ? [{ kind: "bottomrule" }]
              : r === 1
                ? [{ kind: "midrule" }]
                : []
          : [],
  );
  syncSpanBorders(next);
  return next;
}
function syncSpanBorders(d: TableDraft) {
  d.cells.forEach((row, r) =>
    row.forEach((_, c) => {
      const span = d.spans![r]![c]!;
      const spec = d.spanSpecs![r]![c]!;
      if (span < 1 || !spec) return;
      const parsed = parseTableColumns(spec);
      if (!parsed || parsed.columns.length !== 1)
        throw new Error("Edit custom merged-cell columns in Source.");
      d.spanSpecs![r]![c] = serializeTableColumns(parsed.columns, [
        d.verticalBorders![c]!,
        d.verticalBorders![c + span]!,
      ]);
    }),
  );
}
/** An explicit border action also updates the multicolumn overrides at its edges. */
export function setTableVerticalBorder(
  d: TableDraft,
  boundary: number,
  value: number,
): TableDraft {
  if (
    !Number.isInteger(boundary) ||
    boundary < 0 ||
    boundary > d.alignments.length ||
    ![0, 1, 2].includes(value)
  )
    throw new Error("Invalid column border settings.");
  const next = cloneTableDraft(d);
  next.verticalBorders![boundary] = value;
  // Preserve unrelated local overrides; change only cells touching this boundary.
  next.cells.forEach((row, r) =>
    row.forEach((_, c) => {
      const span = next.spans![r]![c]!;
      const spec = next.spanSpecs![r]![c]!;
      if (span < 1 || !spec || (c !== boundary && c + span !== boundary))
        return;
      const parsed = parseTableColumns(spec);
      if (!parsed || parsed.columns.length !== 1)
        throw new Error("Edit custom merged-cell columns in Source.");
      const bars = [...parsed.borders];
      if (c === boundary) bars[0] = value;
      if (c + span === boundary) bars[1] = value;
      next.spanSpecs![r]![c] = serializeTableColumns(parsed.columns, bars);
    }),
  );
  return next;
}
