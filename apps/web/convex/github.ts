import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireProject } from "./projectAccess";
import { checkpointProject } from "./sourceHistory";
import {
  MAX_FILES,
  MAX_PROJECT_BYTES,
  PROJECT_TOO_LARGE_ERROR,
  TOO_MANY_FILES_ERROR,
  checkFileSize,
  checkProjectPath,
  findPathCollision,
  utf8ByteLength,
} from "../src/lib/cloudProjectLimits";

const SHA_RE = /^[0-9a-f]{40}$/;
const OWNER_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$/;
const REPO_RE = /^[a-zA-Z0-9._-]{1,100}$/;
const BRANCH_RE = /^(?!.*\.\.)(?!.*[~^:?*\\[])(?!.*@\{)[^\s]{1,255}$/;

function checkRepoRef(
  owner: string,
  repo: string,
  branch: string,
): string | null {
  if (!OWNER_RE.test(owner)) return "Invalid repository owner.";
  if (!REPO_RE.test(repo) || repo === "." || repo === "..")
    return "Invalid repository name.";
  if (
    !BRANCH_RE.test(branch) ||
    branch.endsWith(".lock") ||
    branch.endsWith("/") ||
    branch.includes("//")
  )
    return "Invalid branch name.";
  return null;
}

function checkSha(sha: string): boolean {
  return SHA_RE.test(sha);
}

const targetArgs = v.object({
  owner: v.string(),
  repo: v.string(),
  branch: v.string(),
  baseline: v.optional(v.string()),
});
function assertTarget(
  connection: {
    owner: string;
    repo: string;
    branch: string;
    lastCommitSha?: string;
  },
  expected: { owner: string; repo: string; branch: string; baseline?: string },
) {
  if (
    connection.owner !== expected.owner ||
    connection.repo !== expected.repo ||
    connection.branch !== expected.branch ||
    connection.lastCommitSha !== expected.baseline
  )
    throw new Error("GitHub connection changed. Refresh before continuing.");
}

const snapshotEntry = v.object({
  path: v.string(),
  version: v.number(),
  incarnation: v.optional(v.string()),
});

export const getConnection = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProject(ctx, projectId, "read");
    return await ctx.db
      .query("githubConnections")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .unique();
  },
});

/** Owner-only. Never initializes a sync baseline: a fresh connection has no
 *  lastCommitSha until the first pull is previewed and applied, so a connect
 *  can never silently authorize overwriting either side. */
export const connect = mutation({
  args: {
    projectId: v.id("projects"),
    owner: v.string(),
    repo: v.string(),
    branch: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await requireProject(ctx, args.projectId, "owner");
    const invalid = checkRepoRef(args.owner, args.repo, args.branch);
    if (invalid) throw new Error(invalid);
    const now = Date.now();
    const existing = await ctx.db
      .query("githubConnections")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();
    if (existing) {
      const sameTarget =
        existing.owner === args.owner &&
        existing.repo === args.repo &&
        existing.branch === args.branch;
      await ctx.db.patch(existing._id, {
        owner: args.owner,
        repo: args.repo,
        branch: args.branch,
        // Switching target invalidates any baseline: the new repo/branch
        // must be pulled explicitly before push is allowed.
        ...(sameTarget ? {} : { lastCommitSha: undefined, trackedPaths: [] }),
        updatedBy: access.identity.subject,
        updatedAt: now,
      });
      return await ctx.db.get(existing._id);
    }
    const id = await ctx.db.insert("githubConnections", {
      projectId: args.projectId,
      owner: args.owner,
      repo: args.repo,
      branch: args.branch,
      trackedPaths: [],
      updatedBy: access.identity.subject,
      updatedAt: now,
    });
    return await ctx.db.get(id);
  },
});

export const disconnect = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProject(ctx, projectId, "owner");
    const existing = await ctx.db
      .query("githubConnections")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return { disconnected: true as const };
  },
});

/** Atomically checkpoint current source and apply a previewed remote tree.
 *  Every local row must still match the preview-time snapshot (version and
 *  row id); any drift aborts the whole mutation, leaving both sides
 *  untouched. Only previously tracked paths may be deleted. */
