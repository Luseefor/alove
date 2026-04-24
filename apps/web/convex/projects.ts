import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const defaultMainTex = `\\documentclass{article}
\\begin{document}
\\section{Introduction}
Welcome to alove — collaborative design mode syncs through Convex.

\\section{Related work}
Write here.

\\subsection{Details}
Body text.
\\end{document}
`;

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const id = await ctx.auth.getUserIdentity();
    if (!id) return [];
    return await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", id.subject))
      .collect();
  },
});

export const ensureDefault = mutation({
  args: {},
  handler: async (ctx) => {
    const id = await ctx.auth.getUserIdentity();
    if (!id) throw new Error("Unauthorized");
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", id.subject))
      .first();
    if (existing) return existing._id;
    const now = Date.now();
    const pid = await ctx.db.insert("projects", {
      name: "My project",
      ownerId: id.subject,
      designMode: true,
      updatedAt: now,
    });
    await ctx.db.insert("projectFiles", {
      projectId: pid,
      path: "main.tex",
      content: defaultMainTex,
      version: 1,
      updatedAt: now,
      updatedBy: id.subject,
    });
    return pid;
  },
});

export const setDesignMode = mutation({
  args: { projectId: v.id("projects"), designMode: v.boolean() },
  handler: async (ctx, { projectId, designMode }) => {
    const id = await ctx.auth.getUserIdentity();
    if (!id) throw new Error("Unauthorized");
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== id.subject) {
      throw new Error("Forbidden");
    }
    await ctx.db.patch(projectId, {
      designMode,
      updatedAt: Date.now(),
    });
  },
});

export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const id = await ctx.auth.getUserIdentity();
    if (!id) return null;
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== id.subject) return null;
    return project;
  },
});
