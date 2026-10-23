import {
  isFigurePath,
  isFigurePlacement,
  requiredFigurePackages,
} from "./visualFigure";
import {
  maskVisualComments,
  decodeVisualProse,
  encodeVisualProse,
  isVisualTexKey,
  readTexGroup,
  type VisualSourcePatch,
  type TexGroup,
} from "./visualObjectTypes";

export const SUBFIGURE_MAX_PANELS = 4;
export const SUBFIGURE_MIN_ENV_WIDTH = 0.05;
export const SUBFIGURE_MAX_ENV_WIDTH = 1;
export const SUBFIGURE_MIN_GRAPHIC_WIDTH = 0.1;
export const SUBFIGURE_MAX_GRAPHIC_WIDTH = 1;

export function isSubfigurePosition(value: string | null): boolean {
  return value === null || value === "" || /^[btc]$/.test(value);
}
export function requiredSubfigurePackages(model: {
  placement: string | null;
}): string[] {
  return requiredFigurePackages({ ...model, panels: [] });
}

export type VisualSubfigurePanel = {
  path: string;
  envWidth: number;
  envWidthUnit: string;
  envPosition: string | null;
  graphicWidth: number | null;
  graphicWidthUnit: string;
  caption: (TexGroup & { text: string | null }) | null;
  label: TexGroup | null;
  pathFrom: number;
  pathTo: number;
  envWidthFrom: number;
  envWidthTo: number;
  envPositionFrom: number;
  envPositionTo: number;
  graphicWidthFrom: number;
  graphicWidthTo: number;
  graphicOptionFrom: number;
  graphicOptionTo: number;
  panelFrom: number;
  panelTo: number;
};

export type VisualSubfigure = {
  kind: "subfigure";
  from: number;
  to: number;
  source: string;
  placement: string | null;
  placementFrom: number;
  placementTo: number;
  starred: boolean;
  panels: VisualSubfigurePanel[];
  caption: (TexGroup & { text: string | null }) | null;
  label: TexGroup | null;
  eol: string;
};

export type SubfigurePanelDraft = {
  path: string;
  envWidth: number;
  envPosition: string | null;
  graphicWidth: number | null;
  caption: string;
  label: string;
};

export type SubfigureDraft = {
  placement?: string | null;
  panels: SubfigurePanelDraft[];
  caption: string;
  label: string;
};

function blank(s: string, from: number, to: number): string {
  return s.slice(0, from) + " ".repeat(to - from) + s.slice(to);
}

const FRACTION = "(0?\\.\\d+|1(?:\\.0+)?)";
const FIGURE_BEGIN = "\\\\begin\\{figure\\*?\\}";

function parseOuterPlacement(
  fragment: string,
  scan: string,
  from: number,
): {
  beginName: string;
  starred: boolean;
  placement: string | null;
  placementFrom: number;
  placementTo: number;
  beginEnd: number;
  contentStart: number;
} | null {
  const beginOnScan = /^\\begin\{(figure\*?)\}/.exec(scan.trimStart());
  if (!beginOnScan || !beginOnScan[1]) return null;
  if (!scan.trimEnd().endsWith(`\\end{${beginOnScan[1]}}`)) return null;
  const beginMatch = new RegExp(FIGURE_BEGIN).exec(fragment);
  if (!beginMatch || beginMatch.index === undefined) return null;
  const name = /^\\begin\{(figure\*?)\}/.exec(beginMatch[0])?.[1];
  if (name !== beginOnScan[1]) return null;
  if (scan.slice(0, beginMatch.index).trim() !== "") return null;
  const beginEnd = beginMatch.index + beginMatch[0].length;
  if (fragment[beginEnd] === "[") {
    const placementMatch = /^\[([htbp!H]+)\]/.exec(
      fragment.slice(beginEnd, beginEnd + 16),
    );
    if (!placementMatch || !placementMatch[1]) return null;
    if (
      scan.slice(beginEnd, beginEnd + placementMatch[0].length) !==
      placementMatch[0]
    )
      return null;
    const placement = placementMatch[1];
    const contentStart = beginEnd + placementMatch[0].length;
    return {
      beginName: beginOnScan[1],
      starred: beginOnScan[1] === "figure*",
      placement,
      placementFrom: from + beginEnd + 1,
      placementTo: from + beginEnd + 1 + placement.length,
      beginEnd,
      contentStart,
    };
  }
  if (fragment[beginEnd] === "[") return null;
  return {
    beginName: beginOnScan[1],
    starred: beginOnScan[1] === "figure*",
    placement: null,
    placementFrom: from + beginEnd,
    placementTo: from + beginEnd,
    beginEnd,
    contentStart: beginEnd,
  };
}

