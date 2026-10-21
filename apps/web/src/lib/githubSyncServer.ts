/**
 * Server-only GitHub access. The OAuth token is fetched per request via
 * Clerk and never leaves this module: callers receive parsed results, never
 * the token. This module must only be imported from Route Handlers and other
 * server code — never from client components.
 *
 * There is no `server-only` dependency in this workspace, so the boundary is
 * enforced at import time below: any client bundle that pulls this module in
 * fails fast instead of shipping the token logic to the browser. (The
 * `clerkClient` import from `@clerk/nextjs/server` alone does not enforce
 * this in the installed SDK.)
 */
if (typeof window !== "undefined") {
  throw new Error("githubSyncServer is server-only and must not be bundled for the browser.");
}
import { clerkClient } from "@clerk/nextjs/server";
import {
  GITHUB_API_BASE,
  GITHUB_API_VERSION,
  GITHUB_LIMITS,
  validateRepoRef,
} from "./githubSync";

export class GitHubError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

/** Per-request user OAuth token for GitHub. Uses the installed SDK's
 *  non-deprecated provider form (`github`, not `oauth_github`). */
export async function getGitHubToken(userId: string): Promise<string | null> {
  const client = await clerkClient();
  const res = await client.users.getUserOauthAccessToken(userId, "github");
  return res.data[0]?.token ?? null;
}

export type GitHubCallOptions = {
  method?: string;
  body?: unknown;
  token: string;
  /** Max response bytes accepted for this endpoint. */
  maxBytes?: number;
};

const DEFAULT_MAX_BYTES = 262_144;
const BLOB_MAX_BYTES = 1_200_000;
const TREE_MAX_BYTES = 2_097_152;
const LIST_MAX_BYTES = 1_048_576;

/** Read a response body with a hard byte cap, checking content-length first
 *  so oversize payloads are rejected before allocation. */
async function readBoundedBody(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = res.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
      try {
        await res.body?.cancel();
      } catch {
        // Ignore cancellation failures; the size verdict stands.
      }
      throw new GitHubError("GitHub response exceeded the size limit.", 502);
    }
  }
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > maxBytes)
      throw new GitHubError("GitHub response exceeded the size limit.", 502);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // Ignore cancellation failures; the size verdict stands.
      }
      throw new GitHubError("GitHub response exceeded the size limit.", 502);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function readBoundedJson<T>(res: Response, maxBytes: number): Promise<T> {
  const bytes = await readBoundedBody(res, maxBytes);
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new GitHubError("Unexpected GitHub response.", 502);
  }
}

