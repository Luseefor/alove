/**
 * Shared GitHub sync contract: validation, limits, and the text/dataURI
 * binary convention. No secrets here — the OAuth token lives server-side
 * only (see githubSyncServer.ts) and is never returned to the client.
 */

export const GITHUB_API_BASE = "https://api.github.com";
export const GITHUB_API_VERSION = "2022-11-28";
/** Scopes requested when connecting a GitHub account via Clerk. */
export const GITHUB_OAUTH_SCOPES = ["repo"] as const;

export const GITHUB_LIMITS = {
  /** Max files synced per pull/push (matches project cap). */
  maxFiles: 250,
  /** Max decoded bytes per file (matches project cap). */
  maxFileBytes: 768 * 1024,
  /** Max decoded bytes across the synced set (matches project cap). */
  maxTotalBytes: 4 * 1024 * 1024,
  /** Max tree entries inspected before refusing as truncated. */
  maxTreeEntries: 5000,
  /** Max repos listed per request (single page). */
  maxRepos: 100,
  /** Max branches listed per request (single page). */
  maxBranches: 100,
  /** Per-request body cap for sync API routes. */
  maxRequestBytes: 8 * 1024 * 1024,
  /** GitHub REST timeout per call. */
  requestTimeoutMs: 15_000,
} as const;

const SHA_RE = /^[0-9a-f]{40}$/;
const OWNER_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/;
const REPO_RE = /^[a-zA-Z0-9._-]{1,100}$/;

export function isValidSha(value: unknown): value is string {
  return typeof value === "string" && SHA_RE.test(value);
}

export function validateRepoRef(
  owner: unknown,
  repo: unknown,
  branch: unknown,
): string | null {
  if (typeof owner !== "string" || !OWNER_RE.test(owner))
    return "Invalid repository owner.";
  if (
    typeof repo !== "string" ||
    !REPO_RE.test(repo) ||
    repo === "." ||
    repo === ".."
  )
    return "Invalid repository name.";
  if (typeof branch !== "string" || !isValidBranch(branch))
    return "Invalid branch name.";
  return null;
}

export function isValidBranch(branch: string): boolean {
  if (branch.length === 0 || branch.length > 255) return false;
  if (/\s/.test(branch)) return false;
  if (branch.includes("..") || branch.includes("//")) return false;
  if (/[~^:?*\\[]/.test(branch)) return false;
  if (branch.includes("@{")) return false;
  if (branch.endsWith(".lock") || branch.endsWith("/") || branch.endsWith("."))
    return false;
  if (branch.startsWith("/") || branch.startsWith("-")) return false;
  return true;
}

const BINARY_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

function extensionOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

export function isBinarySyncPath(path: string): boolean {
  return Object.hasOwn(BINARY_MIME_BY_EXT, extensionOf(path));
}

function strictBase64ToBytes(body: string): Uint8Array | null {
  if (body.length === 0 || body.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body)) return null;
  try {
    const buf = Buffer.from(body, "base64");
    if (buf.toString("base64") !== body) return null;
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/** Decode a GitHub blob (base64) into project content. Text blobs must be
 *  valid UTF-8; binary-adjacent extensions become dataURIs. */
export function decodeGitHubBlob(
  path: string,
  base64: string,
): { ok: true; content: string } | { ok: false; error: string } {
  const bytes = strictBase64ToBytes(base64.replace(/\n/g, ""));
  if (!bytes) return { ok: false, error: `Invalid blob encoding for "${path}".` };
  if (bytes.length > GITHUB_LIMITS.maxFileBytes)
    return { ok: false, error: `"${path}" exceeds the file size limit.` };
  if (isBinarySyncPath(path)) {
    const mime = BINARY_MIME_BY_EXT[extensionOf(path)]!;
    return {
      ok: true,
      content: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
    };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, content: text };
  } catch {
    return {
      ok: false,
      error: `"${path}" is not valid UTF-8 text. Binary files need a binary extension (png, jpg, gif, webp, pdf).`,
    };
  }
}

/** Encode project content into a GitHub blob payload ({content, encoding}).
 *  Returns null for content that cannot round-trip (never for valid store
 *  content; dataURIs decode strictly). */
export function encodeGitHubBlob(
  path: string,
  content: string,
): { content: string; encoding: "base64" } | null {
  if (isBinarySyncPath(path) && content.startsWith("data:")) {
    const comma = content.indexOf(",");
    if (comma === -1) return null;
    const body = content.slice(comma + 1);
    if (!strictBase64ToBytes(body)) return null;
    return { content: body, encoding: "base64" };
  }
  return { content: Buffer.from(content, "utf8").toString("base64"), encoding: "base64" };
}

export type GitHubConnectionShape = {
  owner: string;
  repo: string;
  branch: string;
  lastCommitSha?: string;
  trackedPaths: string[];
  updatedAt: number;
};

export type FileSnapshot = {
  path: string;
  content?: string;
  version: number;
  incarnation?: string;
};

export type SyncStatusResponse =
  | { connected: false; githubLinked: boolean }
  | {
      connected: true;
      githubLinked: boolean;
      connection: GitHubConnectionShape;
      remoteHead: string | null;
      inSync: boolean;
      needsInitialPull: boolean;
    };

export type PullPreviewResponse = {
  remoteHead: string;
  paths: { path: string; size: number | null; sha: string }[];
  added: string[];
  updated: string[];
  removed: string[];
  skipped: { path: string; reason: string }[];
  truncated: boolean;
  needsInitialImport: boolean;
};

export type PullApplyResponse = {
  applied: true;
  remoteHead: string;
  files: { path: string; content: string; version: number; incarnation: string }[];
};

export type PushResponse =
  | { pushed: true; recorded: true; commitSha: string }
  | { pushed: true; recorded: false; commitSha: string }
  | { pushed: false; commitSha: string };
