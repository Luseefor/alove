import { escapeVisualText, parseVisualDocument } from "@alove/editor";

export type PdfTextBlockKind = "paragraph" | "heading" | "item";

export type PdfTextBlock = {
  id: string;
  file: string;
  from: number;
  to: number;
  text: string;
  startLine: number;
  endLine: number;
  kind: PdfTextBlockKind;
  source: string;
};

const MAX_PDF_TEXT_BLOCKS = 1024;
const MAX_PDF_TOTAL_SOURCE = 1024 * 1024;

function findLineEnd(src: string, pos: number): number {
  for (let i = pos; i < src.length; i++) {
    const c = src[i];
    if (c === "\n" || c === "\r") return i;
  }
  return src.length;
}

function lineStartOf(src: string, pos: number): number {
  const nl = src.lastIndexOf("\n", pos - 1);
  const cr = src.lastIndexOf("\r", pos - 1);
  return Math.max(nl, cr) + 1;
}

function eolLenAt(src: string, pos: number): number {
  if (pos >= src.length) return 0;
  if (src[pos] === "\r" && src[pos + 1] === "\n") return 2;
  if (src[pos] === "\r" || src[pos] === "\n") return 1;
  return 0;
}

function lineNumberAt(src: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, src.length));
  const head = src.slice(0, clamped);
  const breaks = head.match(/\r\n|\n|\r/g);
  return (breaks ? breaks.length : 0) + 1;
}

function overlaps(
  aFrom: number,
  aTo: number,
  bFrom: number,
  bTo: number,
): boolean {
  return aFrom < bTo && bFrom < aTo;
}

type VisualLike = ReturnType<typeof parseVisualDocument>;

function isCleanRange(doc: VisualLike, from: number, to: number): boolean {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return false;
  if (from >= to) return false;
  for (const p of doc.protected) {
    if (!overlaps(from, to, p.from, p.to)) continue;
    let covered = false;
    for (const l of doc.literals) {
      if (l.from <= p.from && l.to >= p.to && l.from >= from && l.to <= to) {
        covered = true;
        break;
      }
    }
    if (!covered) return false;
  }
  return true;
}

function decodeRange(
  src: string,
  from: number,
  to: number,
  literals: VisualLike["literals"],
): string {
  const inside = literals
    .filter((l) => l.from >= from && l.to <= to)
    .sort((a, b) => a.from - b.from);
  let out = "";
  let pos = from;
  for (const l of inside) {
    if (l.from < pos) continue;
    out += src.slice(pos, l.from);
    out += l.text;
    pos = l.to;
  }
  out += src.slice(pos, to);
  return out.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function sectionLevel(name: string): 1 | 2 | 3 | null {
  if (name === "section") return 1;
  if (name === "subsection") return 2;
  if (name === "subsubsection") return 3;
  return null;
}

function hasBlankLine(slice: string): boolean {
  const normalized = slice.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return /\n[ \t]*\n/.test(normalized);
}

function mergeRanges(ranges: Array<{ from: number; to: number }>): Array<{
  from: number;
  to: number;
}> {
  const sorted = [...ranges]
    .filter((r) => r.to > r.from)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const out: Array<{ from: number; to: number }> = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.from <= last.to) {
      if (r.to > last.to) last.to = r.to;
    } else {
      out.push({ from: r.from, to: r.to });
    }
  }
  return out;
}

function splitRangeByRanges(
  from: number,
  to: number,
  exclusions: Array<{ from: number; to: number }>,
): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  let pos = from;
  for (const e of exclusions) {
    if (e.to <= pos || e.from >= to) continue;
    if (e.from > pos) {
      out.push({ from: pos, to: Math.min(e.from, to) });
    }
    if (e.to > pos) pos = Math.min(Math.max(pos, e.to), to);
    if (pos >= to) break;
  }
  if (pos < to) out.push({ from: pos, to });
  return out.filter((r) => r.to > r.from);
}