export const applyPull = mutation({
  args: {
    projectId: v.id("projects"),
    remoteHead: v.string(),
    expectedTarget: targetArgs,
    files: v.array(v.object({ path: v.string(), content: v.string() })),
    deletePaths: v.array(v.string()),
    expected: v.array(snapshotEntry),
  },
  handler: async (ctx, args) => {
    const access = await requireProject(ctx, args.projectId, "edit");
    if (!checkSha(args.remoteHead)) throw new Error("Invalid remote head.");
    const connection = await ctx.db
      .query("githubConnections")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();
    if (!connection) throw new Error("Connect a GitHub repository first.");
    assertTarget(connection, args.expectedTarget);

    const rows = await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const byPath = new Map(rows.map((row) => [row.path, row]));
    const expectedByPath = new Map(args.expected.map((e) => [e.path, e]));

    // CAS: no row may have moved since the preview snapshot.
    for (const row of rows) {
      const want = expectedByPath.get(row.path);
      if (
        !want ||
        want.version !== row.version ||
        want.incarnation !== String(row._id)
      ) {
        throw new Error(
          `Local source changed at "${row.path}". Refresh the preview before applying the pull.`,
        );
      }
    }
    for (const want of args.expected) {
      if (!byPath.has(want.path)) {
        throw new Error(
          `Local source changed at "${want.path}". Refresh the preview before applying the pull.`,
        );
      }
    }

    // Validate the incoming remote files before touching any row.
    const seen = new Set<string>();
    let total = 0;
    for (const file of args.files) {
      const pathCheck = checkProjectPath(file.path);
      if (!pathCheck.ok) throw new Error(pathCheck.error);
      if (seen.has(pathCheck.path))
        throw new Error(`Duplicate file "${pathCheck.path}".`);
      seen.add(pathCheck.path);
      const sizeError = checkFileSize(pathCheck.path, file.content);
      if (sizeError) throw new Error(sizeError);
      total += utf8ByteLength(file.content);
      if (total > MAX_PROJECT_BYTES) throw new Error(PROJECT_TOO_LARGE_ERROR);
    }
    const deleteSet = new Set<string>();
    for (const raw of args.deletePaths) {
      const pathCheck = checkProjectPath(raw);
      if (!pathCheck.ok) throw new Error(pathCheck.error);
      // Only previously tracked paths may be deleted: a local-only file
      // that shares a name is never removed by a pull.
      if (!connection.trackedPaths.includes(pathCheck.path)) continue;
      deleteSet.add(pathCheck.path);
    }
    if (args.files.some((file) => deleteSet.has(file.path)))
      throw new Error("A pull cannot both write and delete a path.");
    const finalFiles = new Map(
      rows
        .filter((row) => !deleteSet.has(row.path))
        .map((row) => [row.path, row.content]),
    );
    for (const file of args.files) finalFiles.set(file.path, file.content);
    const finalPaths = [...finalFiles.keys()];
    if (finalPaths.length > MAX_FILES) throw new Error(TOO_MANY_FILES_ERROR);
    if (
      [...finalFiles.values()].reduce(
        (sum, content) => sum + utf8ByteLength(content),
        0,
      ) > MAX_PROJECT_BYTES
    )
      throw new Error(PROJECT_TOO_LARGE_ERROR);
    for (const path of finalPaths) {
      const collision = findPathCollision(path, finalPaths, path);
      if (collision) throw new Error(collision);
    }
    await checkpointProject(ctx, access.project, rows, access.identity.subject);
    const now = Date.now();
    const incoming = new Map(args.files.map((f) => [f.path, f.content]));
    for (const row of rows) {
      if (deleteSet.has(row.path)) {
        await ctx.db.delete(row._id);
      } else if (incoming.has(row.path)) {
        const content = incoming.get(row.path)!;
        if (content !== row.content) {
          const version = row.version + 1;
          await ctx.db.patch(row._id, {
            content,
            version,
            updatedAt: now,
            updatedBy: access.identity.subject,
          });
        }
      } else {
        // Local-only file: kept as-is. A pull never deletes untracked work.
      }
    }
    for (const file of args.files) {
      if (byPath.has(file.path)) continue;
      await ctx.db.insert("projectFiles", {
        projectId: args.projectId,
        path: file.path,
        content: file.content,
        version: 1,
        updatedAt: now,
        updatedBy: access.identity.subject,
      });
    }

    const project = await ctx.db.get(args.projectId);
    if (project?.mainFile && deleteSet.has(project.mainFile)) {
      await ctx.db.patch(args.projectId, {
        mainFile: undefined,
        updatedAt: now,
      });
    } else if (project) {
      await ctx.db.patch(args.projectId, { updatedAt: now });
    }
    await ctx.db.patch(connection._id, {
      lastCommitSha: args.remoteHead,
      trackedPaths: args.files.map((file) => file.path),
      updatedBy: access.identity.subject,
      updatedAt: now,
    });

    const current = await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return {
      remoteHead: args.remoteHead,
      files: current.map((row) => ({
        path: row.path,
        content: row.content,
        version: row.version,
        incarnation: String(row._id),
      })),
    };
  },
});