type ParsedPanel = VisualSubfigurePanel;

function parsePanel(
  fragment: string,
  scan: string,
  from: number,
  panelStart: number,
  panelEnd: number,
): ParsedPanel | null {
  const BEGIN_LEN = "\\begin{subfigure}".length;
  let cursor = panelStart + BEGIN_LEN;
  let envPosition: string | null = null;
  let envPositionFrom = from + cursor;
  let envPositionTo = from + cursor;
  if (fragment[cursor] === "[") {
    const posMatch = /^\[([btc])\]/.exec(fragment.slice(cursor, cursor + 5));
    if (!posMatch || !posMatch[1]) return null;
    if (scan.slice(cursor, cursor + posMatch[0].length) !== posMatch[0])
      return null;
    envPosition = posMatch[1];
    envPositionFrom = from + cursor + 1;
    envPositionTo = from + cursor + 1 + envPosition.length;
    cursor += posMatch[0].length;
  }
  if (fragment[cursor] !== "{") return null;
  const widthGroup = readTexGroup(fragment, cursor);
  if (!widthGroup) return null;
  let envWidth = 1;
  let envWidthFrom = from + widthGroup.contentFrom;
  let envWidthTo = from + widthGroup.contentFrom;
  const numbered = new RegExp(`^${FRACTION}\\\\(textwidth|linewidth)$`).exec(
    widthGroup.value,
  );
  const bare = /^\\(textwidth|linewidth)$/.exec(widthGroup.value);
  let envWidthUnit = "textwidth";
  if (numbered?.[1] && numbered[2]) {
    envWidth = Number(numbered[1]);
    envWidthUnit = numbered[2];
    envWidthFrom = from + widthGroup.contentFrom;
    envWidthTo = from + widthGroup.contentFrom + numbered[1].length;
  } else if (bare?.[1]) {
    envWidthUnit = bare[1];
  } else {
    return null;
  }
  if (
    !Number.isFinite(envWidth) ||
    envWidth < SUBFIGURE_MIN_ENV_WIDTH ||
    envWidth > SUBFIGURE_MAX_ENV_WIDTH
  )
    return null;
  const innerFrom = widthGroup.to;
  const innerTo = panelEnd - "\\end{subfigure}".length;
  if (innerTo <= innerFrom) return null;
  const innerFrag = fragment.slice(innerFrom, innerTo);
  let innerScan = scan.slice(innerFrom, innerTo);
  const include = new RegExp(
    `\\\\includegraphics(?:\\[width=(?:${FRACTION})?\\\\(linewidth|textwidth)\\])?\\{`,
  ).exec(innerScan);
  if (!include) return null;
  if (innerScan.indexOf("\\includegraphics", include.index + 1) >= 0)
    return null;
  const group = readTexGroup(innerFrag, include.index + include[0].length - 1);
  if (!group) return null;
  const detokenized = /^\\detokenize\{([^{}]*)\}$/.exec(group.value);
  const path = detokenized ? detokenized[1]! : group.value;
  if (!isFigurePath(path)) return null;
  let graphicWidth: number | null = null;
  let graphicWidthUnit = "linewidth";
  let graphicWidthFrom =
    from + innerFrom + include.index + "\\includegraphics".length;
  let graphicWidthTo = graphicWidthFrom;
  let graphicOptionFrom = graphicWidthFrom;
  let graphicOptionTo = graphicWidthFrom;
  const optionStart = include.index + "\\includegraphics".length;
  if (innerFrag[optionStart] === "[") {
    const optionMatch = new RegExp(
      `^\\[width=(?:(${FRACTION.slice(1, -1)}))?\\\\(linewidth|textwidth)\\]`,
    ).exec(innerFrag.slice(optionStart, optionStart + 48));
    if (!optionMatch) return null;
    if (
      innerScan.slice(optionStart, optionStart + optionMatch[0].length) !==
      optionMatch[0]
    )
      return null;
    graphicWidthUnit = optionMatch[2] ?? "linewidth";
    graphicOptionFrom = from + innerFrom + optionStart;
    graphicOptionTo = graphicOptionFrom + optionMatch[0].length;
    if (optionMatch[1]) {
      graphicWidth = Number(optionMatch[1]);
      graphicWidthFrom = from + innerFrom + optionStart + "[width=".length;
      graphicWidthTo = graphicWidthFrom + optionMatch[1].length;
    } else {
      graphicWidth = 1;
      graphicWidthFrom = from + innerFrom + optionStart + "[width=".length;
      graphicWidthTo = graphicWidthFrom;
    }
    if (
      graphicWidth === null ||
      !Number.isFinite(graphicWidth) ||
      graphicWidth < SUBFIGURE_MIN_GRAPHIC_WIDTH ||
      graphicWidth > SUBFIGURE_MAX_GRAPHIC_WIDTH
    )
      return null;
  }
  innerScan = blank(innerScan, include.index, group.to);
  let caption: ParsedPanel["caption"] = null;
  let label: TexGroup | null = null;
  for (const name of ["caption", "label"] as const) {
    const match = new RegExp(`\\\\${name}\\{`).exec(innerScan);
    if (!match) continue;
    const g = readTexGroup(fragment, innerFrom + match.index + name.length + 1);
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
    const span = g.to - (innerFrom + match.index);
    innerScan =
      innerScan.slice(0, match.index) +
      " ".repeat(span) +
      innerScan.slice(match.index + span);
  }
  if (innerScan.replace(/\\centering\b/g, "").trim() !== "") return null;
  return {
    path,
    envWidth,
    envWidthUnit,
    envPosition,
    graphicWidth,
    graphicWidthUnit,
    caption,
    label,
    pathFrom: from + innerFrom + group.contentFrom,
    pathTo: from + innerFrom + group.contentTo,
    envWidthFrom,
    envWidthTo,
    envPositionFrom,
    envPositionTo,
    graphicWidthFrom,
    graphicWidthTo,
    graphicOptionFrom,
    graphicOptionTo,
    panelFrom: from + panelStart,
    panelTo: from + panelEnd,
  };
}