function trimWhitespaceRange(
  src: string,
  from: number,
  to: number,
): { from: number; to: number } {
  let a = from;
  let b = to;
  while (
    a < b &&
    (src[a] === " " || src[a] === "\t" || src[a] === "\n" || src[a] === "\r")
  ) {
    a++;
  }
  while (
    b > a &&
    (src[b - 1] === " " ||
      src[b - 1] === "\t" ||
      src[b - 1] === "\n" ||
      src[b - 1] === "\r")
  ) {
    b--;
  }
  return { from: a, to: b };
}

function getKnownBoldHiddens(
  src: string,
  doc: VisualLike,
): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  for (const h of doc.hidden) {
    const slice = src.slice(h.from, h.to);
    const isOpen = /^\\(textbf|textit|emph)\{$/.test(slice);
    const isClose = slice === "}";
    if (!isOpen && !isClose) continue;
    for (const m of doc.marks) {
      if ((isOpen && h.to === m.from) || (isClose && h.from === m.to)) {
        out.push({ from: h.from, to: h.to });
        break;
      }
    }
  }
  out.sort((a, b) => a.from - b.from || a.to - b.to);
  return out;
}

type HeadingOuter = {
  openFrom: number;
  openTo: number;
  closeFrom: number;
  closeTo: number;
  level: 1 | 2 | 3;
};

function collectHeadingOuters(src: string, doc: VisualLike): HeadingOuter[] {
  const out: HeadingOuter[] = [];
  const re = /\\(section|subsection|subsubsection)(\*)?\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const openFrom = m.index;
    const openTo = openFrom + m[0].length;
    if (openFrom < doc.body.from || openTo > doc.body.to) continue;
    const level = sectionLevel(m[1]!);
    if (level === null) continue;
    const lineStart = lineStartOf(src, openFrom);
    const lineEnd = findLineEnd(src, openFrom);
    if (src.slice(lineStart, openFrom).trim() !== "") continue;
    let depth = 1;
    let i = openTo;
    let closeFrom = -1;
    while (i < lineEnd) {
      const c = src[i]!;
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "{") {
        depth++;
        i++;
        continue;
      }
      if (c === "}") {
        depth--;
        if (depth === 0) {
          closeFrom = i;
          break;
        }
        i++;
        continue;
      }
      i++;
    }
    if (closeFrom === -1) continue;
    const closeTo = closeFrom + 1;
    const trailing = src.slice(closeTo, lineEnd).trim();
    if (trailing !== "" && !trailing.startsWith("%")) continue;
    const hasHeading = doc.headings.some(
      (h) => h.from === lineStart && h.level === level,
    );
    if (!hasHeading) continue;
    out.push({ openFrom, openTo, closeFrom, closeTo, level });
  }
  out.sort((a, b) => a.openFrom - b.openFrom);
  return out;
}

type ItemRaw = {
  tokenFrom: number;
  tokenTo: number;
  rawFrom: number;
  rawTo: number;
};

function collectItemRaws(src: string, doc: VisualLike): ItemRaw[] {
  const out: ItemRaw[] = [];
  const ends = doc.hidden
    .filter((h) => src.slice(h.from, h.to).startsWith("\\end"))
    .sort((a, b) => a.from - b.from);
  const tokens = [...doc.items].sort((a, b) => a.from - b.from);
  for (const token of tokens) {
    let listEnd = -1;
    for (const e of ends) {
      if (e.from > token.to) {
        listEnd = e.from;
        break;
      }
    }
    if (listEnd === -1) continue;
    let nextTokenFrom = listEnd;
    for (const other of tokens) {
      if (other.from > token.to && other.from < listEnd) {
        if (other.from < nextTokenFrom) nextTokenFrom = other.from;
      }
    }
    const rawFrom = token.to;
    const rawTo = nextTokenFrom;
    if (rawFrom >= rawTo) continue;
    out.push({
      tokenFrom: token.from,
      tokenTo: token.to,
      rawFrom,
      rawTo,
    });
  }
  out.sort((a, b) => a.rawFrom - b.rawFrom);
  return out;
}

type LineInfo = { from: number; to: number; next: number };

function splitLines(src: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let pos = 0;
  while (pos < src.length) {
    const from = pos;
    const end = findLineEnd(src, pos);
    const next = end + eolLenAt(src, end);
    lines.push({ from, to: end, next: next > end ? next : end + 1 });
    pos = next > end ? next : end + 1;
    if (pos <= from) break;
  }
  return lines;
}

