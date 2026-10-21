import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import {
  GITHUB_LIMITS,
  decodeGitHubBlob,
  encodeGitHubBlob,
  isValidSha,
  type PushResponse,
} from "@/lib/githubSync";
import {
  GitHubError,
  createBlob,
  createCommit,
  createRef,
  createRootTree,
  createTree,
  getBlob,
  getBranchHead,
  getCommitTreeSha,
  getTreeRecursive,
  updateRef,
  type NewTreeEntry,
} from "@/lib/githubSyncServer";
import { authorizeGitHubRoute, readJsonBody } from "../_auth";

export const runtime = "nodejs";

type ExpectedEntry = { path?: unknown; version?: unknown; incarnation?: unknown };

/** Push local source to the connected branch. Requires a pull baseline,
 *  a stationary remote head, and a fresh local snapshot. Remote paths
 *  outside the tracked set are preserved; only tracked paths missing
 *  locally are deleted. The ref update is non-force; on a race nothing is
 *  recorded and both sides stay recoverable.
 *
 *  A branch with no commits yet and no baseline can be initialized instead
 *  (`initializeBranch: true` with an explicit confirmation in the UI): the
 *  route builds a root tree plus a root commit and creates the branch ref
 *  only when the head is still absent. An existing head always requires an
 *  initial pull; a ref created mid-flight aborts without touching the
 *  remote. */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req, 65536);
  if (!parsed.ok) return parsed.response;
  const args = parsed.value as {
    projectId?: unknown;
    remoteHead?: unknown;
    expected?: unknown;
    initializeBranch?: unknown;
  };
  if (!Array.isArray(args.expected))
    return Response.json({ error: "Missing file snapshot." }, { status: 400 });
  const authed = await authorizeGitHubRoute(req, args.projectId, "edit", {
    needGitHubToken: true,
  });
  if (!authed.ok) return authed.response;
  const { principal } = authed;
  const token = principal.githubToken!;
  const convexOpts = { token: principal.convexToken, url: principal.convexUrl };
  const connection = await fetchQuery(
    api.github.getConnection,
    { projectId: principal.project._id as never },
    convexOpts,
  );
  if (!connection)
    return Response.json(
      { error: "Connect a GitHub repository first." },
      { status: 409 },
    );
  try {
    const liveHead = await getBranchHead(token, connection.owner, connection.repo, connection.branch);
    if (connection.lastCommitSha) {
      if (!isValidSha(args.remoteHead))
        return Response.json({ error: "Missing baseline. Check status before pushing.", status: 400 });
      if (connection.lastCommitSha !== args.remoteHead)
        return Response.json(
          { error: "Sync state is stale. Check status before pushing.", code: "stale-baseline" },
          { status: 409 },
        );
      if (liveHead !== connection.lastCommitSha)
        return Response.json(
          { error: "The remote branch moved. Pull before pushing.", code: "remote-moved" },
          { status: 409 },
        );
      return await pushIncremental(token, connection, liveHead, args, principal, convexOpts);
    }
    // No baseline yet: an existing head still requires an initial pull.
    if (liveHead)
      return Response.json(
        { error: "Pull the repository before the first push.", code: "needs-initial-pull" },
        { status: 409 },
      );
    if (args.initializeBranch !== true)
      return Response.json(
        { error: "This branch is empty. Confirm initialization to push saved source as its first commit.", code: "needs-initialize-branch" },
        { status: 409 },
      );
    return await pushInitial(token, connection, args, principal, convexOpts);
  } catch (error) {
    if (error instanceof GitHubError)
      return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Could not push to GitHub." }, { status: 502 });
  }
}

type ConnectionShape = {
  owner: string;
  repo: string;
  branch: string;
  lastCommitSha?: string;
  trackedPaths: string[];
};

type PrincipalShape = {
  project: { _id: string };
  convexToken: string;
  convexUrl: string | undefined;
};

/** Shared version/row-id snapshot gate: the local source must be exactly
 *  what the UI previewed, so an in-flight edit aborts instead of being
 *  silently included or overwritten. */
async function loadSnapshot(
  args: { expected?: unknown },
  projectId: string,
  convexOpts: { token: string; url: string | undefined },
): Promise<
  | { error: Response }
  | { rows: { path: string; content: string; version: number; _id: unknown }[] }
