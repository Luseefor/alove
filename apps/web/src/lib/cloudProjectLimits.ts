import { normalizeCompilePath } from "@alove/protocol";

export const MAX_FILE_BYTES = 768 * 1024;
export const MAX_PROJECT_BYTES = 4 * 1024 * 1024;
export const MAX_FILES = 250;
export const MAX_PROJECTS = 50;

export const TOO_MANY_FILES_ERROR =
  "Project has too many files (max 250). Delete files to add more.";
export const PROJECT_TOO_LARGE_ERROR =
  "Project is too large (max 4 MB). Shorten files or delete some.";
export const TOO_MANY_PROJECTS_ERROR =
  "Too many projects (max 50). Delete one to create another.";

export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
        continue;
      }
    }
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else bytes += 3;
  }
  return bytes;
}

export function invalidPathError(path: string): string {
  return (
    `Invalid path "${path}". ` +
    "Use a project-relative path without leading /, backslash, :, .., or empty segments."
  );
}

export type ProjectPathCheck =
  | { ok: true; path: string }
  | { ok: false; error: string };

export function checkProjectPath(raw: unknown): ProjectPathCheck {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, error: "Enter a project-relative path." };
  }
  if (normalizeCompilePath(raw) !== raw) {
    return { ok: false, error: invalidPathError(raw) };
  }
  return { ok: true, path: raw };
}

export function fileTooLargeError(path: string): string {
  return `"${path}" is too large (max 768 KB). Shorten it or split it into smaller files.`;
}

export function checkFileSize(path: string, content: string): string | null {
  if (utf8ByteLength(content) > MAX_FILE_BYTES) {
    return fileTooLargeError(path);
  }
  return null;
}

export function findPathCollision(
  path: string,
  existing: readonly string[],
  exclude?: string,
): string | null {
  for (const other of existing) {
    if (exclude !== undefined && other === exclude) continue;
    if (other === path) {
      return `A file already exists at "${path}". Remove it or pick another name.`;
    }
  }
  for (const other of existing) {
    if (exclude !== undefined && other === exclude) continue;
    if (other.startsWith(`${path}/`)) {
      return `Cannot use "${path}" because it is a folder containing "${other}". Pick another name.`;
    }
    if (path.startsWith(`${other}/`)) {
      return `Cannot use "${path}" because file "${other}" blocks that folder. Pick another name.`;
    }
  }
  return null;
}