function buildBlocksForFile(file: string, src: string): PdfTextBlock[] {
  const doc = parseVisualDocument(src);
  if (doc.limited) return [];
  if (doc.body.to <= doc.body.from) return [];
  const blocks: PdfTextBlock[] = [];
  const pushBlock = (
    from: number,
    to: number,
    kind: PdfTextBlockKind,
  ): void => {
    if (from >= to) return;
    const source = src.slice(from, to);
    const text = decodeRange(src, from, to, doc.literals);
    if (text.trim() === "") return;
    blocks.push({
      id: `${file}:${from}-${to}`,
      file,
      from,
      to,
      text,
      startLine: lineNumberAt(src, from),
      endLine: lineNumberAt(src, Math.max(from, to - 1)),
      kind,
      source,
    });
  };

  const knownBold = getKnownBoldHiddens(src, doc);
  const headingOuters = collectHeadingOuters(src, doc);

  // Headings: split inner content around retained bold/italic wrappers.
  for (const outer of headingOuters) {
    const innerBold = knownBold.filter(
      (h) => h.from < outer.closeFrom && h.to > outer.openTo,
    );
    const subs = splitRangeByRanges(outer.openTo, outer.closeFrom, innerBold);
    for (const sub of subs) {
      const t = trimWhitespaceRange(src, sub.from, sub.to);
      if (t.from >= t.to) continue;
      if (src.slice(t.from, t.to).trim() === "") continue;
      const rawSlice = src.slice(t.from, t.to);
      if (/[\r\n]/.test(rawSlice)) continue;
      if (!isCleanRange(doc, t.from, t.to)) continue;
      const text = decodeRange(src, t.from, t.to, doc.literals);
      if (text.trim() === "") continue;
      if (/[\r\n]/.test(text)) continue;
      pushBlock(t.from, t.to, "heading");
    }
  }

  // Items: split raw item content around retained bold/italic wrappers.
  const itemRaws = collectItemRaws(src, doc);
  for (const raw of itemRaws) {
    const innerBold = knownBold.filter(
      (h) => h.from < raw.rawTo && h.to > raw.rawFrom,
    );
    const subs = splitRangeByRanges(raw.rawFrom, raw.rawTo, innerBold);
    for (const sub of subs) {
      const t = trimWhitespaceRange(src, sub.from, sub.to);
      if (t.from >= t.to) continue;
      const slice = src.slice(t.from, t.to);
      if (slice.trim() === "") continue;
      if (hasBlankLine(slice)) continue;
      if (!isCleanRange(doc, t.from, t.to)) continue;
      const text = decodeRange(src, t.from, t.to, doc.literals);
      if (text.trim() === "") continue;
      if (/[\r\n]/.test(text)) continue;
      pushBlock(t.from, t.to, "item");
    }
  }

  // Paragraphs: exclude every wrapper/token/heading/item range, then group
  // wrapped lines. Bold/italic wrappers stay in source as gaps between blocks.
  const exclusions = mergeRanges([
    ...doc.hidden.map((h) => ({ from: h.from, to: h.to })),
    ...headingOuters.map((o) => ({ from: o.openFrom, to: o.closeTo })),
    ...doc.items.map((t) => ({ from: t.from, to: t.to })),
    ...itemRaws.map((r) => ({ from: r.rawFrom, to: r.rawTo })),
  ]);
  const runs = splitRangeByRanges(doc.body.from, doc.body.to, exclusions);
  const lines = splitLines(src);
  for (const run of runs) {
    if (src.slice(run.from, run.to).trim() === "") continue;
    // Per-line segments of this run.
    const segIndex: number[] = [];
    const segFrom: number[] = [];
    const segTo: number[] = [];
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!;
      const a = Math.max(line.from, run.from);
      const b = Math.min(line.to, run.to);
      if (a >= b) continue;
      if (src.slice(a, b).trim() === "") continue;
      if (!isCleanRange(doc, a, b)) continue;
      segIndex.push(li);
      segFrom.push(a);
      segTo.push(b);
    }
    if (segIndex.length === 0) continue;
    // Group consecutive lines (single-break wrapping).
    let gStart = 0;
    while (gStart < segIndex.length) {
      let gEnd = gStart;
      while (
        gEnd + 1 < segIndex.length &&
        segIndex[gEnd + 1] === segIndex[gEnd]! + 1
      ) {
        gEnd++;
      }
      let groupFrom = segFrom[gStart]!;
      let groupTo = segTo[gEnd]!;
      while (
        groupFrom < segTo[gStart]! &&
        (src[groupFrom] === " " || src[groupFrom] === "\t")
      ) {
        groupFrom++;
      }
      while (
        groupTo > groupFrom &&
        (src[groupTo - 1] === " " || src[groupTo - 1] === "\t")
      ) {
        groupTo--;
      }
      if (groupFrom < groupTo && isCleanRange(doc, groupFrom, groupTo)) {
        const rawSlice = src.slice(groupFrom, groupTo);
        if (!hasBlankLine(rawSlice)) {
          const text = decodeRange(src, groupFrom, groupTo, doc.literals);
          if (text.trim() !== "") {
            pushBlock(groupFrom, groupTo, "paragraph");
          }
        }
      }
      gStart = gEnd + 1;
    }
  }

  blocks.sort((a, b) => {
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    return a.from - b.from || a.to - b.to;
  });
  return blocks;
}

