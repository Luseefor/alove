import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
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

/**
 * Incarnation token = the row `_id`. Delete+recreate allocates a new row,
 * so a stale writer holding the old `_id` conflicts even when the version
 * happens to match (both start at 1). Every row has an `_id`, including
 * legacy rows, so no schema migration or runtime RNG is needed.
 */

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const id = await ctx.auth.getUserIdentity();
    if (!id) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== id.subject) return [];
    return await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

export const save = mutation({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    content: v.string(),
    expectedVersion: v.optional(v.number()),
    expectedIncarnation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.auth.getUserIdentity();
    if (!id) throw new Error("Unauthorized");
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Not found");
    if (project.ownerId !== id.subject) throw new Error("Forbidden");

    const pathCheck = checkProjectPath(args.path);
    if (!pathCheck.ok) throw new Error(pathCheck.error);
    const path = pathCheck.path;

    const sizeError = checkFileSize(path, args.content);
    if (sizeError) throw new Error(sizeError);

    const expected = args.expectedVersion ?? 0;

    const existing = await ctx.db
      .query("projectFiles")
      .withIndex("by_project_path", (q) =>
        q.eq("projectId", args.projectId).eq("path", path),
      )
      .unique();

    if (!existing) {
      if (expected !== 0) {
        return { conflict: true as const, version: 0, content: "", deleted: true as const, incarnation: undefined as string | undefined };
      }
      // Create (expectedVersion 0): no token required. There is no row to
      // overwrite, so any expectedIncarnation is stale context for a deleted
      // file and creation is still safe.
      const files = await ctx.db
        .query("projectFiles")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();
      if (files.length >= MAX_FILES) throw new Error(TOO_MANY_FILES_ERROR);
      const collision = findPathCollision(
        path,
        files.map((f) => f.path),
      );
      if (collision) throw new Error(collision);
      let total = utf8ByteLength(args.content);
      for (const f of files) {
        total += utf8ByteLength(f.content);
        if (total > MAX_PROJECT_BYTES) throw new Error(PROJECT_TOO_LARGE_ERROR);
      }
      if (total > MAX_PROJECT_BYTES) throw new Error(PROJECT_TOO_LARGE_ERROR);

      const now = Date.now();
      const fid = await ctx.db.insert("projectFiles", {
        projectId: args.projectId,
        path,
        content: args.content,
        version: 1,
        updatedAt: now,
        updatedBy: id.subject,
      });
      await ctx.db.patch(args.projectId, { updatedAt: now });
      return { id: fid, version: 1, conflict: false as const, incarnation: String(fid) };
    }

    if (existing.version !== expected) {
      return {
        conflict: true as const,
        version: existing.version,
        content: existing.content,
        incarnation: String(existing._id),
      };
    }
    // Existing write (expectedVersion > 0): the row token is required.
    // A missing token is treated as stale so a legacy caller cannot
    // overwrite a recreated row that happens to share the version.
    if (args.expectedIncarnation === undefined) {
      return {
        conflict: true as const,
        version: existing.version,
        content: existing.content,
        incarnation: String(existing._id),
        tokenRequired: true as const,
      };
    }
    if (args.expectedIncarnation !== String(existing._id)) {
      return {
        conflict: true as const,
        version: existing.version,
        content: existing.content,
        incarnation: String(existing._id),
        recreated: true as const,
      };
    }

    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const collision = findPathCollision(
      path,
      files.map((f) => f.path),
      existing.path,
    );
    if (collision) throw new Error(collision);
    let total = utf8ByteLength(args.content);
    for (const f of files) {
      if (f._id === existing._id) continue;
      total += utf8ByteLength(f.content);
      if (total > MAX_PROJECT_BYTES) throw new Error(PROJECT_TOO_LARGE_ERROR);
    }
    if (total > MAX_PROJECT_BYTES) throw new Error(PROJECT_TOO_LARGE_ERROR);

    const now = Date.now();
    const next = existing.version + 1;
    await ctx.db.patch(existing._id, {
      content: args.content,
      version: next,
      updatedAt: now,
      updatedBy: id.subject,
    });
    await ctx.db.patch(args.projectId, { updatedAt: now });
    return { conflict: false as const, version: next, incarnation: String(existing._id) };
  },
});

