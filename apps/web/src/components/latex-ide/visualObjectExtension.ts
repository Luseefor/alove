import { StateField, StateEffect, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { parseVisualObjects, type VisualObject } from "@/lib/visualObjects";
import { safeFigureAsset } from "@/lib/visualFigure";
import type { VisualTable } from "@/lib/visualTable";
import { tableDimensionCss, parseTableColumns } from "@/lib/visualTableColumns";
import { renderTableCellContent } from "./TableCellPreview";
import { renderMathPreview } from "./MathPreview";

export const refreshVisualObjectAssets = StateEffect.define<null>();

type Options = {
  getAssets: () => Record<string, string>;
  getView: () => EditorView | null;
  onOpen: (
    object: VisualObject,
    source: string,
    cell?: { row: number; column: number },
  ) => void;
};
function tableVerticalBorder(width: number | undefined): string {
  if (width === 2) return "3px double var(--border)";
  if (width === 1) return "1px solid var(--border)";
  return "0px solid var(--border)";
}
function tableHorizontalBorder(
  rules: VisualTable["rules"][number] | undefined,
  column: number,
  span: number,
): string {
  const relevant = (rules ?? []).filter(
    (rule) =>
      rule.kind !== "cline" ||
      (typeof rule.start === "number" &&
        typeof rule.end === "number" &&
        rule.start <= column + span &&
        rule.end >= column + 1),
  );
  if (!relevant.length) return "0px solid var(--border)";
  const hlines = relevant.filter((rule) => rule.kind === "hline").length;
  if (hlines >= 2) return "3px double var(--border)";
  if (hlines === 1) return "1px solid var(--border)";
  if (
    relevant.some(
      (rule) => rule.kind === "toprule" || rule.kind === "bottomrule",
    )
  )
    return "2px solid var(--foreground)";
  if (relevant.some((rule) => rule.kind === "midrule"))
    return "1px solid var(--foreground)";
  return "1px solid var(--border)";
}
function spanOverride(spec: string): {
  alignment: string;
  kind: string;
  width: string;
  left: number;
  right: number;
} | null {
  if (!spec) return null;
  const parsed = parseTableColumns(spec);
  const column = parsed?.columns[0];
  if (!parsed || !column || parsed.columns.length !== 1) return null;
  return {
    alignment: column.alignment,
    kind: column.kind,
    width: column.width,
    left: parsed.borders[0] ?? 0,
    right: parsed.borders[1] ?? 0,
  };
}
export function buildVisualTablePreview(
  object: VisualTable,
  open: (cell: { row: number; column: number }) => void,
): HTMLDivElement {
  const frame = document.createElement("div");
  frame.className = "cm-visual-table-scroll";
  const table = document.createElement("table");
  table.setAttribute("aria-label", "Visual table preview");
  const tableWidth = object.tableWidth
    ? tableDimensionCss(object.tableWidth.value)
    : undefined;
  if (tableWidth) table.style.width = tableWidth;
  if (object.columns.length) {
    const group = document.createElement("colgroup");
    object.columns.forEach((column) => {
      const col = document.createElement("col");
      const width = column.width ? tableDimensionCss(column.width) : undefined;
      if (width) col.style.width = width;
      group.appendChild(col);
    });
    table.appendChild(group);
  }
  object.cells.forEach((row, r) => {
    if (
      object.longtableMarkers?.some(Boolean) &&
      (r === 0 || object.longtableMarkers[r])
    ) {
      const nextMarker = object.longtableMarkers.slice(r + 1).find(Boolean);
      const sectionNames: Record<string, string> = {
        endfirsthead: "First page header",
        endhead: "Repeated header",
        endfoot: "Repeated footer",
        endlastfoot: "Last page footer",
      };
      const section = document.createElement("tr");
      const label = document.createElement("th");
      label.colSpan = object.columns.length;
      label.textContent = nextMarker
        ? (sectionNames[nextMarker] ?? "Body")
        : "Body";
      label.scope = "colgroup";
      section.appendChild(label);
      table.appendChild(section);
    }
    const tr = document.createElement("tr");
    row.forEach((cell, c) => {
      if (cell.colSpan === 0 || cell.rowSpan === 0) return;
      const span = cell.colSpan > 1 ? cell.colSpan : 1;
      const td = document.createElement("td");
      if (span > 1) td.colSpan = span;
      const rowSpan = cell.rowSpan > 1 ? cell.rowSpan : 1;
      if (rowSpan > 1) td.rowSpan = rowSpan;
      const override = spanOverride(cell.spanSpec);
      const alignment =
        override?.alignment ??
        object.columns[c]?.alignment ??
        object.alignments[c] ??
        "l";
      td.style.textAlign =
        alignment === "c"
          ? "center"
          : alignment === "r"
            ? "right"
            : alignment === "j"
              ? "justify"
              : "left";
      const borders = object.verticalBorders ?? [];
      td.style.borderLeft = tableVerticalBorder(
        override ? override.left : borders[c],
      );
      td.style.borderRight = tableVerticalBorder(
        override ? override.right : borders[c + span],
      );
      const overrideWidth = override?.width
        ? tableDimensionCss(override.width)
        : undefined;
      if (overrideWidth) td.style.width = overrideWidth;
      const kind = override?.kind ?? object.columns[c]?.kind;
      if (kind === "p") td.style.verticalAlign = "top";
      else if (kind === "m") td.style.verticalAlign = "middle";
      else if (kind === "b") td.style.verticalAlign = "bottom";
      td.style.borderTop = tableHorizontalBorder(object.rules?.[r], c, span);
      td.style.borderBottom = tableHorizontalBorder(
        object.rules?.[r + rowSpan],
        c,
        span,
      );
      const edit = document.createElement("button");
      edit.type = "button";
      edit.setAttribute(
        "aria-label",
        `Edit table row ${r + 1} column ${c + 1}: ${(cell.text ?? cell.raw).slice(0, 80)}`,
      );
      const content = document.createElement("span");
      renderTableCellContent(content, cell.raw);
      edit.appendChild(content);
      edit.addEventListener("click", () => open({ row: r, column: c }));
      td.appendChild(edit);
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  frame.appendChild(table);
  return frame;
}
class ObjectWidget extends WidgetType {
  readonly asset: string | null;
  constructor(
    readonly object: VisualObject,
    readonly options: Options,
  ) {
    super();
    this.asset =
      object.kind === "figure"
        ? safeFigureAsset(options.getAssets()[object.path])
        : object.kind === "subfigure"
          ? JSON.stringify(
              object.panels.map((panel) =>
                safeFigureAsset(options.getAssets()[panel.path]),
              ),
            )
          : null;
  }
  eq(other: ObjectWidget) {
    return (
      other.object.from === this.object.from &&
      other.object.to === this.object.to &&
      other.object.source === this.object.source &&
      other.object.kind === this.object.kind &&
      other.asset === this.asset
    );
  }
  get estimatedHeight() {
    return this.object.kind === "table"
      ? Math.min(320, 100 + this.object.cells.length * 30)
      : this.object.kind === "figure"
        ? 240
        : -1;
  }
  toDOM() {
    const object = this.object;
    const block =
      object.kind === "table" ||
      object.kind === "figure" ||
      object.kind === "subfigure" ||
      (object.kind === "math" && object.display);
    const root = document.createElement(block ? "div" : "span");
    root.className = `cm-visual-object cm-visual-object-${object.kind}`;
    root.setAttribute("data-visual-object", object.kind);
    root.contentEditable = "false";
    const open = (cell?: { row: number; column: number }) => {
      const view = this.options.getView();
      if (view) this.options.onOpen(object, view.state.doc.toString(), cell);
    };
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-visual-object-edit";
    if (object.kind === "table") {
      button.textContent = "Edit table";
      button.setAttribute("aria-label", "Edit table");
      root.appendChild(button);
      root.appendChild(buildVisualTablePreview(object, open));
      if (object.caption) {
        const caption = document.createElement("div");
        caption.className = "cm-visual-object-caption";
        caption.textContent = object.caption.text ?? object.caption.value;
        root.appendChild(caption);
      }
    } else if (object.kind === "subfigure") {
      const panels = document.createElement("div");
      panels.className = "flex flex-wrap items-start gap-3";
      object.panels.forEach((panel, index) => {
        const item = document.createElement("div");
        item.style.width = `${panel.envWidth * 100}%`;
        const asset = safeFigureAsset(this.options.getAssets()[panel.path]);
        if (asset) {
          const image = document.createElement("img");
          image.src = asset;
          image.alt = panel.caption?.text || panel.path;
          image.style.maxWidth = "100%";
          image.style.maxHeight = "180px";
          item.appendChild(image);
        } else {
          const path = document.createElement("span");
          path.textContent = panel.path;
          item.appendChild(path);
        }
        const caption = document.createElement("div");
        caption.className = "cm-visual-object-caption";
        caption.textContent = `(${String.fromCharCode(97 + index)}) ${panel.caption?.text ?? panel.caption?.value ?? ""}`;
        item.appendChild(caption);
        panels.appendChild(item);
      });
      root.appendChild(panels);
      if (object.caption) {
        const caption = document.createElement("div");
        caption.className = "cm-visual-object-caption";
        caption.textContent = object.caption.text ?? object.caption.value;
        root.appendChild(caption);
      }
      button.textContent = "Edit subfigures";
      button.setAttribute("aria-label", "Edit subfigures");
      root.appendChild(button);
    } else if (object.kind === "figure") {
      button.textContent = "Edit figure";
      button.setAttribute("aria-label", "Edit figure");
      root.appendChild(button);
      const asset = this.asset;
      if (asset) {
        const image = document.createElement("img");
        image.src = asset;
        image.alt = object.caption?.text || object.path;
        image.className = "cm-visual-figure-image";
        image.style.width = `${object.width * 100}%`;
        root.appendChild(image);
      } else {
        const text = document.createElement("div");
        text.textContent = object.path.endsWith(".pdf")
          ? `PDF figure: ${object.path} · view in Proof`
          : `Image unavailable: ${object.path}`;
        root.appendChild(text);
      }
      if (object.caption) {
        const caption = document.createElement("div");
        caption.className = "cm-visual-object-caption";
        caption.textContent = object.caption.text ?? object.caption.value;
        root.appendChild(caption);
      }
    } else if (object.kind === "math") {
      button.setAttribute("aria-label", "Edit equation");
      const math = document.createElement("span");
      if (!renderMathPreview(math, object.tex, object.display)) {
        math.textContent = object.source;
        math.className = "cm-visual-object-source";
      }
      button.appendChild(math);
      root.appendChild(button);
    } else {
      button.textContent =
        object.kind === "citation"
          ? `[${object.keys.join(", ")}]`
          : `↗ ${object.keys.join(", ")}`;
      button.setAttribute(
        "aria-label",
        `Edit ${object.kind} ${object.keys.join(", ")}`,
      );
      root.appendChild(button);
    }
    button.addEventListener("click", () => open());
    return root;
  }
  ignoreEvent() {
    return true;
  }
}
export function createVisualObjectExtension(options: Options): Extension {
  const objects = StateField.define<VisualObject[]>({
    create: (state) => parseVisualObjects(state.doc.toString()),
    update: (value, tr) =>
      tr.docChanged ? parseVisualObjects(tr.newDoc.toString()) : value,
  });
  const rendered = StateField.define<DecorationSet>({
    create: (state) =>
      Decoration.set(
        state.field(objects).map((object) =>
          Decoration.replace({
            widget: new ObjectWidget(object, options),
            block:
              object.kind === "table" ||
              object.kind === "figure" ||
              object.kind === "subfigure" ||
              (object.kind === "math" && object.display),
          }).range(object.from, object.to),
        ),
        true,
      ),
    update: (value, tr) =>
      tr.docChanged ||
      tr.effects.some((effect) => effect.is(refreshVisualObjectAssets))
        ? Decoration.set(
            tr.state.field(objects).map((object) =>
              Decoration.replace({
                widget: new ObjectWidget(object, options),
                block:
                  object.kind === "table" ||
                  object.kind === "figure" ||
                  object.kind === "subfigure" ||
                  (object.kind === "math" && object.display),
              }).range(object.from, object.to),
            ),
            true,
          )
        : value,
    provide: (field) => EditorView.decorations.from(field),
  });
  return [
    objects,
    rendered,
    EditorView.atomicRanges.of((view) => view.state.field(rendered)),
  ];
}
