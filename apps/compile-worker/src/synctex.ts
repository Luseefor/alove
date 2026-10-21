import { gunzipSync } from "node:zlib";
import {
  COMPILE_SYNCTEX_LIMITS,
  normalizeCompilePath,
  type SyncTexEntry,
  type SyncTexMapping,
  type SyncTexPreamble,
} from "@alove/protocol";

export type SyncTexParseOptions = {
  /** Project-relative paths known to this build. Unknown engine inputs
   *  (system classes, absolute TeX tree files) are dropped. */
  knownFiles?: Set<string> | string[];
  maxEntries?: number;
  maxInputFiles?: number;
  maxLines?: number;
};

export type SyncTexDecodeOptions = SyncTexParseOptions & {
  maxCompressedBytes?: number;
  maxDecompressedBytes?: number;
};

const DEFAULT_MAX_LINES = 500_000;
const MAX_LINE_LENGTH = 4096;
const MAX_TAG = 1_000_000;
const MAX_LINE_NUMBER = 10_000_000;
const MAX_COORD = 2_147_483_647;

function toKnownSet(
  knownFiles?: Set<string> | string[],
): Set<string> | null {
  if (!knownFiles) return null;
  return knownFiles instanceof Set ? knownFiles : new Set(knownFiles);
}

/**
 * Map an engine-reported `Input:` path to a project-relative path.
 * Engine paths are absolute container paths such as `/work/./main.tex`,
 * `/tmp/syncproof/./chap.tex`, or TeX tree paths. Only suffixes that match
 * a known payload file are kept; everything else (system classes, aux
 * files outside the payload) is dropped. Returns null for untrusted paths.
 */
