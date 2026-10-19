export type WorkspaceSource = {
  title: string;
  files: Record<string, string>;
  mainFile: string | null;
};

const ARCHIVE_FORMAT = "alove-project";
const ARCHIVE_VERSION = 1;
const MAX_IMPORT_FILES = 1000;
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isSafePath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  if (path.includes("\\") || path.includes(":")) return false;
  if (path.startsWith("/")) return false;
  if (path.includes("//")) return false;
  if (path.endsWith("/")) return false;
  for (let i = 0; i < path.length; i += 1) {
    const code = path.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  const segments = path.split("/");
  for (const segment of segments) {
    if (segment.length === 0 || segment.startsWith("-") || segment !== segment.trim()) return false;
    if (segment === "." || segment === "..") return false;
    if (
      segment === "__proto__" ||
      segment === "constructor" ||
      segment === "prototype"
    )
      return false;
  }
  return true;
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function copyFiles(source: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    Object.defineProperty(out, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return out;
}

export function serializeWorkspaceSource(input: WorkspaceSource): string {
  if (!isPlainObject(input)) throw new Error("Invalid workspace source");
  const record = input as unknown as Record<string, unknown>;
  if (typeof record.title !== "string") throw new Error("Invalid title");
  if (!isPlainObject(record.files)) throw new Error("Invalid files");
  for (const value of Object.values(record.files)) {
    if (typeof value !== "string") throw new Error("Invalid file content");
  }
  if (record.mainFile !== null && typeof record.mainFile !== "string") {
    throw new Error("Invalid mainFile");
  }
  const files = copyFiles(record.files as Record<string, string>);
  return JSON.stringify({
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    title: record.title as string,
    files,
    mainFile: record.mainFile as string | null,
  });
}

export function parseWorkspaceSource(text: string): WorkspaceSource {
  if (typeof text !== "string") throw new Error("Invalid archive");
  if (text.length > MAX_ARCHIVE_BYTES) throw new Error("Archive too large");
  if (utf8ByteLength(text) > MAX_ARCHIVE_BYTES)
    throw new Error("Archive too large");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Invalid archive JSON");
  }
  if (!isPlainObject(data)) throw new Error("Invalid archive");
  const record = data as Record<string, unknown>;
  if (record.format !== ARCHIVE_FORMAT)
    throw new Error("Unsupported archive format");
  if (record.version !== ARCHIVE_VERSION)
    throw new Error("Unsupported archive version");
  if (typeof record.title !== "string") throw new Error("Invalid title");
  if (!isPlainObject(record.files)) throw new Error("Invalid files");
  const entries = Object.entries(record.files as Record<string, unknown>);
  if (entries.length > MAX_IMPORT_FILES) throw new Error("Too many files");
  const files: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (typeof value !== "string") throw new Error("Invalid file content");
    if (!isSafePath(key)) throw new Error(`Unsafe file path: ${key}`);
    Object.defineProperty(files, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  const mainFile = record.mainFile;
  if (mainFile === undefined) throw new Error("Invalid mainFile");
  if (mainFile !== null) {
    if (typeof mainFile !== "string") throw new Error("Invalid mainFile");
    if (!isSafePath(mainFile)) throw new Error("Unsafe mainFile");
    if (!mainFile.endsWith(".tex")) throw new Error("Invalid mainFile");
    if (!Object.prototype.hasOwnProperty.call(files, mainFile)) {
      throw new Error("mainFile not found");
    }
  }
  return { title: record.title, files, mainFile };
}
