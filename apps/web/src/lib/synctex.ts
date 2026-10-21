import type { SyncTexEntry, SyncTexMapping, SyncTexPreamble } from "@alove/protocol";
import { COMPILE_SYNCTEX_LIMITS } from "@alove/protocol";

/** Scaled points per PDF big point (1 TeX pt = 65536 sp, 1 bp = 72.27/72 pt). */
export const SP_PER_BP = 65781.76;

export const DEFAULT_SYNCTEX_PREAMBLE: SyncTexPreamble = {
  magnification: 1000,
  unit: 1,
  xOffset: 0,
  yOffset: 0,
};

/** Fallback highlight height in big points when no record carries extents. */
export const SYNCTEX_FALLBACK_HEIGHT_BP = 10;

function preambleOf(mapping: SyncTexMapping | null | undefined): SyncTexPreamble {
  const p = mapping?.preamble;
  const magnification =
    p && Number.isFinite(p.magnification) && p.magnification > 0
      ? p.magnification
      : DEFAULT_SYNCTEX_PREAMBLE.magnification;
  const unit =
    p && Number.isFinite(p.unit) && p.unit > 0
      ? p.unit
      : DEFAULT_SYNCTEX_PREAMBLE.unit;
  const xOffset = p && Number.isFinite(p.xOffset) ? p.xOffset : 0;
  const yOffset = p && Number.isFinite(p.yOffset) ? p.yOffset : 0;
  return { magnification, unit, xOffset, yOffset };
}

/**
 * Raw scaled points per PDF big point for this mapping.
 * Verified against the `synctex view` CLI on pdflatex/xelatex/lualatex
 * fixtures (including nonzero xelatex offsets and nested includes):
 * bp = (sp + offset) * unit * 1000 / (65781.76 * magnification).
 */
export function syncTexScale(mapping: SyncTexMapping | null | undefined): number {
  const { magnification, unit } = preambleOf(mapping);
  return ((unit * 1000) / (SP_PER_BP * magnification));
}

export type PdfRectBp = {
  page: number;
  /** Big points from the left edge (SyncTeX/CLI orientation: top-left origin). */
  xBp: number;
  /** Big points from the TOP edge; the viewer flips with the page height. */
  yTopBp: number;
  wBp: number;
  hBp: number;
};

/** Convert one raw entry to PDF big points (top-left origin, like the CLI). */
export function syncTexEntryToBp(
  mapping: SyncTexMapping | null | undefined,
  entry: SyncTexEntry,
): PdfRectBp {
  const { xOffset, yOffset } = preambleOf(mapping);
  const k = syncTexScale(mapping);
  return {
    page: entry.page,
    xBp: (entry.x + xOffset) * k,
    yTopBp: (entry.y + yOffset) * k,
    wBp: (entry.width ?? 0) * k,
    hBp: (entry.height ?? 0) * k,
  };
}

/**
 * Convert a pdf.js PDF point (bottom-left origin) to SyncTeX top-based big
 * points using the rendered page height. `synctex edit` documents the same
 * orientation: "x and y are counted from the top left corner of the page.
 * Their unit is the big point (72 dpi)."
 */
export function pdfPointToSyncTop(
  pageHeightBp: number,
  xPdf: number,
  yPdf: number,
): { xBp: number; yTopBp: number } | null {
  if (
    !Number.isFinite(pageHeightBp) ||
    !Number.isFinite(xPdf) ||
    !Number.isFinite(yPdf)
  )
    return null;
  return { xBp: xPdf, yTopBp: pageHeightBp - yPdf };
}

export type PdfTarget = {
  page: number;
  /** Matched source line (exact hit, else nearest). */
  line: number;
  rect: PdfRectBp;
};
export type SourceTarget = { file: string; line: number };

function nearestLineEntry(
  entries: SyncTexEntry[],
  line: number,
): SyncTexEntry | null {
  let best: SyncTexEntry | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    const distance = Math.abs(entry.line - line);
    if (
      distance < bestDistance ||
      (distance === bestDistance && best !== null && entry.page < best.page)
    ) {
      bestDistance = distance;
      best = entry;
    }
  }
  return best;
}

