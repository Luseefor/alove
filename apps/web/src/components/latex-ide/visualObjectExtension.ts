import { StateField, StateEffect, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { parseVisualObjects, type VisualObject } from "@/lib/visualObjects";
import { safeFigureAsset } from "@/lib/visualFigure";
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
      const frame = document.createElement("div");
      frame.className = "cm-visual-table-scroll";
      const table = document.createElement("table");
      table.setAttribute("aria-label", "Visual table preview");
      object.cells.forEach((row, r) => {
        const tr = document.createElement("tr");
        row.forEach((cell, c) => {
          const td = document.createElement("td");
          td.style.textAlign =
            ({ l: "left", c: "center", r: "right" } as const)[
              object.alignments[c] as "l" | "c" | "r"
            ] ?? "left";
          const edit = document.createElement("button");
          edit.type = "button";
          edit.textContent = cell.text ?? cell.raw;
          edit.setAttribute(
            "aria-label",
            `Edit table row ${r + 1} column ${c + 1}: ${(cell.text ?? cell.raw).slice(0, 80)}`,
          );
          edit.addEventListener("click", () => open({ row: r, column: c }));
          td.appendChild(edit);
          tr.appendChild(td);
        });
        table.appendChild(tr);
      });
      frame.appendChild(table);
      root.appendChild(frame);
      if (object.caption) {
        const caption = document.createElement("div");
        caption.className = "cm-visual-object-caption";
        caption.textContent = object.caption.text ?? object.caption.value;
        root.appendChild(caption);
      }
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
