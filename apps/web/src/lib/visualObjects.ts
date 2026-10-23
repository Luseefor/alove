import { parseVisualDocument } from "@alove/editor";
import { parseVisualTable, type VisualTable } from "./visualTable";
import { parseVisualSubfigure, type VisualSubfigure } from "./visualSubfigure";
import { parseVisualFigure, type VisualFigure } from "./visualFigure";
import {
  parseVisualMath,
  parseVisualCitation,
  type VisualMath,
  type VisualCitation,
} from "./visualInline";
import type { VisualSourcePatch } from "./visualObjectTypes";
export type VisualObject =
  | VisualTable
  | VisualFigure
  | VisualSubfigure
  | VisualMath
  | VisualCitation;
export function parseVisualObjects(source: string): VisualObject[] {
  const model = parseVisualDocument(source);
  if (model.limited || model.body.from === model.body.to) return [];
  const ranges = model.protected.filter(
    (r) => r.from >= model.body.from && r.to <= model.body.to,
  );
  const objects: VisualObject[] = [];
  let consumed = -1;
  for (let i = 0; i < ranges.length && objects.length < 200; i++) {
    const range = ranges[i]!;
    if (range.from < consumed) continue;
    const prefix = source.slice(range.from, range.from + 30);
    if (
      !/^(?:\\(?:begin\{(?:table\*?|tabularx|tabular|longtable|figure\*?|equation\*?)\}|includegraphics\b|cite\b|citep\b|citet\b|citeauthor\b|citeyear\b|autocite\b|parencite\b|textcite\b|ref\b|eqref\b|autoref\b|cref\b|Cref\b|[([])|\$)/.test(
        prefix,
      )
    )
      continue;
    let end = range.to;
    for (let j = i; j < Math.min(ranges.length, i + 8); j++) {
      if (j > i) {
        const next = ranges[j]!;
        if (next.from - end > 256 || source.slice(end, next.from).trim()) break;
        end = next.to;
      }
      if (end - range.from > 131072) break;
      const fragment = source.slice(range.from, end);
      const object =
        parseVisualTable(fragment, range.from) ??
        parseVisualSubfigure(fragment, range.from) ??
        parseVisualFigure(fragment, range.from) ??
        parseVisualMath(
          fragment,
          range.from,
          source.includes("\r\n") ? "\r\n" : "\n",
        ) ??
        parseVisualCitation(fragment, range.from);
      if (object) {
        objects.push(object);
        consumed = object.to;
        break;
      }
    }
  }
  return objects;
}
export function applyVisualSourcePatches(
  source: string,
  patches: VisualSourcePatch[],
  bounds = { from: 0, to: source.length },
): string {
  if (patches.length > 500) throw new Error("Too many changes in one object.");
  let previous = bounds.from,
    inserted = 0;
  const sorted = [...patches].sort((a, b) => a.from - b.from || a.to - b.to);
  for (const patch of sorted) {
    if (
      !Number.isInteger(patch.from) ||
      !Number.isInteger(patch.to) ||
      patch.from < previous ||
      patch.to < patch.from ||
      patch.from < bounds.from ||
      patch.to > bounds.to ||
      bounds.to > source.length ||
      typeof patch.insert !== "string"
    )
      throw new Error(
        "The source range is no longer valid. Reopen this editor.",
      );
    previous = patch.to;
    inserted += patch.insert.length;
  }
  if (inserted > 262144) throw new Error("The object edit is too large.");
  let result = source;
  for (const patch of sorted.reverse())
    result =
      result.slice(0, patch.from) + patch.insert + result.slice(patch.to);
  if (result.length > 1048576)
    throw new Error("This file is too large for visual editing.");
  return result;
}
