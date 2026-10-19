const BINARY_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  svg: "image/svg+xml",
};

function getExtension(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const dot = base.lastIndexOf(".");
  if (dot === -1) return "";
  return base.slice(dot + 1).toLowerCase();
}

function hasBinaryMime(ext: string): boolean {
  return Object.prototype.hasOwnProperty.call(BINARY_MIME_BY_EXT, ext);
}

function decodeStrictBase64(filePath: string, body: string): Uint8Array {
  if (body.length === 0) return new Uint8Array(0);
  if (body.length % 4 !== 0) {
    throw new Error(
      `Invalid data URL for "${filePath}": malformed base64 payload`,
    );
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body)) {
    throw new Error(
      `Invalid data URL for "${filePath}": malformed base64 payload`,
    );
  }
  const buf = Buffer.from(body, "base64");
  if (buf.length === 0) {
    throw new Error(
      `Invalid data URL for "${filePath}": malformed base64 payload`,
    );
  }
  if (buf.toString("base64") !== body) {
    throw new Error(
      `Invalid data URL for "${filePath}": malformed base64 payload`,
    );
  }
  return new Uint8Array(buf);
}

/**
 * Decode binary asset payloads that arrive as UTF-8 data-URL text.
 *
 * Binary-adjacent paths (png/jpg/jpeg/gif/webp/pdf/svg, case-insensitive)
 * whose content starts with `data:` must be exactly
 * `data:<matching-mime>;base64,<strict-base64>` and decode to raw bytes.
 * Everything else (plain TeX/Bib/other text, raw non-data-URL strings) is
 * returned unchanged. `.tex`/`.bib` paths are never decoded.
 */
export function decodeCompileFileData(
  path: string,
  content: string,
): string | Uint8Array {
  const ext = getExtension(path);
  if (ext === "tex" || ext === "bib") return content;
  if (!hasBinaryMime(ext)) return content;
  const expectedMime = BINARY_MIME_BY_EXT[ext];
  if (!content.startsWith("data:")) return content;

  const comma = content.indexOf(",");
  if (comma === -1) {
    throw new Error(
      `Invalid data URL for "${path}": missing comma separator`,
    );
  }
  const header = content.slice("data:".length, comma);
  const body = content.slice(comma + 1);
  const headerParts = header.split(";");
  if (headerParts.length !== 2 || headerParts[1] !== "base64") {
    throw new Error(
      `Invalid data URL for "${path}": expected ";base64" payload`,
    );
  }
  const mime = headerParts[0].toLowerCase();
  if (mime !== expectedMime) {
    throw new Error(
      `Invalid data URL for "${path}": MIME "${headerParts[0]}" does not match "${expectedMime}"`,
    );
  }
  return decodeStrictBase64(path, body);
}