export const deleteFile = mutation({
  args: {
    projectId: v.id("projects"),
    path: v.string(),
    expectedVersion: v.optional(v.number()),
    expectedIncarnation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.auth.getUserIdentity();
    if (!id) throw new Error("Unauthorized");
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Not found");
    if (project.ownerId !== id.subject) throw new Error("Forbidden");

    const pathCheck = checkProjectPath(args.path);
    if (!pathCheck.ok) throw new Error(pathCheck.error);

    const existing = await ctx.db
      .query("projectFiles")
      .withIndex("by_project_path", (q) =>
        q.eq("projectId", args.projectId).eq("path", pathCheck.path),
      )
      .unique();

    if (!existing) {
      return { deleted: false as const, alreadyMissing: true as const };
    }
    // Delete targets an existing row: the row token is required. Without
    // it a stale delete for an old incarnation could remove the recreated
    // file, even when the version happens to match.
    if (existing.version !== args.expectedVersion) {
      return {
        deleted: false as const,
        conflict: true as const,
        version: existing.version,
        content: existing.content,
        incarnation: String(existing._id),
      };
    }
    if (args.expectedIncarnation === undefined) {
      return {
        deleted: false as const,
        conflict: true as const,
        version: existing.version,
        content: existing.content,
        incarnation: String(existing._id),
        tokenRequired: true as const,
      };
    }
    if (args.expectedIncarnation !== String(existing._id)) {
      return {
        deleted: false as const,
        conflict: true as const,
        version: existing.version,
        content: existing.content,
        incarnation: String(existing._id),
        recreated: true as const,
      };
    }

    await ctx.db.delete(existing._id);
    await ctx.db.patch(args.projectId, {
      updatedAt: Date.now(),
      ...(project.mainFile === pathCheck.path
        ? { mainFile: undefined }
        : {}),
    });
    return { deleted: true as const };
  },
});

export const renameFile = mutation({
  args: {
    projectId: v.id("projects"),
    oldPath: v.string(),
    newPath: v.string(),
    expectedVersion: v.optional(v.number()),
    expectedIncarnation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.auth.getUserIdentity();
    if (!id) throw new Error("Unauthorized");
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Not found");
    if (project.ownerId !== id.subject) throw new Error("Forbidden");

    const oldCheck = checkProjectPath(args.oldPath);
    if (!oldCheck.ok) throw new Error(oldCheck.error);
    const newCheck = checkProjectPath(args.newPath);
    if (!newCheck.ok) throw new Error(newCheck.error);
    const oldPath = oldCheck.path;
    const newPath = newCheck.path;

    const existing = await ctx.db
      .query("projectFiles")
      .withIndex("by_project_path", (q) =>
        q.eq("projectId", args.projectId).eq("path", oldPath),
      )
      .unique();
    if (!existing) throw new Error(`No file at "${oldPath}".`);
    if (oldPath === newPath) return { renamed: true as const, incarnation: String(existing._id) };
    // Rename targets an existing row: the row token is required. Without
    // it a stale rename for an old incarnation could steal the recreated
    // file, even when the version happens to match.
    if (existing.version !== args.expectedVersion) {
      return {
        renamed: false as const,
        conflict: true as const,
        version: existing.version,
        content: existing.content,
        incarnation: String(existing._id),
      };
    }
    if (args.expectedIncarnation === undefined) {
      return {
        renamed: false as const,
        conflict: true as const,
        version: existing.version,
        content: existing.content,
        incarnation: String(existing._id),
        tokenRequired: true as const,
      };
    }
    if (args.expectedIncarnation !== String(existing._id)) {
      return {
        renamed: false as const,
        conflict: true as const,
        version: existing.version,
        content: existing.content,
        incarnation: String(existing._id),
        recreated: true as const,
      };
    }
    const conflict = await ctx.db
      .query("projectFiles")
      .withIndex("by_project_path", (q) =>
        q.eq("projectId", args.projectId).eq("path", newPath),
      )
      .unique();
    if (conflict) {
      throw new Error("A file with the new name already exists.");
    }

    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const collision = findPathCollision(
      newPath,
      files.map((f) => f.path),
      oldPath,
    );
    if (collision) throw new Error(collision);

    await ctx.db.patch(existing._id, {
      path: newPath,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(args.projectId, {
      updatedAt: Date.now(),
      ...((project.mainFile ?? "main.tex") === oldPath
        ? {
            mainFile: newPath.endsWith(".tex") ? newPath : undefined,
          }
        : {}),
    });
    return { renamed: true as const, incarnation: String(existing._id) };
  },
});
