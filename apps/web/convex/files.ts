import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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
  },
  handler: async (ctx, args) => {
    const id = await ctx.auth.getUserIdentity();
    if (!id) throw new Error("Unauthorized");
    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Not found");
    if (project.ownerId !== id.subject) throw new Error("Forbidden");
    const existing = await ctx.db
      .query("projectFiles")
      .withIndex("by_project_path", (q) =>
        q.eq("projectId", args.projectId).eq("path", args.path),
      )
      .unique();

    const now = Date.now();

    if (!existing) {
      const fid = await ctx.db.insert("projectFiles", {
        projectId: args.projectId,
        path: args.path,
        content: args.content,
        version: 1,
        updatedAt: now,
        updatedBy: id.subject,
      });
      await ctx.db.patch(args.projectId, { updatedAt: now });
      return { id: fid, version: 1, conflict: false as const };
    }

    if (
      args.expectedVersion != null &&
      existing.version !== args.expectedVersion
    ) {
      return {
        conflict: true as const,
        version: existing.version,
        content: existing.content,
      };
    }

    const next = existing.version + 1;
    await ctx.db.patch(existing._id, {
      content: args.content,
      version: next,
      updatedAt: now,
      updatedBy: id.subject,
    });
    await ctx.db.patch(args.projectId, { updatedAt: now });
    return { conflict: false as const, version: next };
  },
});
