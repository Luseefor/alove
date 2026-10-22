import { normalizeCompilePath } from "@alove/protocol";
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
export type VisualFigure = VisualObjectBase & {
  kind: "figure";
  path: string;
  width: number;
  caption: (TexGroup & { text: string | null }) | null;
  label: TexGroup | null;
  pathFrom: number;
  pathTo: number;
  widthFrom: number;
  widthTo: number;
  widthUnit: string;
  wrapper: boolean;
  eol: string;
};
export type FigureDraft = {
  path: string;
  width: number;
  caption: string;
  label: string;
};
export function isFigurePath(path: string): boolean {
  return (
    normalizeCompilePath(path) === path &&
    !/[{}%#\\\r\n]/.test(path) &&
    /\.(png|jpe?g|pdf)$/i.test(path) &&
    path.length < 300
  );
}
export function safeFigureAsset(value: string | undefined): string | null {
  return value &&
    /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/]+=*$/.test(value) &&
    value.length <= 1100000
    ? value
    : null;
}
export function parseVisualFigure(
  fragment: string,
  from = 0,
): VisualFigure | null {
  if (fragment.length > 131072) return null;
  const scan = maskVisualComments(fragment);
  const include =
    /\\includegraphics(?:\[width=(0?\.\d+|1(?:\.0+)?)\\(textwidth|linewidth)\])?\{/.exec(
      scan,
    );
  if (!include || scan.indexOf("\\includegraphics", include.index + 1) >= 0)
    return null;
  const group = readTexGroup(fragment, include.index + include[0].length - 1);
  if (!group) return null;
  const detokenized = /^\\detokenize\{([^{}]*)\}$/.exec(group.value);
  const path = detokenized ? detokenized[1]! : group.value;
  if (!isFigurePath(path)) return null;
  const width = include[1] ? Number(include[1]) : 0.8;
  if (!Number.isFinite(width) || width < 0.1 || width > 1) return null;
  let outer =
    scan.slice(0, include.index) +
    " ".repeat(group.to - include.index) +
    scan.slice(group.to);
  const wrapper = /^\s*\\begin\{figure\*?\}(?:\[[htbp!H]+\])?/.test(outer);
  if (wrapper) {
    const begin = /^\\begin\{(figure\*?)\}/.exec(scan.trimStart());
    if (!begin || !scan.trimEnd().endsWith(`\\end{${begin[1]}}`)) return null;
  }
  if (wrapper)
    outer = outer
      .replace(/^\s*\\begin\{figure\*?\}(?:\[[htbp!H]+\])?/, (m) =>
        " ".repeat(m.length),
      )
      .replace(/\\end\{figure\*?\}\s*$/, (m) => " ".repeat(m.length));
  let caption: VisualFigure["caption"] = null,
    label: TexGroup | null = null;
  for (const name of ["caption", "label"] as const) {
    const match = new RegExp(`\\\\${name}\\{`).exec(outer);
    if (!match) continue;
    if (!wrapper) return null;
    const g = readTexGroup(fragment, match.index + name.length + 1);
    if (!g) return null;
    const absolute = {
      ...g,
      from: from + g.from,
      to: from + g.to,
      contentFrom: from + g.contentFrom,
      contentTo: from + g.contentTo,
    };
    if (name === "caption")
      caption = { ...absolute, text: decodeVisualProse(g.value) };
    else label = absolute;
    outer =
      outer.slice(0, match.index) +
      " ".repeat(g.to - match.index) +
      outer.slice(g.to);
  }
  if (
    outer
      .replace(/\\centering\b/g, "")
      .replace(/%[^\r\n]*/g, "")
      .trim()
  )
    return null;
  const widthStart = include[1]
    ? include.index + "\\includegraphics[width=".length
    : include.index + "\\includegraphics".length;
  return {
    kind: "figure",
    from,
    to: from + fragment.length,
    source: fragment,
    path,
    width,
    caption,
    label,
    pathFrom: from + group.contentFrom,
    pathTo: from + group.contentTo,
    widthFrom: from + widthStart,
    widthTo: from + widthStart + (include[1]?.length ?? 0),
    widthUnit: include[2] ?? "textwidth",
    wrapper,
    eol: fragment.includes("\r\n") ? "\r\n" : "\n",
  };
}
export function createVisualFigure(path: string, eol = "\n"): string {
  if (!isFigurePath(path)) throw new Error("Choose a supported project image.");
  return `\\begin{figure}[htbp]${eol}\\centering${eol}\\includegraphics[width=0.8\\textwidth]{\\detokenize{${path}}}${eol}\\caption{}${eol}\\label{fig:new}${eol}\\end{figure}`;
}
export function figureDraft(model: VisualFigure): FigureDraft {
  return {
    path: model.path,
    width: model.width,
    caption: model.caption?.text ?? model.caption?.value ?? "",
    label: model.label?.value ?? "",
  };
}
export function patchesForVisualFigure(
  model: VisualFigure,
  draft: FigureDraft,
): VisualSourcePatch[] {
  if (
    !isFigurePath(draft.path) ||
    !Number.isFinite(draft.width) ||
    draft.width < 0.1 ||
    draft.width > 1 ||
    draft.caption.length > 10000 ||
    (draft.label !== model.label?.value &&
      draft.label &&
      !isVisualTexKey(draft.label))
  )
    throw new Error(
      "Choose a project image, a width from 10–100%, and a simple label.",
    );
  const patches: VisualSourcePatch[] = [];
  if (draft.path !== model.path)
    patches.push({
      from: model.pathFrom,
      to: model.pathTo,
      insert: `\\detokenize{${draft.path}}`,
    });
  if (draft.width !== model.width)
    patches.push({
      from: model.widthFrom,
      to: model.widthTo,
      insert:
        model.widthFrom === model.widthTo
          ? `[width=${draft.width}\\textwidth]`
          : String(draft.width),
    });
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
    const end = maskVisualComments(model.source).lastIndexOf("\\end{figure");
    patches.push({
      from: model.from + end,
      to: model.from + end,
      insert: suffix,
    });
  }
  return patches.sort((a, b) => a.from - b.from);
}