/** Acknowledge a successful GitHub push. CAS on the previous baseline: if a
 *  concurrent pull moved it, this throws and the caller must reconcile via
 *  refresh instead of silently rebasing the baseline. `prevSha` is omitted
 *  only when initializing an empty branch, where the baseline is still
 *  unset (null normalizes both sides of the comparison). */
export const recordPush = mutation({
  args: {
    projectId: v.id("projects"),
    prevSha: v.optional(v.string()),
    expectedTarget: targetArgs,
    newSha: v.string(),
    trackedPaths: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await requireProject(ctx, args.projectId, "edit");
    if (args.prevSha !== undefined && !checkSha(args.prevSha))
      throw new Error("Invalid commit reference.");
    if (!checkSha(args.newSha)) throw new Error("Invalid commit reference.");
    const connection = await ctx.db
      .query("githubConnections")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();
    if (!connection) throw new Error("Connect a GitHub repository first.");
    assertTarget(connection, args.expectedTarget);
    if ((connection.lastCommitSha ?? null) !== (args.prevSha ?? null)) {
      throw new Error(
        "Sync state changed during the push. Refresh status before continuing; the remote commit was still created.",
      );
    }
    for (const path of args.trackedPaths) {
      const pathCheck = checkProjectPath(path);
      if (!pathCheck.ok) throw new Error(pathCheck.error);
    }
    await ctx.db.patch(connection._id, {
      lastCommitSha: args.newSha,
      trackedPaths: args.trackedPaths,
      updatedBy: access.identity.subject,
      updatedAt: Date.now(),
    });
    return { recorded: true as const, newSha: args.newSha };
  },
});

/** Reconcile after a push whose acknowledgement failed: only fast-forwards
 *  the baseline when the remote tree exactly matches current source. */
export const refreshBaseline = mutation({
  args: {
    projectId: v.id("projects"),
    remoteHead: v.string(),
    expectedTarget: targetArgs,
    remotePaths: v.array(v.string()),
    remoteContents: v.array(
      v.object({ path: v.string(), content: v.string() }),
    ),
  },
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId, "edit");
    if (!checkSha(args.remoteHead)) throw new Error("Invalid remote head.");
    const connection = await ctx.db
      .query("githubConnections")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .unique();
    if (!connection) throw new Error("Connect a GitHub repository first.");
    assertTarget(connection, args.expectedTarget);
    if (connection.lastCommitSha === args.remoteHead)
      return { refreshed: false as const, remoteHead: args.remoteHead };
    const rows = await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const remote = new Map(args.remoteContents.map((f) => [f.path, f.content]));
    if (remote.size !== rows.length) {
      throw new Error(
        "Remote and local source differ. Pull the remote changes instead of refreshing the baseline.",
      );
    }
    for (const row of rows) {
      if (remote.get(row.path) !== row.content) {
        throw new Error(
          "Remote and local source differ. Pull the remote changes instead of refreshing the baseline.",
        );
      }
    }
    await ctx.db.patch(connection._id, {
      lastCommitSha: args.remoteHead,
      trackedPaths: args.remotePaths,
      updatedAt: Date.now(),
    });
    return { refreshed: true as const, remoteHead: args.remoteHead };
  },
});