/**
 * Source -> PDF: resolve a cursor (file, 1-based line) to a coordinate
 * highlight rectangle. Prefers an exact line hit, else the nearest line in
 * the same file. The rectangle unions every anchor sharing the matched
 * (file, line, page) so a text line highlights end to end; when no record
 * carries extents a 10 bp caret-height fallback applies.
 */
export function forwardHighlight(
  mapping: SyncTexMapping | null | undefined,
  file: string,
  line: number,
): PdfTarget | null {
  if (!mapping || !file || !Number.isSafeInteger(line) || line <= 0)
    return null;
  const own = mapping.entries.filter((e) => e.file === file);
  if (own.length === 0) return null;
  const exact = own.filter((e) => e.line === line);
  const anchor = (exact.length > 0 ? nearestLineEntry(exact, line) : nearestLineEntry(own, line))!;
  if (!anchor) return null;
  const k = syncTexScale(mapping);
  const { xOffset, yOffset } = preambleOf(mapping);
  let x0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const e of own) {
    if (e.line !== anchor.line || e.page !== anchor.page) continue;
    const x = (e.x + xOffset) * k;
    const y = (e.y + yOffset) * k;
    const w = (e.width ?? 0) * k;
    const h = (e.height ?? 0) * k;
    if (x < x0) x0 = x;
    if (x + w > x1) x1 = x + w;
    if (y < y0) y0 = y;
    if (y + h > y1) y1 = y + h;
  }
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) return null;
  if (!(y1 > y0)) y1 = y0 + SYNCTEX_FALLBACK_HEIGHT_BP;
  if (!(x1 > x0)) x1 = x0;
  return {
    page: anchor.page,
    line: anchor.line,
    rect: { page: anchor.page, xBp: x0, yTopBp: y0, wBp: x1 - x0, hBp: y1 - y0 },
  };
}

/**
 * Source -> PDF anchor (point form). Backwards-compatible selection core of
 * forwardHighlight: exact line preferred, else nearest.
 */
export function findPdfForSource(
  mapping: SyncTexMapping | null | undefined,
  file: string,
  line: number,
): PdfTarget | null {
  return forwardHighlight(mapping, file, line);
}

/**
 * PDF -> source: resolve a PDF page plus an optional anchor in top-based
 * big points (see pdfPointToSyncTop) to a source file/line. With
 * coordinates, picks the nearest anchor on the page — the same rule as
 * `synctex edit`; without, returns the top-of-page entry (smallest line,
 * then first in stream order) as the keyboard/page fallback.
 */
export function findSourceForPdf(
  mapping: SyncTexMapping | null | undefined,
  page: number,
  xBp?: number,
  yTopBp?: number,
): SourceTarget | null {
  if (!mapping || !Number.isSafeInteger(page) || page <= 0) return null;
  const onPage = mapping.entries.filter((e) => e.page === page);
  if (onPage.length === 0) return null;
  const hasCoords =
    typeof xBp === "number" &&
    typeof yTopBp === "number" &&
    Number.isFinite(xBp) &&
    Number.isFinite(yTopBp);
  if (!hasCoords) {
    let best = onPage[0]!;
    for (const entry of onPage) {
      if (entry.line < best.line) best = entry;
    }
    return { file: best.file, line: best.line };
  }
  const k = syncTexScale(mapping);
  const { xOffset, yOffset } = preambleOf(mapping);
  let best = onPage[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const entry of onPage) {
    const dx = (entry.x + xOffset) * k - (xBp as number);
    const dy = (entry.y + yOffset) * k - (yTopBp as number);
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entry;
    }
  }
  return { file: best.file, line: best.line };
}

/** Stale-source guard: navigation is only valid at the compiled revision. */
export function isSynctexStale(
  documentRevision: number,
  synctexRevision: number | null,
): boolean {
  if (synctexRevision === null || synctexRevision === undefined) return true;
  return documentRevision !== synctexRevision;
}

/** Transport guard: worker-capped mappings stay small for polling JSON. */
export function isSyncTexMappingBounded(
  mapping: SyncTexMapping | null | undefined,
): boolean {
  if (!mapping) return true;
  return (
    mapping.entries.length <= COMPILE_SYNCTEX_LIMITS.maxEntries &&
    mapping.version === 1
  );
}
