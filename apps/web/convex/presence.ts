import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const STALE_MS = 25_000;

export const heartbeat = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    color: v.string(),
    cursorLine: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.auth.getUserIdentity();
    if (!id) throw new Error("Unauthorized");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.ownerId !== id.subject) {
      throw new Error("Forbidden");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("presence")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", id.subject),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        color: args.color,
        cursorLine: args.cursorLine,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("presence", {
      projectId: args.projectId,
      userId: id.subject,
      name: args.name,
      color: args.color,
      cursorLine: args.cursorLine,
      updatedAt: now,
    });
  },
});

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const id = await ctx.auth.getUserIdentity();
    if (!id) return [];
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== id.subject) return [];
    const rows = await ctx.db
      .query("presence")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const now = Date.now();
    return rows.filter((r) => now - r.updatedAt < STALE_MS);
  },
});
