import { parseVisualDocument } from "@alove/editor";

/** Reveal source syntax rather than leave a caret inside a hidden projection. */
export function sourceNavigationNeedsSource(
  source: string,
  start: number,
  end = start,
): boolean {
  const model = parseVisualDocument(source);
  if (model.limited || model.body.from === model.body.to) return true;
  if (start < model.body.from || end > model.body.to) return true;
  return model.protected.some((range) =>
    start === end
      ? start >= range.from && start < range.to
      : start < range.to && end > range.from,
  );
}
