import { readTexGroup } from "./visualObjectTypes";
export type TableColumn = {
  kind: "natural" | "p" | "m" | "b" | "X";
  alignment: "l" | "c" | "r" | "j";
  width: string;
};
export type TableColumns = { columns: TableColumn[]; borders: number[] };
export function isTableDimension(value: string): boolean {
  const s = value.trim();
  const relative = /^(?:(0?\.\d+|1(?:\.0+)?))?\\(?:textwidth|linewidth)$/.exec(
    s,
  );
  if (relative) return !relative[1] || Number(relative[1]) > 0;
  const absolute = /^(\d+(?:\.\d+)?|\.\d+)(cm|mm|in|pt|em|ex)$/.exec(s);
  if (!absolute) return false;
  const n = Number(absolute[1]);
  return (
    n > 0 &&
    n <=
      ({ cm: 50, mm: 500, in: 20, pt: 1500, em: 100, ex: 100 }[absolute[2]!] ??
        0)
  );
}
export function parseTableColumns(
  spec: string,
  allowX = false,
): TableColumns | null {
  const columns: TableColumn[] = [],
    borders = [0];
  let i = 0;
  while (i < spec.length) {
    if (/\s/.test(spec[i]!)) {
      i++;
      continue;
    }
    if (spec[i] === "|") {
      if (++borders[columns.length]! > 2) return null;
      i++;
      continue;
    }
    let alignment: TableColumn["alignment"] | null = null;
    if (spec[i] === ">") {
      const g = readTexGroup(spec, i + 1);
      if (!g) return null;
      const command = g.value.replace(/\s/g, "");
      alignment =
        command === "\\raggedright\\arraybackslash"
          ? "l"
          : command === "\\centering\\arraybackslash"
            ? "c"
            : command === "\\raggedleft\\arraybackslash"
              ? "r"
              : null;
      if (!alignment) return null;
      i = g.to;
    }
    const kind = spec[i++];
    if (kind && /[lcr]/.test(kind)) {
      if (alignment) return null;
      columns.push({
        kind: "natural",
        alignment: kind as "l" | "c" | "r",
        width: "",
      });
    } else if (kind && /[pmbX]/.test(kind)) {
      let width = "";
      if (kind === "X") {
        if (!allowX) return null;
      } else {
        const g = readTexGroup(spec, i);
        if (!g || !isTableDimension(g.value)) return null;
        width = g.value;
        i = g.to;
      }
      columns.push({
        kind: kind as "p" | "m" | "b" | "X",
        alignment: alignment ?? "j",
        width,
      });
    } else return null;
    if (columns.length > 12) return null;
    borders.push(0);
  }
  return columns.length ? { columns, borders } : null;
}
export function serializeTableColumns(
  columns: TableColumn[],
  borders: number[],
): string {
  if (
    !columns.length ||
    columns.length > 12 ||
    borders.length !== columns.length + 1 ||
    borders.some((b) => !Number.isInteger(b) || b < 0 || b > 2)
  )
    throw new Error("Invalid column border settings.");
  const spec =
    columns
      .map((col, i) => {
        if (!["l", "c", "r", "j"].includes(col.alignment))
          throw new Error("Invalid column alignment.");
        let value = "";
        if (col.kind === "natural") {
          if (col.alignment === "j")
            throw new Error("Justified text needs a wrapping column.");
          value = col.alignment;
        } else if (["p", "m", "b", "X"].includes(col.kind)) {
          const prefix =
            col.alignment === "j"
              ? ""
              : `>{\\${col.alignment === "l" ? "raggedright" : col.alignment === "c" ? "centering" : "raggedleft"}\\arraybackslash}`;
          if (col.kind !== "X" && !isTableDimension(col.width))
            throw new Error(
              "Use a positive width, such as 3cm or 0.25\\textwidth.",
            );
          value =
            prefix + col.kind + (col.kind === "X" ? "" : `{${col.width}}`);
        } else throw new Error("Unknown column type.");
        return "|".repeat(borders[i]!) + value;
      })
      .join("") + "|".repeat(borders.at(-1)!);
  return spec;
}
export function tableDimensionCss(value: string): string | undefined {
  if (!isTableDimension(value)) return undefined;
  const match = /^(.*?)\\(?:textwidth|linewidth)$/.exec(value);
  return match ? `${Number(match[1] || 1) * 100}%` : value;
}
