import {
  decodeVisualProse,
  encodeVisualProse,
  isVisualTexKey,
  readTexGroup,
  type VisualObjectBase,
  type VisualSourcePatch,
  type TexGroup,
} from "./visualObjectTypes";

export const TABLE_LIMITS = { rows: 20, columns: 12, pasteChars: 65536 };
export type VisualCell = {
  from: number;
  to: number;
  raw: string;
  text: string | null;
};
export type VisualTable = VisualObjectBase & {
  kind: "table";
  cells: VisualCell[][];
  alignments: string[];
  tabularFrom: number;
  tabularTo: number;
  columnsFrom: number;
  columnsTo: number;
  caption: (TexGroup & { text: string | null }) | null;
  label: TexGroup | null;
  wrapper: boolean;
  structureEditable: boolean;
  eol: string;
};
export type TableDraft = {
  cells: string[][];
  alignments: string[];
  caption: string;
  label: string;
};
function absoluteGroup(group: TexGroup, from: number): TexGroup {
  return {
    ...group,
    from: group.from + from,
    to: group.to + from,
    contentFrom: group.contentFrom + from,
    contentTo: group.contentTo + from,
  };
}

export function parseVisualTable(
  fragment: string,
  from = 0,
): VisualTable | null {
  if (fragment.length > 131072) return null;
  const start = fragment.indexOf("\\begin{tabular}");
  if (start < 0) return null;
  const group = readTexGroup(fragment, start + "\\begin{tabular}".length);
  if (!group || !/^[lcr|\s]+$/.test(group.value)) return null;
  const alignments = [...group.value].filter((c) => /[lcr]/.test(c));
  if (!alignments.length || alignments.length > TABLE_LIMITS.columns)
    return null;
  const end = fragment.indexOf("\\end{tabular}", group.to);
  if (end < 0 || fragment.indexOf("\\begin{tabular}", start + 1) >= 0)
    return null;
  const tabularTo = end + "\\end{tabular}".length;
  let outer =
    fragment.slice(0, start) +
    " ".repeat(tabularTo - start) +
    fragment.slice(tabularTo);
  const wrapper = /^\s*\\begin\{table\*?\}(?:\[[htbp!H]+\])?/.test(outer);
  if (wrapper) {
    const begin = /^\\begin\{(table\*?)\}/.exec(fragment.trimStart());
    if (!begin || !fragment.trimEnd().endsWith(`\\end{${begin[1]}}`))
      return null;
  }
  if (wrapper)
    outer = outer
      .replace(/^\s*\\begin\{table\*?\}(?:\[[htbp!H]+\])?/, (m) =>
        " ".repeat(m.length),
      )
      .replace(/\\end\{table\*?\}\s*$/, (m) => " ".repeat(m.length));
  let caption: VisualTable["caption"] = null,
    label: VisualTable["label"] = null;
  for (const name of ["caption", "label"] as const) {
    const regex = new RegExp(`\\\\${name}\\{`, "g");
    const found = regex.exec(outer);
    if (!found) continue;
    if (!wrapper) return null;
    const g = readTexGroup(fragment, found.index + name.length + 1);
    if (!g) return null;
    if (name === "caption")
      caption = { ...absoluteGroup(g, from), text: decodeVisualProse(g.value) };
    else label = absoluteGroup(g, from);
    outer =
      outer.slice(0, found.index) +
      " ".repeat(g.to - found.index) +
      outer.slice(g.to);
  }
  outer = outer.replace(/\\centering\b/g, "").replace(/%[^\r\n]*/g, "");
  if (outer.trim()) return null;
  const rows: VisualCell[][] = [];
  let row: VisualCell[] = [],
    cellStart = group.to,
    structureEditable = !/[|]/.test(group.value);
  const addCell = (to: number) => {
    let raw = fragment.slice(cellStart, to);
    const rules = /^(?:\s*\\(?:hline|toprule|midrule|bottomrule)\b)*/.exec(
      raw,
    )![0];
    if (rules.includes("\\")) {
      cellStart += rules.length;
      raw = fragment.slice(cellStart, to);
      structureEditable = false;
    }
    const leading = raw.length - raw.trimStart().length,
      trailing = raw.length - raw.trimEnd().length;
    const a = cellStart + leading,
      b = Math.max(a, to - trailing),
      content = fragment.slice(a, b);
    const text = decodeVisualProse(content);
    if (text === null) structureEditable = false;
    row.push({ from: from + a, to: from + b, raw: content, text });
  };
  for (let i = group.to; i < end; ) {
    const c = fragment[i];
    if (c === "%") {
      structureEditable = false;
      const nl = fragment.indexOf("\n", i);
      i = nl < 0 ? end : Math.min(nl + 1, end);
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
          : fragment.slice(i, i + 2);
      const close =
        delimiter === "\\(" ? "\\)" : delimiter === "\\[" ? "\\]" : delimiter;
      let j = i + delimiter.length;
      while (j < end && !fragment.startsWith(close, j)) {
        if (fragment[j] === "\\") j++;
        j++;
      }
      if (j >= end) return null;
      i = j + close.length;
      continue;
    }
    if (c === "\\" && fragment[i + 1] === "\\") {
      addCell(i);
      if (row.length !== alignments.length) return null;
      rows.push(row);
      row = [];
      i += 2;
      if (fragment[i] === "[") return null;
      cellStart = i;
      if (rows.length > TABLE_LIMITS.rows) return null;
      continue;
    }
    if (c === "&") {
      addCell(i);
      if (row.length >= alignments.length) return null;
      cellStart = ++i;
      continue;
    }
    i += c === "\\" ? 2 : 1;
  }
  if (
    row.length ||
    fragment
      .slice(cellStart, end)
      .replace(/\\(?:hline|bottomrule)\b/g, "")
      .trim()
  ) {
    addCell(end);
    if (row.length !== alignments.length) return null;
    rows.push(row);
  }
  if (!rows.length || rows.length > TABLE_LIMITS.rows) return null;
  return {
    kind: "table",
    from,
    to: from + fragment.length,
    source: fragment,
    cells: rows,
    alignments,
    tabularFrom: from + start,
    tabularTo: from + tabularTo,
    columnsFrom: from + group.contentFrom,
    columnsTo: from + group.contentTo,
    caption,
    label,
    wrapper,
    structureEditable,
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
  };
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
    .map((line) => line.split("\t"));
  if (lines.length > TABLE_LIMITS.rows)
    throw new Error("Pasted table exceeds 20 rows.");
  const width = Math.max(...lines.map((r) => r.length));
  if (row < 0 || column < 0 || row + lines.length > 20 || column + width > 12)
    throw new Error("Pasted table exceeds 20 rows or 12 columns.");
  const columns = Math.max(draft.alignments.length, column + width),
    rows = Math.max(draft.cells.length, row + lines.length);
  const cells = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: columns }, (_, c) => draft.cells[r]?.[c] ?? ""),
  );
  lines.forEach((line, r) =>
    line.forEach((text, c) => {
      cells[row + r]![column + c] = text;
    }),
  );
  return {
    ...draft,
    cells,
    alignments: Array.from(
      { length: columns },
      (_, c) => draft.alignments[c] ?? "l",
    ),
  };
}
export function patchesForVisualTable(
  model: VisualTable,
  draft: TableDraft,
): VisualSourcePatch[] {
  if (
    !draft.cells.length ||
    draft.cells.length > 20 ||
    !draft.alignments.length ||
    draft.alignments.length > 12 ||
    draft.cells.some((row) => row.length !== draft.alignments.length) ||
    draft.alignments.some((a) => !/^[lcr]$/.test(a)) ||
    draft.cells.flat().some((c) => c.length > 10000)
  )
    throw new Error("Invalid table size, alignment or cell length.");
  const structural =
    draft.cells.length !== model.cells.length ||
    draft.alignments.length !== model.alignments.length ||
    draft.alignments.some((a, i) => a !== model.alignments[i]);
  const patches: VisualSourcePatch[] = [];
  if (structural) {
    if (!model.structureEditable)
      throw new Error(
        "This table contains custom cells or rules. Change its structure in Source.",
      );
    const text =
      `\\begin{tabular}{${draft.alignments.join("")}}${model.eol}` +
      draft.cells
        .map((r) => r.map(encodeVisualProse).join(" & ") + " \\\\")
        .join(model.eol) +
      `${model.eol}\\end{tabular}`;
    patches.push({
      from: model.tabularFrom,
      to: model.tabularTo,
      insert: text,
    });
  } else
    draft.cells.forEach((row, r) =>
      row.forEach((value, c) => {
        const cell = model.cells[r]![c]!;
        if (value !== (cell.text ?? cell.raw)) {
          if (cell.text === null)
            throw new Error("Edit custom cell markup in Source.");
          patches.push({
            from: cell.from,
            to: cell.to,
            insert: encodeVisualProse(value),
          });
        }
      }),
    );
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
      insert: encodeVisualProse(draft.caption),
    });
  }
  if (model.label && draft.label !== model.label.value)
    patches.push({
      from: model.label.contentFrom,
      to: model.label.contentTo,
      insert: draft.label,
    });
  let suffix = "";
  if (model.wrapper && !model.caption && draft.caption)
    suffix += `\\caption{${encodeVisualProse(draft.caption)}}${model.eol}`;
  if (model.wrapper && !model.label && draft.label)
    suffix += `\\label{${draft.label}}${model.eol}`;
  if (suffix) {
    const end = model.source.lastIndexOf("\\end{table");
    patches.push({
      from: model.from + end,
      to: model.from + end,
      insert: suffix,
    });
  }
  return patches.sort((a, b) => a.from - b.from);
}