export function resolveSyncTexPath(
  rawPath: string,
  knownFiles?: Set<string> | string[],
): string | null {
  const known = toKnownSet(knownFiles);
  if (typeof rawPath !== "string" || rawPath.length === 0) return null;
  if (rawPath.includes("\0")) return null;
  if (rawPath.length > 4096) return null;
  const normalized = rawPath.replace(/\\/g, "/");
  // Lexically collapse `.` and `..` without touching the filesystem.
  const parts: string[] = [];
  for (const seg of normalized.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  if (parts.length === 0) return null;
  const collapsed = parts.join("/");
  const candidates: string[] = [collapsed];
  // Prefer the portion after known container roots (/work/, /source/).
  for (const marker of ["/work/", "/source/"]) {
    const idx = normalized.lastIndexOf(marker);
    if (idx >= 0) {
      const tail = normalized
        .slice(idx + marker.length)
        .split("/")
        .filter((s) => s !== "" && s !== ".");
      const resolved: string[] = [];
      for (const seg of tail) {
        if (seg === "..") resolved.pop();
        else resolved.push(seg);
      }
      if (resolved.length > 0) candidates.push(resolved.join("/"));
    }
  }
  // Also try the bare basename as a last resort for `./main.tex` styles.
  candidates.push(parts[parts.length - 1]!);

  const tryName = (name: string): string | null => {
    if (normalizeCompilePath(name) !== name) return null;
    if (!known) return name;
    if (known.has(name)) return name;
    return null;
  };

  for (const candidate of candidates) {
    const direct = tryName(candidate);
    if (direct) return direct;
  }
  if (known) {
    // Suffix match: engine path `/x/y/chapters/paper.tex` resolves to
    // payload path `chapters/paper.tex`. Longest match wins.
    let best: string | null = null;
    for (const file of known) {
      if (collapsed === file || collapsed.endsWith(`/${file}`)) {
        if (!best || file.length > best.length) best = file;
      }
    }
    if (best) return best;
    const base = parts[parts.length - 1]!;
    const baseMatches = [...known].filter(
      (f) => f.split("/").at(-1) === base,
    );
    // Only adopt a basename when it is unambiguous across the payload.
    if (baseMatches.length === 1) return baseMatches[0]!;
  }
  return null;
}

const RECORD_LEADERS = new Set(["[", "(", "h", "v", "k", "g", "x", "$", "f"]);

function parseRecordPayload(payload: string): {
  tag: number;
  line: number;
  x: number;
  y: number;
  w: number;
  h: number;
  d: number;
} | null {
  // N,L:X,Y:W,H,D with an optional ,column after L. Trailing extents may
  // be absent on point records (x/g/k); missing extents decode as zero.
  // Examples: `1,5:4736286,46220574:26673152,41484288,0`, `x1,3:11257121,8865054`
  const m = /^(\d+),(\d+)(?:,\d+)?:(-?\d+),(-?\d+)(?::(-?\d+),(-?\d+),(-?\d+))?/.exec(payload);
  if (!m) return null;
  const tag = Number(m[1]);
  const line = Number(m[2]);
  const x = Number(m[3]);
  const y = Number(m[4]);
  const w = m[5] === undefined ? 0 : Number(m[5]);
  const h = m[6] === undefined ? 0 : Number(m[6]);
  const d = m[7] === undefined ? 0 : Number(m[7]);
  if (
    !Number.isSafeInteger(tag) ||
    !Number.isSafeInteger(line) ||
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(w) ||
    !Number.isSafeInteger(h) ||
    !Number.isSafeInteger(d)
  )
    return null;
  if (tag <= 0 || tag > MAX_TAG) return null;
  if (line <= 0 || line > MAX_LINE_NUMBER) return null;
  if (Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) return null;
  if (Math.abs(w) > MAX_COORD || Math.abs(h) > MAX_COORD || Math.abs(d) > MAX_COORD)
    return null;
  return { tag, line, x, y, w, h, d };
}

const DEFAULT_PREAMBLE: SyncTexPreamble = {
  magnification: 1000,
  unit: 1,
  xOffset: 0,
  yOffset: 0,
};

function parsePreambleValue(line: string, prefix: string): number | null {
  if (!line.startsWith(prefix)) return null;
  const raw = line.slice(prefix.length).trim();
  if (!/^-?\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Parse gunzipped SyncTeX text into a bounded mapping.
 * Implements the real SyncTeX stream (SyncTeX Version, Input:, Content:,
 * `{page` blocks, `[`/`(`/`h`/`v`/`k`/`g`/`x` records, Postamble:) per the
 * SyncTeX man page and go-synctex format notes. One malformed line never
 * aborts the file; caps keep CPU/memory bounded.
 */
export function parseSyncTex(
  text: string,
  options: SyncTexParseOptions = {},
): SyncTexMapping {
  const maxEntries =
    options.maxEntries ?? COMPILE_SYNCTEX_LIMITS.maxEntries;
  const maxInputFiles =
    options.maxInputFiles ?? COMPILE_SYNCTEX_LIMITS.maxInputFiles;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const known = toKnownSet(options.knownFiles);

  const inputs = new Map<number, string>();
  const entries: SyncTexEntry[] = [];
  let truncated = false;
  let inContent = false;
  let currentPage: number | null = null;
  let linesScanned = 0;
  const preamble: SyncTexPreamble = { ...DEFAULT_PREAMBLE };

  let start = 0;
  const pushLine = (line: string): boolean => {
    linesScanned += 1;
    if (linesScanned > maxLines) {
      truncated = true;
      return false;
    }
    if (line.length > MAX_LINE_LENGTH) return true;
    if (!inContent) {
      if (line === "Content:") inContent = true;
      else if (line.startsWith("Magnification:")) {
        const value = parsePreambleValue(line, "Magnification:");
        if (value !== null && value > 0 && value <= 1_000_000)
          preamble.magnification = value;
      } else if (line.startsWith("Unit:")) {
        const value = parsePreambleValue(line, "Unit:");
        if (value !== null && value > 0 && value <= 1_000_000_000)
          preamble.unit = value;
      } else if (line.startsWith("X Offset:")) {
        const value = parsePreambleValue(line, "X Offset:");
        if (value !== null && Math.abs(value) <= MAX_COORD)
          preamble.xOffset = value;
      } else if (line.startsWith("Y Offset:")) {
        const value = parsePreambleValue(line, "Y Offset:");
        if (value !== null && Math.abs(value) <= MAX_COORD)
          preamble.yOffset = value;
      } else if (line.startsWith("Input:")) {
        const m = /^Input:(\d+):(.+)$/.exec(line);
        if (m && inputs.size < maxInputFiles) {
          const tag = Number(m[1]);
          if (
            Number.isSafeInteger(tag) &&
            tag > 0 &&
            tag <= MAX_TAG &&
            !inputs.has(tag)
          ) {
            const resolved = resolveSyncTexPath(m[2]!, known ?? undefined);
            // Keep the tag mapped even when the file is outside the
            // payload so later records resolve to null and are dropped.
            // Store empty string for unresolvable tags.
            inputs.set(tag, resolved ?? "");
          }
        }
      }
      return true;
    }
    if (line === "Postamble:" || line.startsWith("Postamble:")) return false;
    if (line.startsWith("Input:")) {
      const m = /^Input:(\d+):(.+)$/.exec(line);
      if (m && inputs.size < maxInputFiles) {
        const tag = Number(m[1]);
        if (
          Number.isSafeInteger(tag) &&
          tag > 0 &&
          tag <= MAX_TAG &&
          !inputs.has(tag)
        ) {
          inputs.set(
            tag,
            resolveSyncTexPath(m[2]!, known ?? undefined) ?? "",
          );
        }
      }
      return true;
    }
    if (line.length === 0 || line[0] === "!") return true;
    const first = line[0]!;
    if (first === "{") {
      const page = Number(line.slice(1).trim());
      currentPage =
        Number.isSafeInteger(page) && page > 0 && page <= 100_000
          ? page
          : null;
      return true;
    }
    if (first === "}") {
      currentPage = null;
      return true;
    }
    // Form blocks `<tag` / `>` carry no page of their own; keep the
    // enclosing page context instead of dropping it.
    if (first === "<" || first === ">") return true;
    if (first === "[" || first === "]") {
      if (first === "]") return true;
    } else if (!RECORD_LEADERS.has(first)) {
      return true;
    }
    if (currentPage === null) return true;
    const payload =
      first === "[" || first === "("
        ? line.slice(1).trimStart()
        : line.slice(1).trimStart();
    if (payload.length === 0) return true;
    const record = parseRecordPayload(payload);
    if (!record) return true;
    const file = inputs.get(record.tag);
    if (!file) return true;
    if (normalizeCompilePath(file) !== file) return true;
    if (known && !known.has(file)) return true;
    if (entries.length >= maxEntries) {
      truncated = true;
      return false;
    }
    // Height folds depth so web highlight math needs one vertical extent.
    const height = Math.min(MAX_COORD, Math.max(0, record.h) + Math.max(0, record.d));
    const width = Math.max(0, Math.min(MAX_COORD, record.w));
    entries.push({
      file,
      line: record.line,
      page: currentPage,
      x: record.x,
      y: record.y,
      ...(width > 0 ? { width } : {}),
      ...(height > 0 ? { height } : {}),
    });
    return true;
  };

  while (start <= text.length) {
    let end = text.indexOf("\n", start);
    if (end < 0) end = text.length;
    let line = text.slice(start, end);
    if (line.endsWith("\r")) line = line.slice(0, -1);
    const keepGoing = pushLine(line);
    if (!keepGoing) break;
    if (entries.length >= maxEntries && truncated) break;
    start = end + 1;
    if (start > text.length) break;
  }

  return { version: 1, entries, truncated, preamble };
}

/**
 * Gunzip a `.synctex.gz` artifact with bomb protection, then parse it.
 * Returns null when the artifact is absent/empty; never throws for corrupt
 * engine output (returns an empty mapping instead so the build still
 * succeeds without navigation).
 */
export function decodeSyncTexGz(
  data: Buffer | Uint8Array | null | undefined,
  options: SyncTexDecodeOptions = {},
): SyncTexMapping | null {
  if (!data || data.length === 0) return null;
  const maxCompressed =
    options.maxCompressedBytes ?? COMPILE_SYNCTEX_LIMITS.maxCompressedBytes;
  const maxDecompressed =
    options.maxDecompressedBytes ?? COMPILE_SYNCTEX_LIMITS.maxDecompressedBytes;
  if (data.length > maxCompressed) {
    return { version: 1, entries: [], truncated: true, preamble: { ...DEFAULT_PREAMBLE } };
  }
  let text: string;
  try {
    const out = gunzipSync(data, { maxOutputLength: maxDecompressed + 1 });
    if (out.length > maxDecompressed) {
      return { version: 1, entries: [], truncated: true, preamble: { ...DEFAULT_PREAMBLE } };
    }
    text = out.toString("utf8");
  } catch (error) {
    // Corrupt gzip: the build still succeeds without navigation.
    // Output beyond maxOutputLength throws ERR_BUFFER_TOO_LARGE: mark
    // truncated so callers report the cap honestly.
    const message = error instanceof Error ? error.message : String(error);
    const tooLarge =
      message.includes("larger than") ||
      message.includes("too large") ||
      message.includes("maxOutputLength") ||
      (error as NodeJS.ErrnoException)?.code === "ERR_BUFFER_TOO_LARGE";
    return { version: 1, entries: [], truncated: tooLarge, preamble: { ...DEFAULT_PREAMBLE } };
  }
  if (text.length === 0) return { version: 1, entries: [], truncated: false, preamble: { ...DEFAULT_PREAMBLE } };
  return parseSyncTex(text, options);
}

export const __testOnly = {
  parseRecordPayload,
  resolveSyncTexPath,
};