export function parseVisualSubfigure(
  fragment: string,
  from = 0,
): VisualSubfigure | null {
  if (fragment.length > 131072) return null;
  const scan = maskVisualComments(fragment);
  const outer = parseOuterPlacement(fragment, scan, from);
  if (!outer) return null;
  const outerEndStart = scan.lastIndexOf(`\\end{${outer.beginName}}`);
  if (outerEndStart <= outer.beginEnd) return null;
  const panels: ParsedPanel[] = [];
  let search = outer.beginEnd;
  for (;;) {
    const next = scan.indexOf("\\begin{subfigure}", search);
    if (next < 0 || next >= outerEndStart) break;
    const afterBegin = scan.slice(next, next + "\\begin{subfigure}".length + 6);
    if (!/^\\begin\{subfigure\}(?:\[|\{)/.test(afterBegin)) return null;
    let depth = 1;
    let cursor = next + "\\begin{subfigure}".length;
    let panelEnd = -1;
    for (;;) {
      const nextBegin = scan.indexOf("\\begin{subfigure}", cursor);
      const nextEnd = scan.indexOf("\\end{subfigure}", cursor);
      if (nextEnd < 0) return null;
      if (nextBegin >= 0 && nextBegin < nextEnd) return null;
      depth -= 1;
      cursor = nextEnd + "\\end{subfigure}".length;
      if (depth === 0) {
        panelEnd = cursor;
        break;
      }
    }
    if (panelEnd <= next || panelEnd > outerEndStart) return null;
    const panel = parsePanel(fragment, scan, from, next, panelEnd);
    if (!panel) return null;
    panels.push(panel);
    search = panelEnd;
    if (panels.length > SUBFIGURE_MAX_PANELS) return null;
  }
  if (panels.length < 1 || panels.length > SUBFIGURE_MAX_PANELS) return null;
  let outerScan = scan.slice(outer.contentStart, outerEndStart);
  for (const panel of panels) {
    const relFrom = panel.panelFrom - from;
    const relTo = panel.panelTo - from;
    outerScan = blank(
      outerScan,
      relFrom - outer.contentStart,
      relTo - outer.contentStart,
    );
  }
  let caption: VisualSubfigure["caption"] = null;
  let label: TexGroup | null = null;
  for (const name of ["caption", "label"] as const) {
    const match = new RegExp(`\\\\${name}\\{`).exec(outerScan);
    if (!match) continue;
    const g = readTexGroup(
      fragment,
      outer.contentStart + match.index + name.length + 1,
    );
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
    const span = g.to - (outer.contentStart + match.index);
    outerScan =
      outerScan.slice(0, match.index) +
      " ".repeat(span) +
      outerScan.slice(match.index + span);
  }
  const remainder = outerScan
    .replace(/\\centering\b/g, "")
    .replace(/\\(?:hfill|hfil)\b/g, "")
    .replace(/\\\\/g, "");
  if (remainder.trim() !== "") return null;
  return {
    kind: "subfigure",
    from,
    to: from + fragment.length,
    source: fragment,
    placement: outer.placement,
    placementFrom: outer.placementFrom,
    placementTo: outer.placementTo,
    starred: outer.starred,
    panels: panels.map((panel) => ({ ...panel })),
    caption,
    label,
    eol: fragment.includes("\r\n") ? "\r\n" : "\n",
  };
}

export function createVisualSubfigure(paths: string[], eol = "\n"): string {
  if (paths.length < 1 || paths.length > SUBFIGURE_MAX_PANELS)
    throw new Error("Choose one to four project images.");
  for (const path of paths) {
    if (!isFigurePath(path))
      throw new Error("Choose supported project images.");
  }
  const width = paths.length === 1 ? "0.8" : (0.96 / paths.length).toFixed(2);
  const letters = ["a", "b", "c", "d"];
  const panels = paths
    .map(
      (path, i) =>
        `\\begin{subfigure}[b]{${width}\\textwidth}${eol}\\centering${eol}` +
        `\\includegraphics[width=\\linewidth]{\\detokenize{${path}}}${eol}` +
        `\\caption{}${eol}\\label{fig:new-${letters[i]}}${eol}\\end{subfigure}`,
    )
    .join(`${eol}\\hfill${eol}`);
  return (
    `\\begin{figure}[htbp]${eol}\\centering${eol}${panels}${eol}` +
    `\\caption{}${eol}\\label{fig:new}${eol}\\end{figure}`
  );
}

export function subfigurePanelDraft(
  panel: VisualSubfigurePanel,
): SubfigurePanelDraft {
  return {
    path: panel.path,
    envWidth: panel.envWidth,
    envPosition: panel.envPosition,
    graphicWidth: panel.graphicWidth,
    caption: panel.caption?.text ?? panel.caption?.value ?? "",
    label: panel.label?.value ?? "",
  };
}

export function subfigureDraft(model: VisualSubfigure): SubfigureDraft {
  return {
    placement: model.placement,
    panels: model.panels.map(subfigurePanelDraft),
    caption: model.caption?.text ?? model.caption?.value ?? "",
    label: model.label?.value ?? "",
  };
}

export function patchesForVisualSubfigure(
  model: VisualSubfigure,
  draft: SubfigureDraft,
): VisualSourcePatch[] {
  let placement = model.placement;
  if (draft.placement !== undefined)
    placement = draft.placement === "" ? null : draft.placement;
  if (
    !isFigurePlacement(placement) ||
    draft.panels.length !== model.panels.length ||
    draft.caption.length > 10000 ||
    (draft.label !== model.label?.value &&
      draft.label &&
      !isVisualTexKey(draft.label))
  )
    throw new Error(
      "Choose panel widths from 5–100%, graphic widths from 10–100%, and simple labels.",
    );
  for (let i = 0; i < draft.panels.length; i++) {
    const panel = draft.panels[i]!;
    if (
      !isFigurePath(panel.path) ||
      !Number.isFinite(panel.envWidth) ||
      panel.envWidth < SUBFIGURE_MIN_ENV_WIDTH ||
      panel.envWidth > SUBFIGURE_MAX_ENV_WIDTH ||
      !isSubfigurePosition(panel.envPosition) ||
      (panel.graphicWidth !== null &&
        (!Number.isFinite(panel.graphicWidth) ||
          panel.graphicWidth < SUBFIGURE_MIN_GRAPHIC_WIDTH ||
          panel.graphicWidth > SUBFIGURE_MAX_GRAPHIC_WIDTH)) ||
      panel.caption.length > 10000 ||
      (panel.label !== model.panels[i]!.label?.value &&
        panel.label &&
        !isVisualTexKey(panel.label))
    )
      throw new Error(
        "Choose panel widths from 5–100%, graphic widths from 10–100%, and simple labels.",
      );
  }
  const patches: VisualSourcePatch[] = [];
  if (placement !== model.placement) {
    if (model.placement === null && placement !== null) {
      patches.push({
        from: model.placementFrom,
        to: model.placementTo,
        insert: `[${placement}]`,
      });
    } else if (model.placement !== null && placement === null) {
      patches.push({
        from: model.placementFrom - 1,
        to: model.placementTo + 1,
        insert: "",
      });
    } else if (model.placement !== null && placement !== null) {
      patches.push({
        from: model.placementFrom,
        to: model.placementTo,
        insert: placement,
      });
    }
  }
  draft.panels.forEach((panelDraft, i) => {
    const panel = model.panels[i]!;
    const position =
      panelDraft.envPosition === "" ? null : panelDraft.envPosition;
    if (!isSubfigurePosition(position))
      throw new Error("Choose a panel position of b, c or t.");
    if (panelDraft.path !== panel.path) {
      patches.push({
        from: panel.pathFrom,
        to: panel.pathTo,
        insert: `\\detokenize{${panelDraft.path}}`,
      });
    }
    if (panelDraft.envWidth !== panel.envWidth) {
      patches.push({
        from: panel.envWidthFrom,
        to: panel.envWidthTo,
        insert: String(panelDraft.envWidth),
      });
    }
    if (position !== panel.envPosition) {
      if (panel.envPosition === null && position !== null) {
        patches.push({
          from: panel.envPositionFrom,
          to: panel.envPositionTo,
          insert: `[${position}]`,
        });
      } else if (panel.envPosition !== null && position === null) {
        patches.push({
          from: panel.envPositionFrom - 1,
          to: panel.envPositionTo + 1,
          insert: "",
        });
      } else if (panel.envPosition !== null && position !== null) {
        patches.push({
          from: panel.envPositionFrom,
          to: panel.envPositionTo,
          insert: position,
        });
      }
    }
    if (panelDraft.graphicWidth !== panel.graphicWidth) {
      if (panel.graphicWidth === null && panelDraft.graphicWidth !== null) {
        patches.push({
          from: panel.graphicOptionFrom,
          to: panel.graphicOptionTo,
          insert: `[width=${panelDraft.graphicWidth}\\${panel.graphicWidthUnit}]`,
        });
      } else if (
        panel.graphicWidth !== null &&
        panelDraft.graphicWidth === null
      ) {
        patches.push({
          from: panel.graphicOptionFrom,
          to: panel.graphicOptionTo,
          insert: "",
        });
      } else if (
        panel.graphicWidth !== null &&
        panelDraft.graphicWidth !== null
      ) {
        patches.push({
          from: panel.graphicWidthFrom,
          to: panel.graphicWidthTo,
          insert: String(panelDraft.graphicWidth),
        });
      }
    }
    const panelCaption = panel.caption;
    if (
      panelCaption &&
      panelDraft.caption !== (panelCaption.text ?? panelCaption.value)
    ) {
      if (panelCaption.text === null)
        throw new Error("Edit custom caption markup in Source.");
      patches.push({
        from: panelCaption.contentFrom,
        to: panelCaption.contentTo,
        insert: encodeVisualProse(panelDraft.caption),
      });
    }
    if (panel.label && panelDraft.label !== panel.label.value) {
      patches.push({
        from: panel.label.contentFrom,
        to: panel.label.contentTo,
        insert: panelDraft.label,
      });
    }
    let suffix = "";
    if (!panelCaption && panelDraft.caption)
      suffix += `\\caption{${encodeVisualProse(panelDraft.caption)}}${model.eol}`;
    if (!panel.label && panelDraft.label)
      suffix += `\\label{${panelDraft.label}}${model.eol}`;
    if (suffix) {
      const panelSource = model.source.slice(
        panel.panelFrom - model.from,
        panel.panelTo - model.from,
      );
      const end =
        maskVisualComments(panelSource).lastIndexOf("\\end{subfigure}");
      patches.push({
        from: panel.panelFrom + end,
        to: panel.panelFrom + end,
        insert: suffix,
      });
    }
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
  if (model.label && draft.label !== model.label.value) {
    patches.push({
      from: model.label.contentFrom,
      to: model.label.contentTo,
      insert: draft.label,
    });
  }
  let suffix = "";
  if (!model.caption && draft.caption)
    suffix += `\\caption{${encodeVisualProse(draft.caption)}}${model.eol}`;
  if (!model.label && draft.label)
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
