import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireProject } from "./projectAccess";
import {
  checkFileSize,
  checkProjectPath,
  findPathCollision,
  MAX_FILES,
  MAX_PROJECT_BYTES,
  utf8ByteLength,
} from "../src/lib/cloudProjectLimits";

const MAX_ENTRIES = 100;
const MAX_BYTES = 8 * 1024 * 1024;
/** Whole-project replacements need a recovery point even above 100 files. */
export async function checkpointProject(
  ctx: MutationCtx,
  project: Doc<"projects">,
  files: Doc<"projectFiles">[],
  authorId: string,
) {
  const previous = await ctx.db
    .query("projectCheckpoints")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .order("desc")
    .take(3);
  const latest = previous[0];
  if (
    latest &&
    latest.title === project.name &&
    latest.mainFile === project.mainFile &&
    latest.files.length === files.length &&
    files.every((file) =>
      latest.files.some(
        (row) =>
          row.path === file.path &&
          row.version === file.version &&
          row.incarnation === String(file._id),
      ),
    )
  )
    return latest._id;
  const entries = [];
  let bytes = 0;
  for (const file of files) {
    bytes += utf8ByteLength(file.content);
    if (bytes > MAX_PROJECT_BYTES)
      throw new Error("Project too large to checkpoint safely.");
    entries.push({
      path: file.path,
      version: file.version,
      incarnation: String(file._id),
      contentId: await ctx.db.insert("historyContents", {
        content: file.content,
      }),
    });
  }
  const id = await ctx.db.insert("projectCheckpoints", {
    projectId: project._id,
    title: project.name,
    mainFile: project.mainFile,
    authorId,
    createdAt: Date.now(),
    bytes,
    files: entries,
  });
  // Two complete snapshots, at most 8 MiB. Never evict individual files from a snapshot.
  for (const old of previous.slice(1)) {
    for (const file of old.files) await ctx.db.delete(file.contentId);
    await ctx.db.delete(old._id);
  }
  return id;
}
export const checkpoint = mutation({
  args: {
    projectId: v.id("projects"),
    expected: v.array(
      v.object({
        path: v.string(),
        version: v.number(),
        incarnation: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const access = await requireProject(ctx, args.projectId, "edit");
    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    if (
      files.length !== args.expected.length ||
      files.some(
        (file) =>
          !args.expected.some(
            (row) =>
              row.path === file.path &&
              row.version === file.version &&
              row.incarnation === String(file._id),
          ),
      )
    )
      throw new Error(
        "Source changed before checkpointing. Refresh the preview.",
      );
    return checkpointProject(
      ctx,
      access.project,
      files,
      access.identity.subject,
    );
  },
});
export const checkpoints = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProject(ctx, projectId);
    return ctx.db
      .query("projectCheckpoints")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .order("desc")
      .take(2);
  },
});
export const getCheckpoint = query({
  args: { checkpointId: v.id("projectCheckpoints") },
  handler: async (ctx, { checkpointId }) => {
    const row = await ctx.db.get(checkpointId);
    if (!row) throw new Error("Checkpoint unavailable.");
    await requireProject(ctx, row.projectId);
    const files: Record<string, string> = {};
    for (const file of row.files) {
      const content = await ctx.db.get(file.contentId);
      if (!content) throw new Error("Checkpoint unavailable.");
      files[file.path] = content.content;
    }
    return { ...row, files };
  },
});
export async function recordSource(
  ctx: MutationCtx,
  entry: {
    projectId: Id<"projects">;
    path: string;
    content: string;
    version: number;
    incarnation: string;
    authorId: string;
    operation: "save" | "delete" | "rename" | "restore";
    previousPath?: string;
  },
) {
  const entries = await ctx.db
    .query("sourceHistory")
    .withIndex("by_project", (q) => q.eq("projectId", entry.projectId))
    .order("desc")
    .take(MAX_ENTRIES + 1);
  const latest = entries[0];
  if (
    latest &&
    latest.path === entry.path &&
    latest.version === entry.version &&
    latest.incarnation === entry.incarnation &&
    latest.operation === entry.operation
  )
    return;
  const bytes = utf8ByteLength(entry.content);
  if (bytes > MAX_BYTES) throw new Error("Revision exceeds history budget.");
  const contentId = await ctx.db.insert("historyContents", {
    content: entry.content,
  });
  const { content: _content, ...metadata } = entry;
  void _content;
  await ctx.db.insert("sourceHistory", {
    ...metadata,
    contentId,
    bytes,
    createdAt: Date.now(),
  });
  let retainedBytes = bytes;
  let retainedCount = 1;
  for (const row of entries) {
    if (retainedCount < MAX_ENTRIES && retainedBytes + row.bytes <= MAX_BYTES) {
      retainedCount++;
      retainedBytes += row.bytes;
    } else {
      await ctx.db.delete(row.contentId);
      await ctx.db.delete(row._id);
    }
  }
}
export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProject(ctx, projectId);
    return ctx.db
      .query("sourceHistory")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .order("desc")
      .take(MAX_ENTRIES);
  },
});
export const get = query({
  args: { revisionId: v.id("sourceHistory") },
  handler: async (ctx, { revisionId }) => {
    const row = await ctx.db.get(revisionId);
    if (!row) throw new Error("Revision unavailable.");
    await requireProject(ctx, row.projectId);
    const content = await ctx.db.get(row.contentId);
    if (!content) throw new Error("Revision unavailable.");
    return { ...row, content: content.content };
  },
});
async function restoreSource(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  path: string,
  content: string,
  expectedVersion: number,
  expectedIncarnation?: string,
) {
  const access = await requireProject(ctx, projectId, "edit");
  const pathCheck = checkProjectPath(path);
  const size = checkFileSize(path, content);
  if (!pathCheck.ok || size) throw new Error("Invalid stored revision.");
  const files = await ctx.db
    .query("projectFiles")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .collect();
  const current = files.find((file) => file.path === path);
  if (
    current
      ? current.version !== expectedVersion ||
        String(current._id) !== expectedIncarnation
      : expectedVersion !== 0 || expectedIncarnation !== undefined
  )
    throw new Error("File changed. Refresh the preview before restoring.");
  const collision = findPathCollision(
    path,
    files.map((file) => file.path),
    current?.path,
  );
  if (collision || (!current && files.length >= MAX_FILES))
    throw new Error(collision ?? "Too many files.");
  if (
    files.reduce(
      (sum, file) =>
        sum + (file._id === current?._id ? 0 : utf8ByteLength(file.content)),
      utf8ByteLength(content),
    ) > MAX_PROJECT_BYTES
  )
    throw new Error("Project too large.");
  if (current)
    await recordSource(ctx, {
      projectId: projectId,
      path: current.path,
      content: current.content,
      version: current.version,
      incarnation: String(current._id),
      authorId: current.updatedBy,
      operation: "save",
    });
  const now = Date.now();
  const version = (current?.version ?? 0) + 1;
  const id =
    current?._id ??
    (await ctx.db.insert("projectFiles", {
      projectId: projectId,
      path: path,
      content: content,
      version,
      updatedAt: now,
      updatedBy: access.identity.subject,
    }));
  if (current)
    await ctx.db.patch(current._id, {
      content: content,
      version,
      updatedAt: now,
      updatedBy: access.identity.subject,
    });
  await recordSource(ctx, {
    projectId: projectId,
    path: path,
    content: content,
    version,
    incarnation: String(id),
    authorId: access.identity.subject,
    operation: "restore",
  });
  await ctx.db.patch(projectId, { updatedAt: now });
  return { path: path, content: content, version, incarnation: String(id) };
}
export const restore = mutation({
  args: {
    revisionId: v.id("sourceHistory"),
    expectedVersion: v.number(),
    expectedIncarnation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const revision = await ctx.db.get(args.revisionId);
    if (!revision) throw new Error("Revision unavailable.");
    await requireProject(ctx, revision.projectId, "edit");
    const content = await ctx.db.get(revision.contentId);
    if (!content) throw new Error("Revision unavailable.");
    return restoreSource(
      ctx,
      revision.projectId,
      revision.path,
      content.content,
      args.expectedVersion,
      args.expectedIncarnation,
    );
  },
});
export const restoreCheckpointFile = mutation({
  args: {
    checkpointId: v.id("projectCheckpoints"),
    path: v.string(),
    expectedVersion: v.number(),
    expectedIncarnation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const checkpoint = await ctx.db.get(args.checkpointId);
    if (!checkpoint) throw new Error("Checkpoint unavailable.");
    await requireProject(ctx, checkpoint.projectId, "edit");
    const file = checkpoint.files.find((row) => row.path === args.path);
    if (!file) throw new Error("File unavailable in checkpoint.");
    const content = await ctx.db.get(file.contentId);
    if (!content) throw new Error("Checkpoint unavailable.");
    return restoreSource(
      ctx,
      checkpoint.projectId,
      file.path,
      content.content,
      args.expectedVersion,
      args.expectedIncarnation,
    );
  },
});
