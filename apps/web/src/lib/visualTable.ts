import {
  maskVisualComments,
  decodeVisualProse,
  encodeVisualProse,
  isVisualTexKey,
  readTexGroup,
  type VisualObjectBase,
  type VisualSourcePatch,
  type TexGroup,
} from "./visualObjectTypes";
import { parseTableCellContent, type TableCellNode } from "./tableCellContent";
import {
  parseTableColumns,
  serializeTableColumns,
  isTableDimension,
  type TableColumn,
} from "./visualTableColumns";
export { isTableDimension } from "./visualTableColumns";
export const TABLE_LIMITS = { rows: 20, columns: 12, pasteChars: 65536 };
export type TableRule = {
  kind: "hline" | "toprule" | "midrule" | "bottomrule" | "cline";
  start?: number;
  end?: number;
};
export type VisualCell = {
  from: number;
  to: number;
  raw: string;
  text: string | null;
  nodes: TableCellNode[] | null;
  colSpan: number;
  spanSpec: string;
  coveredBy: number | null;
};
export type VisualTable = VisualObjectBase & {
  kind: "table";
  cells: VisualCell[][];
  alignments: string[];
  columns: TableColumn[];
  verticalBorders: number[];
  rules: TableRule[][];
  tabularFrom: number;
  tabularTo: number;
  columnsFrom: number;
  columnsTo: number;
  bodyFrom: number;
  bodyTo: number;
  environment: "tabular" | "tabularx" | "longtable";
  tableWidth: TexGroup | null;
  caption: (TexGroup & { text: string | null }) | null;
  label: TexGroup | null;
  wrapper: boolean;
  structureEditable: boolean;
  structureReason: string;
  eol: string;
};
export type TableDraft = {
  cells: string[][];
  alignments: string[];
  caption: string;
  label: string;
  columns?: TableColumn[];
  verticalBorders?: number[];
  rules?: TableRule[][];
  spans?: number[][];
  spanSpecs?: string[][];
  sourceCells?: boolean[][];
  tableWidth?: string;
};
const abs = (g: TexGroup, offset: number): TexGroup => ({
  ...g,
  from: g.from + offset,
  to: g.to + offset,
  contentFrom: g.contentFrom + offset,
  contentTo: g.contentTo + offset,
});
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
function skipSpace(source: string, i: number) {
  while (i < source.length && /\s/.test(source[i]!)) i++;
  return i;
}
export function parseVisualTable(
  fragment: string,
  from = 0,
): VisualTable | null {
  if (fragment.length > 131072) return null;
  const scan = maskVisualComments(fragment);
  const start = /\\begin\{(tabularx|tabular|longtable)\}/.exec(scan);
  if (!start) return null;
  const environment = start[1] as VisualTable["environment"];
  let cursor = skipSpace(scan, start.index + start[0].length),
    tableWidth: TexGroup | null = null;
  if (environment === "tabularx") {
    const width = readTexGroup(fragment, cursor);
    if (!width || !isTableDimension(width.value)) return null;
    tableWidth = abs(width, from);
    cursor = skipSpace(scan, width.to);
  }
  if (scan[cursor] === "[") {
    const optional = /^\[(?:[tbc]|[lcr])\]/.exec(scan.slice(cursor));
    if (!optional) return null;
    cursor = skipSpace(scan, cursor + optional[0].length);
  }
  const group = readTexGroup(fragment, cursor);
  if (!group) return null;
  const columnModel = parseTableColumns(
    group.value,
    environment === "tabularx",
  );
  if (!columnModel) return null;
  const columns = columnModel.columns,
    alignments = columns.map((c) => c.alignment);
  const close = `\\end{${environment}}`,
    end = scan.indexOf(close, group.to);
  if (end < 0) return null;
  if (
    /\\begin\{(?:tabularx|tabular|longtable)\}/.test(scan.slice(group.to, end))
  )
    return null;
  const tabularTo = end + close.length;
  let outer =
    scan.slice(0, start.index) +
    " ".repeat(tabularTo - start.index) +
    scan.slice(tabularTo);
  const float = /^\s*\\begin\{(table\*?)\}(?:\[[htbp!H]+\])?/.exec(outer);
  if (float) {
    if (
      environment === "longtable" ||
      !scan.trimEnd().endsWith(`\\end{${float[1]}}`)
    )
      return null;
    outer = outer
      .replace(/^\s*\\begin\{table\*?\}(?:\[[htbp!H]+\])?/, (m) =>
        " ".repeat(m.length),
      )
      .replace(/\\end\{table\*?\}\s*$/, (m) => " ".repeat(m.length));
  }
  let caption: VisualTable["caption"] = null,
    label: TexGroup | null = null;
  for (const name of ["caption", "label"] as const) {
    const match = new RegExp(`\\\\${name}\\{`).exec(outer);
    if (!match) continue;
    if (!float) return null;
    const g = readTexGroup(fragment, match.index + name.length + 1);
    if (!g) return null;
    if (name === "caption")
      caption = { ...abs(g, from), text: decodeVisualProse(g.value) };
    else label = abs(g, from);
    outer =
      outer.slice(0, match.index) +
      " ".repeat(g.to - match.index) +
      outer.slice(g.to);
  }
  if (outer.replace(/\\centering\b/g, "").trim()) return null;
  let bodyFrom = group.to;
  if (environment === "longtable") {
    let i = skipSpace(scan, bodyFrom),
      found = false;
    for (let n = 0; n < 2; n++) {
      const cmd = /^\\(caption|label)\{/.exec(scan.slice(i));
      if (!cmd) break;
      const g = readTexGroup(fragment, i + cmd[0].length - 1);
      if (!g) return null;
      if (cmd[1] === "caption") {
        if (caption) return null;
        caption = { ...abs(g, from), text: decodeVisualProse(g.value) };
      } else {
        if (label) return null;
        label = abs(g, from);
      }
      found = true;
      i = skipSpace(scan, g.to);
    }
    if (found) {
      if (caption) {
        if (!scan.startsWith("\\\\", i)) return null;
        i += 2;
      }
      bodyFrom = i;
    }
  }
  const rows: VisualCell[][] = [],
    rules: TableRule[][] = [];
  let row: VisualCell[] = [],
    cellStart = bodyFrom,
    structureEditable = true,
    structureReason = "";
  const protect = (reason: string) => {
    structureEditable = false;
    structureReason ||= reason;
  };
  function boundary(at: number): number | null {
    const boundaryRules: TableRule[] = [];
    let i = at;
    while (i < end) {
      if (/\s/.test(fragment[i]!)) {
        i++;
        continue;
      }
      if (fragment[i] === "%") {
        protect(
          "Comments between rows are preserved; change the table structure in Source.",
        );
        const nl = fragment.indexOf("\n", i);
        i = nl < 0 ? end : Math.min(nl + 1, end);
        continue;
      }
      const rule = /^\\(hline|toprule|midrule|bottomrule)\b/.exec(
        scan.slice(i),
      );
      if (rule) {
        boundaryRules.push({ kind: rule[1] as TableRule["kind"] });
        i += rule[0].length;
        if (scan[i] === "[") return null;
        continue;
      }
      const line = /^\\cline\{(\d+)-(\d+)\}/.exec(scan.slice(i));
      if (line) {
        const a = Number(line[1]),
          b = Number(line[2]);
        if (a < 1 || b < a || b > columns.length) return null;
        boundaryRules.push({ kind: "cline", start: a, end: b });
        i += line[0].length;
        continue;
      }
      const section = /^\\end(?:firsthead|head|foot|lastfoot)\b/.exec(
        scan.slice(i),
      );
      if (section) {
        if (environment !== "longtable") return null;
        protect(
          "Repeated longtable headers and footers are preserved; edit structure in Source.",
        );
        i += section[0].length;
        continue;
      }
      break;
    }
    rules.push(boundaryRules);
    return i;
  }
  const initial = boundary(bodyFrom);
  if (initial === null) return null;
  cellStart = initial;
  function addCell(to: number): boolean {
    const whole = fragment.slice(cellStart, to),
      lead = whole.length - whole.trimStart().length,
      trail = whole.length - whole.trimEnd().length;
    let a = cellStart + lead,
      b = Math.max(a, to - trail),
      raw = fragment.slice(a, b),
      colSpan = 1,
      spanSpec = "";
    if (raw.startsWith("\\multicolumn")) {
      const command = /^\\multicolumn\s*/.exec(raw);
      if (!command) return false;
      const count = readTexGroup(raw, command[0].length);
      if (!count || !/^\d+$/.test(count.value)) return false;
      colSpan = Number(count.value);
      if (colSpan < 1 || colSpan > columns.length) return false;
      const spec = readTexGroup(raw, skipSpace(raw, count.to));
      if (!spec) return false;
      const parsedSpec = parseTableColumns(spec.value);
      if (!parsedSpec || parsedSpec.columns.length !== 1) return false;
      const content = readTexGroup(raw, skipSpace(raw, spec.to));
      if (!content || content.to !== raw.length) return false;
      spanSpec = spec.value;
      const offset = content.contentFrom,
        inner = content.value,
        leading = inner.length - inner.trimStart().length,
        trailing = inner.length - inner.trimEnd().length;
      b = a + content.contentTo - trailing;
      a += offset + leading;
      raw = fragment.slice(a, b);
    }
    const text = decodeVisualProse(raw),
      nodes = parseTableCellContent(raw);
    if (nodes === null)
      protect(
        "Custom cells are preserved; edit their markup and the table structure in Source.",
      );
    const c = row.length;
    if (c + colSpan > columns.length) return false;
    row.push({
      from: from + a,
      to: from + b,
      raw,
      text,
      nodes,
      colSpan,
      spanSpec,
      coveredBy: null,
    });
    for (let n = 1; n < colSpan; n++)
      row.push({
        from: from + b,
        to: from + b,
        raw: "",
        text: "",
        nodes: [],
        colSpan: 0,
        spanSpec: "",
        coveredBy: c,
      });
    return true;
  }
  let i = cellStart;
  while (i < end) {
    const c = fragment[i];
    if (c === "%") {
      protect("Comments inside cells are preserved; edit structure in Source.");
      const nl = fragment.indexOf("\n", i);
      i = nl < 0 ? end : Math.min(end, nl + 1);
      continue;
    }
    if (c === "{") {
      const g = readTexGroup(fragment, i);
      if (!g || g.to > end) return null;
      i = g.to;
      continue;
    }
    if (
      c === "}" ||
      fragment.startsWith("\\begin{", i) ||
      fragment.startsWith("\\end{", i)
    )
      return null;
    if (
      c === "$" ||
      fragment.startsWith("\\(", i) ||
      fragment.startsWith("\\[", i)
    ) {
      const delimiter =
          c === "$"
            ? fragment[i + 1] === "$"
              ? "$$"
              : "$"
            : fragment.slice(i, i + 2),
        closing =
          delimiter === "\\(" ? "\\)" : delimiter === "\\[" ? "\\]" : delimiter;
      let j = i + delimiter.length;
      while (j < end && !fragment.startsWith(closing, j)) {
        if (fragment[j] === "\\") j++;
        j++;
      }
      if (j >= end) return null;
      i = j + closing.length;
      continue;
    }
    if (c === "\\" && fragment[i + 1] === "\\") {
      if (!addCell(i) || row.length !== columns.length) return null;
      rows.push(row);
      row = [];
      i += 2;
      if (scan[i] === "[") return null;
      if (rows.length > TABLE_LIMITS.rows) return null;
      const next = boundary(i);
      if (next === null) return null;
      i = next;
      cellStart = i;
      continue;
    }
    if (c === "&") {
      if (!addCell(i) || row.length >= columns.length) return null;
      cellStart = ++i;
      continue;
    }
    i += c === "\\" ? 2 : 1;
  }
  if (row.length || fragment.slice(cellStart, end).trim()) {
    if (!addCell(end) || row.length !== columns.length) return null;
    rows.push(row);
    rules.push([]);
  }
  if (!rows.length || rows.length > TABLE_LIMITS.rows) return null;
  while (rules.length < rows.length + 1) rules.push([]);
  return {
    kind: "table",
    from,
    to: from + fragment.length,
    source: fragment,
    cells: rows,
    alignments,
    columns,
    verticalBorders: columnModel.borders,
    rules,
    tabularFrom: from + start.index,
    tabularTo: from + tabularTo,
    columnsFrom: from + group.contentFrom,
    columnsTo: from + group.contentTo,
    bodyFrom: from + bodyFrom,
    bodyTo: from + end,
    environment,
    tableWidth,
    caption,
    label,
    wrapper: !!float || environment === "longtable",
    structureEditable,
    structureReason,
    eol: fragment.includes("\r\n") ? "\r\n" : "\n",
  };
}
export function createVisualTable(rows = 2, columns = 2, eol = "\n"): string {
  if (
    !Number.isInteger(rows) ||
    rows < 1 ||
    rows > 20 ||
    !Number.isInteger(columns) ||
    columns < 1 ||
    columns > 12
  )
    throw new Error("Table size must be 1–20 rows and 1–12 columns.");
  return (
    `\\begin{table}[htbp]${eol}\\centering${eol}\\begin{tabular}{${"l".repeat(columns)}}${eol}` +
    Array.from(
      { length: rows },
      () => Array(columns).fill("").join(" & ") + " \\\\",
    ).join(eol) +
    `${eol}\\end{tabular}${eol}\\caption{}${eol}\\label{tab:new}${eol}\\end{table}`
  );
}
export function tableDraft(model: VisualTable): TableDraft {
  return {
    cells: model.cells.map((row) => row.map((c) => c.text ?? c.raw)),
    alignments: [...model.alignments],
    caption: model.caption?.text ?? model.caption?.value ?? "",
    label: model.label?.value ?? "",
    columns: model.columns.map((c) => ({ ...c })),
    verticalBorders: [...model.verticalBorders],
    rules: model.rules.map((r) => r.map((x) => ({ ...x }))),
    spans: model.cells.map((r) => r.map((c) => c.colSpan)),
    spanSpecs: model.cells.map((r) => r.map((c) => c.spanSpec)),
    sourceCells: model.cells.map((r) => r.map((c) => c.text === null)),
    tableWidth: model.tableWidth?.value,
  };
}
export function draftCellSource(
  draft: TableDraft,
  r: number,
  c: number,
): string {
  const value = draft.cells[r]![c]!;
  if (draft.sourceCells?.[r]?.[c]) {
    if (!parseTableCellContent(value))
      throw new Error(
        `Row ${r + 1}, column ${c + 1}: unsupported cell LaTeX. Keep custom commands in Source.`,
      );
    return value;
  }
  return encodeVisualProse(value);
}
function draftColumns(model: VisualTable, draft: TableDraft): TableColumn[] {
  return draft.alignments.map((a, c) => ({
    ...(draft.columns?.[c] ??
      model.columns[c] ?? { kind: "natural", width: "" }),
    alignment: a as TableColumn["alignment"],
  }));
}
function validateRules(rules: TableRule[][], rows: number, columns: number) {
  if (
    rules.length !== rows + 1 ||
    rules.some(
      (r) =>
        r.length > 24 ||
        r.some(
          (x) =>
            !["hline", "toprule", "midrule", "bottomrule", "cline"].includes(
              x.kind,
            ) ||
            (x.kind === "cline" &&
              (!Number.isInteger(x.start) ||
                !Number.isInteger(x.end) ||
                x.start! < 1 ||
                x.end! < x.start! ||
                x.end! > columns)),
        ),
    )
  )
    throw new Error("Invalid horizontal border range.");
}
function serializeRules(rules: TableRule[], eol: string) {
  return rules
    .map((r) =>
      r.kind === "cline" ? `\\cline{${r.start}-${r.end}}` : `\\${r.kind}`,
    )
    .join(eol);
}
export function patchesForVisualTable(
  model: VisualTable,
  draft: TableDraft,
): VisualSourcePatch[] {
  const nr = draft.cells.length,
    nc = draft.alignments.length;
  if (
    nr < 1 ||
    nr > 20 ||
    nc < 1 ||
    nc > 12 ||
    draft.cells.some((r) => r.length !== nc) ||
    draft.cells.flat().some((c) => c.length > 10000) ||
    draft.caption.length > 10000
  )
    throw new Error("Invalid table size or cell length.");
  const columns = draftColumns(model, draft),
    borders =
      draft.verticalBorders?.length === nc + 1
        ? draft.verticalBorders
        : Array(nc + 1).fill(0);
  const spec = serializeTableColumns(columns, borders);
  if (columns.some((c) => c.kind === "X") && model.environment !== "tabularx")
    throw new Error(
      "Flexible X columns require a tabularx table. Change the environment in Source.",
    );
  const spans = draft.cells.map((row, r) =>
    row.map((_, c) => draft.spans?.[r]?.[c] ?? 1),
  );
  for (let r = 0; r < nr; r++)
    for (let c = 0; c < nc; ) {
      const span = spans[r]![c]!;
      if (!Number.isInteger(span) || span < 1 || c + span > nc)
        throw new Error("Invalid merged cell range.");
      for (let k = 1; k < span; k++)
        if (spans[r]![c + k] !== 0 || draft.cells[r]![c + k] !== "")
          throw new Error(
            "A merged cell would discard content. Split it first.",
          );
      c += span;
    }
  const rules =
    draft.rules?.length === nr + 1
      ? draft.rules
      : Array.from({ length: nr + 1 }, (_, r) => model.rules[r] ?? []);
  validateRules(rules, nr, nc);
  const gridChanged =
    nr !== model.cells.length ||
    nc !== model.columns.length ||
    !same(
      spans,
      model.cells.map((r) => r.map((c) => c.colSpan)),
    ) ||
    !same(
      draft.spanSpecs ?? model.cells.map((r) => r.map((c) => c.spanSpec)),
      model.cells.map((r) => r.map((c) => c.spanSpec)),
    ) ||
    !same(rules, model.rules);
  const patches: VisualSourcePatch[] = [];
  const sourceFor = (r: number, c: number) => {
    const before = model.cells[r]?.[c],
      mode = draft.sourceCells?.[r]?.[c] ?? false,
      value = draft.cells[r]![c]!;
    if (
      before &&
      value === (before.text ?? before.raw) &&
      mode === (before.text === null)
    )
      return before.raw;
    return draftCellSource(draft, r, c).replace(/\r?\n/g, model.eol);
  };
  if (gridChanged) {
    if (!model.structureEditable)
      throw new Error(
        model.structureReason || "Edit this table structure in Source.",
      );
    const body = rules
      .map((rule, r) => {
        const border = serializeRules(rule, model.eol);
        if (r === nr) return border;
        const cells: string[] = [];
        for (let c = 0; c < nc; ) {
          const span = spans[r]![c]!,
            source = sourceFor(r, c),
            old = model.cells[r]?.[c];
          if (old?.nodes === null)
            throw new Error("Edit custom cell markup in Source.");
          const override = draft.spanSpecs?.[r]?.[c] ?? "";
          if (span > 1 || override) {
            const parsed = parseTableColumns(override || columns[c]!.alignment);
            if (!parsed || parsed.columns.length !== 1)
              throw new Error("Invalid merged-cell alignment.");
            cells.push(
              `\\multicolumn{${span}}{${override || columns[c]!.alignment}}{${source}}`,
            );
          } else cells.push(source);
          c += span;
        }
        return (border ? border + model.eol : "") + cells.join(" & ") + " \\\\";
      })
      .filter(Boolean)
      .join(model.eol);
    patches.push({
      from: model.bodyFrom,
      to: model.bodyTo,
      insert: model.eol + body + model.eol,
    });
  } else {
    draft.cells.forEach((row, r) =>
      row.forEach((value, c) => {
        if (spans[r]![c] === 0) return;
        const before = model.cells[r]![c]!;
        const mode = draft.sourceCells?.[r]?.[c] ?? false;
        if (
          value === (before.text ?? before.raw) &&
          mode === (before.text === null)
        )
          return;
        if (before.nodes === null)
          throw new Error("Edit custom cell markup in Source.");
        patches.push({
          from: before.from,
          to: before.to,
          insert: sourceFor(r, c),
        });
      }),
    );
  }
  if (!same(columns, model.columns) || !same(borders, model.verticalBorders))
    patches.push({
      from: model.columnsFrom,
      to: model.columnsTo,
      insert: spec,
    });
  if (
    model.tableWidth &&
    draft.tableWidth !== undefined &&
    draft.tableWidth !== model.tableWidth.value
  ) {
    if (!isTableDimension(draft.tableWidth))
      throw new Error("Use a supported positive table width.");
    patches.push({
      from: model.tableWidth.contentFrom,
      to: model.tableWidth.contentTo,
      insert: draft.tableWidth,
    });
  }
  if (
    draft.label !== model.label?.value &&
    draft.label &&
    !isVisualTexKey(draft.label)
  )
    throw new Error("Use a simple label key without LaTeX commands.");
  if (
    model.caption &&
    draft.caption !== (model.caption.text ?? model.caption.value)
  ) {
    if (model.caption.text === null)
      throw new Error("Edit custom caption markup in Source.");
    patches.push({
      from: model.caption.contentFrom,
      to: model.caption.contentTo,
      insert: encodeVisualProse(draft.caption).replace(/\r?\n/g, model.eol),
    });
  }
  if (model.label && draft.label !== model.label.value)
    patches.push({
      from: model.label.contentFrom,
      to: model.label.contentTo,
      insert: draft.label,
    });
  let extra = "";
  if (model.wrapper && !model.caption && draft.caption)
    extra += `\\caption{${encodeVisualProse(draft.caption)}}${model.eol}`;
  if (model.wrapper && !model.label && draft.label)
    extra += `\\label{${draft.label}}${model.eol}`;
  if (extra) {
    if (model.environment === "longtable") {
      if (!model.caption && draft.caption)
        extra = extra.trimEnd() + `\\\\${model.eol}`;
      patches.push({ from: model.bodyFrom, to: model.bodyFrom, insert: extra });
    } else {
      const end = maskVisualComments(model.source).lastIndexOf("\\end{table");
      patches.push({
        from: model.from + end,
        to: model.from + end,
        insert: extra,
      });
    }
  }
  return patches.sort((a, b) => a.from - b.from || a.to - b.to);
}
export function requiredTablePackages(model: VisualTable): string[] {
  const packages = new Set<string>();
  if (model.environment !== "tabular") packages.add(model.environment);
  const specs = [
    ...model.columns,
    ...model.cells
      .flat()
      .filter((c) => c.colSpan > 0 && c.spanSpec)
      .flatMap((c) => parseTableColumns(c.spanSpec)?.columns ?? []),
  ];
  if (
    specs.some(
      (c) =>
        c.kind === "m" ||
        c.kind === "b" ||
        (c.kind !== "natural" && c.alignment !== "j"),
    )
  )
    packages.add("array");
  if (
    model.rules
      .flat()
      .some((r) => ["toprule", "midrule", "bottomrule"].includes(r.kind))
  )
    packages.add("booktabs");
  return [...packages];
}
export function pasteTableTsv(
  draft: TableDraft,
  row: number,
  column: number,
  value: string,
): TableDraft {
  if (value.length > TABLE_LIMITS.pasteChars)
    throw new Error("Pasted table exceeds 64 Ki characters.");
  const lines = value
    .replace(/\r\n/g, "\n")
    .replace(/\n$/, "")
    .split("\n")
    .map((l) => l.split("\t"));
  if (lines.length > 20) throw new Error("Pasted table exceeds 20 rows.");
  const width = Math.max(...lines.map((r) => r.length));
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(column) ||
    row < 0 ||
    column < 0 ||
    row + lines.length > 20 ||
    column + width > 12
  )
    throw new Error("Pasted table exceeds 20 rows or 12 columns.");
  const nc = Math.max(draft.alignments.length, column + width),
    nr = Math.max(draft.cells.length, row + lines.length);
  const cells = Array.from({ length: nr }, (_, r) =>
    Array.from({ length: nc }, (_, c) => draft.cells[r]?.[c] ?? ""),
  );
  const sourceCells = Array.from({ length: nr }, (_, r) =>
    Array.from({ length: nc }, (_, c) => draft.sourceCells?.[r]?.[c] ?? false),
  );
  lines.forEach((line, r) =>
    line.forEach((text, c) => {
      if ((draft.spans?.[row + r]?.[column + c] ?? 1) !== 1)
        throw new Error("Paste overlaps a merged cell. Split it first.");
      cells[row + r]![column + c] = text;
      sourceCells[row + r]![column + c] = false;
    }),
  );
  return {
    ...draft,
    cells,
    sourceCells,
    alignments: Array.from(
      { length: nc },
      (_, c) => draft.alignments[c] ?? "l",
    ),
    columns: Array.from(
      { length: nc },
      (_, c) =>
        draft.columns?.[c] ?? { kind: "natural", alignment: "l", width: "" },
    ),
    spans: Array.from({ length: nr }, (_, r) =>
      Array.from({ length: nc }, (_, c) => draft.spans?.[r]?.[c] ?? 1),
    ),
    spanSpecs: Array.from({ length: nr }, (_, r) =>
      Array.from({ length: nc }, (_, c) => draft.spanSpecs?.[r]?.[c] ?? ""),
    ),
    verticalBorders: Array.from(
      { length: nc + 1 },
      (_, c) => draft.verticalBorders?.[c] ?? 0,
    ),
    rules: Array.from({ length: nr + 1 }, (_, r) => draft.rules?.[r] ?? []),
  };
}