export function buildPdfTextBlocks(
  files: Record<string, string>,
): PdfTextBlock[] {
  const names = Object.keys(files).sort();
  const out: PdfTextBlock[] = [];
  let total = 0;
  for (const name of names) {
    const src = files[name];
    if (typeof src !== "string") continue;
    if (src.length > MAX_PDF_TOTAL_SOURCE) continue;
    if (total + src.length > MAX_PDF_TOTAL_SOURCE) break;
    total += src.length;
    const fileBlocks = buildBlocksForFile(name, src);
    for (const block of fileBlocks) {
      if (out.length >= MAX_PDF_TEXT_BLOCKS) break;
      out.push(block);
    }
    if (out.length >= MAX_PDF_TEXT_BLOCKS) break;
  }
  return out.slice(0, MAX_PDF_TEXT_BLOCKS);
}

function targetEolFor(source: string): string {
  if (source.includes("\r\n")) return "\r\n";
  if (source.includes("\r") && !source.includes("\n")) return "\r";
  return "\n";
}

export function pdfTextReplacement(
  block: PdfTextBlock,
  text: string,
  source: string,
): { from: number; to: number; insert: string } {
  if (!block || typeof block !== "object") throw new Error("invalid block");
  if (!Number.isInteger(block.from) || !Number.isInteger(block.to)) {
    throw new Error("invalid block range");
  }
  if (typeof block.source !== "string") throw new Error("stale block source");
  if (typeof source !== "string") throw new Error("invalid source");
  if (block.from < 0 || block.to < block.from || block.to > source.length) {
    throw new Error("block range out of bounds");
  }
  if (source.slice(block.from, block.to) !== block.source) {
    throw new Error("stale source: block slice no longer matches");
  }
  if (typeof text !== "string") throw new Error("invalid replacement text");
  if (
    block.kind !== "paragraph" &&
    block.kind !== "heading" &&
    block.kind !== "item"
  ) {
    throw new Error("invalid block kind");
  }
  if (text.trim() === "") throw new Error("replacement text must not be blank");
  if (block.kind === "heading" || block.kind === "item") {
    if (/[\r\n]/.test(text)) {
      throw new Error(`${block.kind} replacement must stay on one line`);
    }
  } else {
    if (hasBlankLine(text)) {
      throw new Error("paragraph replacement must not contain a blank line");
    }
    if (/^[\s]*[\r\n]/.test(text) || /[\r\n][\s]*$/.test(text)) {
      throw new Error("paragraph replacement must not add boundary newlines");
    }
  }
  const escaped = escapeVisualText(text);
  const eol = targetEolFor(source);
  const insert = escaped.replace(/\r\n|\n|\r/g, eol);
  return { from: block.from, to: block.to, insert };
}
