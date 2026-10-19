import { COMPILE_REQUEST_LIMITS, normalizeCompilePath } from "@alove/protocol";

export const PROJECT_MAX_FILE_BYTES = COMPILE_REQUEST_LIMITS.maxFileBytes;

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export type ValidateProjectPathResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

export type ValidateProjectFolderResult =
  | { ok: true; base: string; keepPath: string }
  | { ok: false; error: string };

function existingPathsToSet(
  existing: Record<string, string> | ReadonlySet<string> | readonly string[],
): Set<string> {
  if (Array.isArray(existing)) return new Set(existing);
  if (existing instanceof Set) return new Set(existing);
  return new Set(Object.keys(existing));
}

function invalidPathError(path: string): string {
  return `Invalid path "${path}". Use a project-relative path without leading /, \\, :, .., or empty segments.`;
}

/**
 * Strict validator: the exact string passed here is the path that would be
 * stored. No trimming or slash stripping is performed so unsafe actual paths
 * (leading/trailing spaces, leading/trailing slashes, backslashes, `..`)
 * are rejected via normalizeCompilePath. Callers that want UX convenience
 * (e.g. text inputs) must trim/strip explicitly before calling and then
 * store the validated `path`.
 */
export function validateNewProjectPath(
  raw: unknown,
  existing: Record<string, string> | ReadonlySet<string> | readonly string[],
): ValidateProjectPathResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Enter a project-relative path." };
  }
  if (raw.length === 0) {
    return { ok: false, error: "Enter a project-relative path." };
  }
  if (normalizeCompilePath(raw) !== raw) {
    return { ok: false, error: invalidPathError(raw) };
  }
  const set = existingPathsToSet(existing);
  if (set.has(raw)) {
    return {
      ok: false,
      error: `A file already exists at "${raw}". Remove it or pick another name.`,
    };
  }
  for (const other of set) {
    if (other.startsWith(`${raw}/`)) {
      return {
        ok: false,
        error: `Cannot use "${raw}" because it is a folder containing "${other}". Pick another name.`,
      };
    }
    if (raw.startsWith(`${other}/`)) {
      return {
        ok: false,
        error: `Cannot use "${raw}" because file "${other}" blocks that folder. Pick another name.`,
      };
    }
  }
  return { ok: true, path: raw };
}

export function validateRenameProjectPath(
  oldPath: string,
  raw: unknown,
  existing: Record<string, string> | ReadonlySet<string> | readonly string[],
): ValidateProjectPathResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Enter a project-relative path." };
  }
  if (raw.length === 0) {
    return { ok: false, error: "Enter a project-relative path." };
  }
  if (raw === oldPath) {
    return { ok: true, path: raw };
  }
  if (normalizeCompilePath(raw) !== raw) {
    return { ok: false, error: invalidPathError(raw) };
  }
  const set = existingPathsToSet(existing);
  set.delete(oldPath);
  if (set.has(raw)) {
    return {
      ok: false,
      error: `A file already exists at "${raw}". Remove it or pick another name.`,
    };
  }
  for (const other of set) {
    if (other.startsWith(`${raw}/`)) {
      return {
        ok: false,
        error: `Cannot use "${raw}" because it is a folder containing "${other}". Pick another name.`,
      };
    }
    if (raw.startsWith(`${other}/`)) {
      return {
        ok: false,
        error: `Cannot use "${raw}" because file "${other}" blocks that folder. Pick another name.`,
      };
    }
  }
  return { ok: true, path: raw };
}

/**
 * Strict folder validator: `raw` is the exact folder name. No trimming or
 * trailing-slash stripping is performed here; text inputs should trim/strip
 * before calling (UI convenience) and then use the returned `base`.
 */
export function validateProjectFolderPath(
  raw: unknown,
  existing: Record<string, string> | ReadonlySet<string> | readonly string[],
): ValidateProjectFolderResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Enter a folder path." };
  }
  if (raw.length === 0) {
    return { ok: false, error: "Enter a folder path." };
  }
  const base = raw;
  if (normalizeCompilePath(base) !== base) {
    return { ok: false, error: invalidPathError(base) };
  }
  const set = existingPathsToSet(existing);
  const keepPath = `${base}/.gitkeep`;
  if (set.has(base)) {
    return {
      ok: false,
      error: `A file already exists at "${base}". Remove it or pick another name.`,
    };
  }
  if (set.has(keepPath)) {
    return {
      ok: false,
      error: `A file already exists at "${keepPath}". Remove it or pick another name.`,
    };
  }
  for (const other of set) {
    if (other.startsWith(`${base}/`)) {
      return {
        ok: false,
        error: `Folder "${base}" already exists (contains "${other}"). Pick another name.`,
      };
    }
    if (base.startsWith(`${other}/`)) {
      return {
        ok: false,
        error: `Cannot create folder "${base}" because file "${other}" blocks that path. Pick another name.`,
      };
    }
  }
  return { ok: true, base, keepPath };
}

const BINARY_UPLOAD_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "ico",
  "pdf",
]);

export function shouldStoreUploadAsDataUrl(
  logicalPath: string,
  mimeType?: string,
): boolean {
  const lower = logicalPath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot + 1) : "";
  if (BINARY_UPLOAD_EXTENSIONS.has(ext)) return true;
  if (mimeType) {
    const clean = mimeType.toLowerCase().split(";")[0].trim();
    if (clean === "application/pdf") return true;
    if (clean.startsWith("image/") && clean !== "image/svg+xml") return true;
  }
  return false;
}

export function uploadLogicalPathFor(
  fileName: string,
  webkitRelativePath?: string | null,
): string {
  const rel =
    webkitRelativePath && webkitRelativePath.length > 0
      ? webkitRelativePath
      : fileName;
  return rel.replace(/\\/g, "/");
}

export function validateProjectFileContentSize(
  logicalPath: string,
  content: string,
): ValidateProjectPathResult {
  if (utf8ByteLength(content) > PROJECT_MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `"${logicalPath}" is too large (max 1 MB).`,
    };
  }
  return { ok: true, path: logicalPath };
}