export async function githubFetch<T>(
  path: string,
  { method = "GET", body, token, maxBytes = DEFAULT_MAX_BYTES }: GitHubCallOptions,
): Promise<T> {
  if (!path.startsWith("/")) throw new GitHubError("Invalid GitHub path.", 500);
  let res: Response;
  try {
    res = await fetch(`${GITHUB_API_BASE}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(GITHUB_LIMITS.requestTimeoutMs),
    });
  } catch {
    throw new GitHubError(
      "GitHub is unreachable. Check the connection and retry.",
      502,
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new GitHubError(
      "GitHub denied the request. Reconnect the GitHub account with repo access.",
      401,
    );
  }
  if (res.status === 404) throw new GitHubError("Not found on GitHub.", 404);
  if (res.status === 409 || res.status === 422) {
    let detail = "";
    try {
      detail = ((await readBoundedJson(res, 65_536)) as { message?: string }).message ?? "";
    } catch {
      // Fall through with the generic conflict message.
    }
    throw new GitHubError(
      detail ? `GitHub refused the update: ${detail}` : "GitHub refused the update.",
      409,
    );
  }
  if (!res.ok) throw new GitHubError(`GitHub request failed (${res.status}).`, 502);
  if (res.status === 204) return undefined as T;
  return await readBoundedJson<T>(res, maxBytes);
}

export type RepoSummary = {
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
};

export async function listUserRepos(token: string): Promise<RepoSummary[]> {
  const data = await githubFetch<
    { full_name: string; private: boolean; default_branch: string }[]
  >(`/user/repos?per_page=${GITHUB_LIMITS.maxRepos}&sort=updated`, { token, maxBytes: LIST_MAX_BYTES });
  if (!Array.isArray(data)) throw new GitHubError("Unexpected GitHub response.", 502);
  return data
    .filter(
      (r): r is { full_name: string; private: boolean; default_branch: string } =>
        typeof r?.full_name === "string" && typeof r?.default_branch === "string",
    )
    .map((r) => {
      const [owner, ...rest] = r.full_name.split("/");
      return {
        owner,
        name: rest.join("/"),
        private: r.private === true,
        defaultBranch: r.default_branch,
      };
    })
    .filter((r) => validateRepoRef(r.owner, r.name, r.defaultBranch) === null)
    .slice(0, GITHUB_LIMITS.maxRepos);
}

export type BranchSummary = { name: string; sha: string };

export async function listBranches(
  token: string,
  owner: string,
  repo: string,
): Promise<BranchSummary[]> {
  const invalid = validateRepoRef(owner, repo, "main");
  if (invalid) throw new GitHubError(invalid, 400);
  const data = await githubFetch<{ name: string; commit: { sha: string } }[]>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=${GITHUB_LIMITS.maxBranches}`,
    { token, maxBytes: LIST_MAX_BYTES },
  );
  if (!Array.isArray(data)) throw new GitHubError("Unexpected GitHub response.", 502);
  return data
    .filter(
      (b): b is { name: string; commit: { sha: string } } =>
        typeof b?.name === "string" && typeof b?.commit?.sha === "string",
    )
    .map((b) => ({ name: b.name, sha: b.commit.sha }))
    .slice(0, GITHUB_LIMITS.maxBranches);
}

export async function getBranchHead(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<string | null> {
  const invalid = validateRepoRef(owner, repo, branch);
  if (invalid) throw new GitHubError(invalid, 400);
  try {
    const data = await githubFetch<{ object: { sha: string } }>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${branch
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
      { token },
    );
    return typeof data?.object?.sha === "string" ? data.object.sha : null;
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return null;
    throw error;
  }
}

export type TreeEntry = {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
};

export async function getCommitTreeSha(
  token: string,
  owner: string,
  repo: string,
  commitSha: string,
): Promise<string> {
  const data = await githubFetch<{ tree: { sha: string } }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${commitSha}`,
    { token },
  );
  if (typeof data?.tree?.sha !== "string")
    throw new GitHubError("Unexpected GitHub response.", 502);
  return data.tree.sha;
}

export async function getTreeRecursive(
  token: string,
  owner: string,
  repo: string,
  treeSha: string,
): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  const data = await githubFetch<{ tree: TreeEntry[]; truncated?: boolean }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${treeSha}?recursive=1`,
    { token, maxBytes: TREE_MAX_BYTES },
  );
  if (!Array.isArray(data?.tree)) throw new GitHubError("Unexpected GitHub response.", 502);
  if (data.tree.length > GITHUB_LIMITS.maxTreeEntries)
    return { entries: [], truncated: true };
  return { entries: data.tree, truncated: data.truncated === true };
}

export async function getBlob(
  token: string,
  owner: string,
  repo: string,
  sha: string,
): Promise<{ content: string }> {
  const data = await githubFetch<{ content?: string; encoding?: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${sha}`,
    { token, maxBytes: BLOB_MAX_BYTES },
  );
  if (data?.encoding !== "base64" || typeof data?.content !== "string")
    throw new GitHubError("Unexpected GitHub response.", 502);
  return { content: data.content };
}

export async function createBlob(
  token: string,
  owner: string,
  repo: string,
  base64: string,
): Promise<string> {
  const data = await githubFetch<{ sha: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs`,
    { method: "POST", token, body: { content: base64, encoding: "base64" } },
  );
  if (typeof data?.sha !== "string") throw new GitHubError("Unexpected GitHub response.", 502);
  return data.sha;
}

export type NewTreeEntry = {
  path: string;
  mode: "100644" | "100755";
  type: "blob";
  sha: string | null;
};

export async function createTree(
  token: string,
  owner: string,
  repo: string,
  baseTree: string,
  tree: NewTreeEntry[],
): Promise<string> {
  const data = await githubFetch<{ sha: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`,
    { method: "POST", token, body: { base_tree: baseTree, tree } },
  );
  if (typeof data?.sha !== "string") throw new GitHubError("Unexpected GitHub response.", 502);
  return data.sha;
}

/** Create a root tree (no base_tree) for the first commit on an empty branch.
 *  Official docs: omitting base_tree creates a new tree object without a base. */
export async function createRootTree(
  token: string,
  owner: string,
  repo: string,
  tree: NewTreeEntry[],
): Promise<string> {
  const data = await githubFetch<{ sha: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`,
    { method: "POST", token, body: { tree } },
  );
  if (typeof data?.sha !== "string") throw new GitHubError("Unexpected GitHub response.", 502);
  return data.sha;
}

/** Create a branch ref. Succeeds only when the ref does not exist yet:
 *  GitHub answers 422 for an existing ref, so a lost race surfaces as a
 *  GitHubError and leaves the remote unmodified (dangling objects only). */
export async function createRef(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  sha: string,
): Promise<void> {
  const invalid = validateRepoRef(owner, repo, branch);
  if (invalid) throw new GitHubError(invalid, 400);
  await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,
    { method: "POST", token, body: { ref: `refs/heads/${branch}`, sha } },
  );
}

export async function createCommit(
  token: string,
  owner: string,
  repo: string,
  message: string,
  treeSha: string,
  parents: string[],
): Promise<string> {
  const data = await githubFetch<{ sha: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
    { method: "POST", token, body: { message, tree: treeSha, parents } },
  );
  if (typeof data?.sha !== "string") throw new GitHubError("Unexpected GitHub response.", 502);
  return data.sha;
}

export async function updateRef(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  sha: string,
): Promise<void> {
  await githubFetch(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${branch
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    { method: "PATCH", token, body: { sha, force: false } },
  );
}