> {
  const rows = await fetchQuery(
    api.files.list,
    { projectId: projectId as never },
    convexOpts,
  );
  const expectedByPath = new Map(
    (args.expected as ExpectedEntry[])
      .filter((e) => typeof e?.path === "string" && typeof e?.version === "number")
      .map((e) => [e.path as string, e]),
  );
  for (const row of rows) {
    const want = expectedByPath.get(row.path);
    if (!want || want.version !== row.version || want.incarnation !== String(row._id))
      return {
        error: Response.json(
          { error: `Local source changed at "${row.path}". Save and retry the push.`, code: "stale-snapshot" },
          { status: 409 },
        ),
      };
  }
  if (expectedByPath.size !== rows.length)
    return {
      error: Response.json(
        { error: "Local source changed. Save and retry the push.", code: "stale-snapshot" },
        { status: 409 },
      ),
    };
  return { rows };
}

async function pushIncremental(
  token: string,
  connection: ConnectionShape,
  liveHead: string,
  args: { expected?: unknown },
  principal: PrincipalShape,
  convexOpts: { token: string; url: string | undefined },
) {
  const snapshot = await loadSnapshot(args, principal.project._id, convexOpts);
  if ("error" in snapshot) return snapshot.error;
  const rows = snapshot.rows;

  const treeSha = await getCommitTreeSha(token, connection.owner, connection.repo, liveHead);
  const { entries, truncated } = await getTreeRecursive(token, connection.owner, connection.repo, treeSha);
  if (truncated)
    return Response.json({ error: "The repository tree is too large to sync safely." }, { status: 409 });
  const remoteByPath = new Map(entries.filter((e) => e.type === "blob").map((e) => [e.path, e]));
  const tracked = new Set(connection.trackedPaths);
  const current = new Map(rows.map((r) => [r.path, r.content]));

  /** Refuse rather than overwrite: an unrelated repo file, a symlink or
   *  submodule, or a tree ancestor/descendant collision must never be
   *  silently replaced by a push. */
  function remoteCollision(path: string): string | null {
    for (const entry of entries) {
      if (entry.path === path) {
        if (entry.type === "tree") return `"${path}" collides with a remote directory.`;
        if (entry.type !== "blob") return `"${path}" is a submodule on the remote.`;
        if (entry.mode === "120000") return `"${path}" is a symlink on the remote.`;
        if (entry.mode !== "100644" && entry.mode !== "100755")
          return `"${path}" has an unsupported mode on the remote.`;
        if (!tracked.has(path))
          return `"${path}" exists on the remote outside this sync. Pull it first or rename the local file.`;
        return null;
      }
      if (entry.path.startsWith(`${path}/`))
        return `"${path}" collides with remote content beneath it.`;
    }
    for (const entry of entries) {
      if (entry.type === "blob" && path.startsWith(`${entry.path}/`))
        return `"${path}" collides with the remote file "${entry.path}".`;
    }
    return null;
  }

  // Diff tracked files against their remote blobs.
  const treeUpdates: NewTreeEntry[] = [];
  for (const [path] of current) {
    const collision = remoteCollision(path);
    if (collision)
      return Response.json({ error: `Push refused: ${collision}`, code: "remote-collision" }, { status: 409 });
  }
  for (const [path, content] of current) {
    const remote = remoteByPath.get(path);
    let changed = true;
    if (remote && isValidSha(remote.sha)) {
      const blob = await getBlob(token, connection.owner, connection.repo, remote.sha);
      const decoded = decodeGitHubBlob(path, blob.content);
      if (!decoded.ok)
        return Response.json(
          { error: `Cannot compare ${path}: ${decoded.error}`, code: "remote-unreadable" },
          { status: 409 },
        );
      changed = decoded.content !== content;
    }
    if (!changed) continue;
    const encoded = encodeGitHubBlob(path, content);
    if (!encoded)
      return Response.json({ error: `Cannot encode "${path}" for upload.` }, { status: 400 });
    const sha = await createBlob(token, connection.owner, connection.repo, encoded.content);
    treeUpdates.push({
      path,
      mode: remote?.mode === "100755" ? "100755" : "100644",
      type: "blob",
      sha,
    });
  }
  for (const path of tracked) {
    if (current.has(path)) continue;
    const remote = remoteByPath.get(path);
    // Only remove the regular blob this sync placed. Anything else
    // (symlink, submodule, mode change) is refused above per current
    // path; a vanished entry simply has nothing to delete.
    if (remote && (remote.mode === "100644" || remote.mode === "100755"))
      treeUpdates.push({ path, mode: "100644", type: "blob", sha: null });
  }
  if (treeUpdates.length === 0)
    return Response.json({ pushed: false, commitSha: liveHead } satisfies PushResponse);
  if (current.size > GITHUB_LIMITS.maxFiles)
    return Response.json({ error: "The project has more files than can sync." }, { status: 409 });

  const newTree = await createTree(token, connection.owner, connection.repo, treeSha, treeUpdates);
  const commitSha = await createCommit(
    token,
    connection.owner,
    connection.repo,
    "Sync from alove",
    newTree,
    [liveHead],
  );
  try {
    await updateRef(token, connection.owner, connection.repo, connection.branch, commitSha);
  } catch (error) {
    // Non-force ref update lost a race: our commit exists but the branch
    // is untouched. Report the conflict without recording a baseline.
    if (error instanceof GitHubError && error.status === 409)
      return Response.json(
        { error: "The remote branch moved during the push. Pull before pushing.", code: "remote-moved" },
        { status: 409 },
      );
    throw error;
  }
  const trackedPaths = [...current.keys()];
  try {
    await fetchMutation(
      api.github.recordPush,
      {
        projectId: principal.project._id as Id<"projects">,
        prevSha: liveHead,
        expectedTarget: { owner: connection.owner, repo: connection.repo, branch: connection.branch, baseline: connection.lastCommitSha },
        newSha: commitSha,
        trackedPaths,
      },
      convexOpts,
    );
  } catch {
    // The remote commit landed but the baseline acknowledgement failed.
    // The UI reconciles via refresh; nothing is silently rebased.
    return Response.json(
      { pushed: true, recorded: false, commitSha, code: "ack-failed" },
      { status: 200 },
    );
  }
  return Response.json({ pushed: true, recorded: true, commitSha } satisfies PushResponse);
}

