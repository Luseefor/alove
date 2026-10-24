import { parseVisualDocument } from "@alove/editor";
import type { VisualSourcePatch } from "./visualObjectTypes";

/** The mounted source editor owns the file's undo history, even in PDF mode. */
export type PdfEditBridge = {
  fileId: string | null;
  getValue: () => string | undefined;
  applySourcePatches: (
    expected: string,
    patches: VisualSourcePatch[],
  ) => boolean;
  openObjectAt: (expected: string, offset: number) => boolean;
};

/** Only a real, empty document body can start a PDF without an existing build. */
export function isBlankPdfSource(source: string | undefined): boolean {
  if (source === undefined) return false;
  const model = parseVisualDocument(source);
  return (
    !model.limited &&
    model.body.from > 0 &&
    model.body.to < source.length &&
    !source.slice(model.body.from, model.body.to).trim()
  );
}
