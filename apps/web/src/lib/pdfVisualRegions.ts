import type { SyncTexMapping } from "@alove/protocol";
import type { PdfPageLayout } from "@/components/latex-ide/PdfCanvasViewer";
import type { PdfTextBlock } from "./pdfVisualEditing";
import { syncTexEntryToBp } from "./synctex";

export type PdfTextRegion = {
  block: PdfTextBlock;
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
};
const normalized = (text: string) =>
  text
    .normalize("NFKC")
    .replace(/``|''|[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/—/g, "---")
    .replace(/–/g, "--")
    .replace(/\s+/g, "");

/** Require both the actual PDF text and nearby source coordinates, never nearest-line alone. */
export function buildPdfTextRegions(
  blocks: PdfTextBlock[],
  layout: PdfPageLayout,
  mapping: SyncTexMapping,
): PdfTextRegion[] {
  const runs = layout.textRuns.slice(0, 5000);
  const sx = layout.width / layout.pageWidthBp,
    sy = layout.height / layout.pageHeightBp;
  const candidates = new Map<
    string,
    Array<PdfTextRegion & { distance: number }>
  >();
  const entries = mapping.entries.filter((entry) => entry.page === layout.page);
  for (const block of blocks.slice(0, 1024)) {
    const target = normalized(block.text);
    if (!target || target.length > 20000) continue;
    // TeX may attach a paragraph's last box to its terminating blank/end line.
    const own = entries.filter(
      (entry) =>
        entry.file === block.file &&
        entry.line >= block.startLine &&
        entry.line <= block.endLine + 1,
    );
    if (!own.length) continue;
    for (let start = 0; start < runs.length; start++) {
      let text = "";
      for (let end = start; end < Math.min(runs.length, start + 128); end++) {
        text += normalized(runs[end].text);
        // A line-end discretionary hyphen is not part of the source word.
        if (
          !target.startsWith(text) &&
          text.endsWith("-") &&
          runs[end + 1]?.top > runs[end].top + runs[end].height / 2 &&
          target.startsWith(text.slice(0, -1))
        )
          text = text.slice(0, -1);
        if (!target.startsWith(text)) break;
        if (text !== target) continue;
        const group = runs.slice(start, end + 1);
        const left = Math.min(...group.map((r) => r.left));
        const top = Math.min(...group.map((r) => r.top));
        const right = Math.max(...group.map((r) => r.left + r.width));
        const bottom = Math.max(...group.map((r) => r.top + r.height));
        const fontSize = Math.max(8, Math.min(...group.map((r) => r.height)));
        let distance = Infinity;
        for (const entry of own) {
          const rect = syncTexEntryToBp(mapping, entry);
          const x = rect.xBp * sx,
            y = rect.yTopBp * sy;
          const dx = Math.max(left - x, 0, x - right);
          const dy = Math.max(top - y, 0, y - bottom);
          distance = Math.min(distance, Math.hypot(dx, dy));
        }
        if (distance <= fontSize * 1.5) {
          const key = `${start}:${end}`;
          const list = candidates.get(key) ?? [];
          list.push({
            block,
            left,
            top,
            width: right - left,
            height: bottom - top,
            fontSize,
            distance,
          });
          candidates.set(key, list);
        }
        break;
      }
    }
  }
  const regions: PdfTextRegion[] = [];
  for (const list of candidates.values()) {
    list.sort((a, b) => a.distance - b.distance);
    if (list.length > 1 && Math.abs(list[0].distance - list[1].distance) < 2)
      continue;
    // Repeated identical text on a single page is only editable if its source anchor distinguishes it.
    regions.push(list[0]);
  }
  const perBlock = new Map<string, PdfTextRegion[]>();
  for (const region of regions) {
    const list = perBlock.get(region.block.id) ?? [];
    list.push(region);
    perBlock.set(region.block.id, list);
  }
  return regions.filter(
    (region) => (perBlock.get(region.block.id)?.length ?? 0) === 1,
  );
}