/** First push to a branch with no commits: root tree (no base_tree) plus a
 *  root commit (no parents), then a create-ref guarded by the still-absent
 *  head. Any concurrent branch creation aborts before the remote changes. */
async function pushInitial(
  token: string,
  connection: ConnectionShape,
  args: { expected?: unknown },
  principal: PrincipalShape,
  convexOpts: { token: string; url: string | undefined },
) {
  const snapshot = await loadSnapshot(args, principal.project._id, convexOpts);
  if ("error" in snapshot) return snapshot.error;
  const rows = snapshot.rows;
  const current = new Map(rows.map((r) => [r.path, r.content]));
  if (current.size === 0)
    return Response.json(
      { error: "Add source files before initializing the branch." },
      { status: 409 },
    );
  if (current.size > GITHUB_LIMITS.maxFiles)
    return Response.json({ error: "The project has more files than can sync." }, { status: 409 });

  const treeUpdates: NewTreeEntry[] = [];
  let total = 0;
  for (const [path, content] of current) {
    total += Buffer.byteLength(content, "utf8");
    if (total > GITHUB_LIMITS.maxTotalBytes)
      return Response.json({ error: "The project content is larger than a branch can hold." }, { status: 409 });
    const encoded = encodeGitHubBlob(path, content);
    if (!encoded)
      return Response.json({ error: `Cannot encode "${path}" for upload.` }, { status: 400 });
    const sha = await createBlob(token, connection.owner, connection.repo, encoded.content);
    treeUpdates.push({ path, mode: "100644", type: "blob", sha });
  }

  const newTree = await createRootTree(token, connection.owner, connection.repo, treeUpdates);
  const commitSha = await createCommit(
    token,
    connection.owner,
    connection.repo,
    "Initialize from alove",
    newTree,
    [],
  );
  try {
    await createRef(token, connection.owner, connection.repo, connection.branch, commitSha);
  } catch (error) {
    // The branch appeared mid-flight: our tree and commit are dangling
    // objects only. The remote ref is untouched; pull before pushing.
    if (error instanceof GitHubError && error.status === 409)
      return Response.json(
        { error: "The branch was created during initialization. Pull before pushing.", code: "branch-created-race" },
        { status: 409 },
      );
    throw error;
  }
  const trackedPaths = [...current.keys()];
  try {
    await fetchMutation(
      api.github.recordPush,
      {
        projectId: principal.project._id as Id<"projects">,
        expectedTarget: { owner: connection.owner, repo: connection.repo, branch: connection.branch, baseline: connection.lastCommitSha },
        newSha: commitSha,
        trackedPaths,
      },
      convexOpts,
    );
  } catch {
    // The branch now points at our commit but the baseline acknowledgement
    // failed. The UI reconciles via the exact same refresh as a normal
    // push; nothing is silently rebased.
    return Response.json(
      { pushed: true, recorded: false, commitSha, code: "ack-failed" },
      { status: 200 },
    );
  }
  return Response.json({ pushed: true, recorded: true, commitSha } satisfies PushResponse);
}
