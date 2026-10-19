import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { TEMPLATES } from "../src/lib/templates";
import { DEMO_FILES } from "../src/demo/demoProject";

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
      name: "Deep Learning Survey",
      ownerId: id.subject,
      designMode: true,
      updatedAt: now,
    });

    // Seed with demo files
    for (const file of DEMO_FILES) {
      if (file.type !== "folder") {
        await ctx.db.insert("projectFiles", {
          projectId: pid,
          path: file.path,
          content: file.content,
          version: 1,
          updatedAt: now,
          updatedBy: id.subject,
        });
      }
    }

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
  args: { projectId: v.string() },
  handler: async (ctx, { projectId }) => {
    const id = await ctx.auth.getUserIdentity();
    if (!id) return null;
    const normalized = ctx.db.normalizeId("projects", projectId);
    if (!normalized) return null;
    const project = await ctx.db.get(normalized);
    if (!project || project.ownerId !== id.subject) return null;
    return project;
  },
});

export const rename = mutation({
  args: { projectId: v.id("projects"), name: v.string() },
  handler: async (ctx, { projectId, name }) => {
    const identity = await ctx.auth.getUserIdentity();
    const project = await ctx.db.get(projectId);
    if (!identity || !project || project.ownerId !== identity.subject)
      throw new Error("Forbidden");
    const title = name.trim();
    if (!title || title.length > 200)
      throw new Error("Project name must be 1–200 characters");
    await ctx.db.patch(projectId, { name: title, updatedAt: Date.now() });
  },
});

export const create = mutation({
  args: {
    template: v.union(
      v.literal("blank"),
      v.literal("minimal"),
      v.literal("bib"),
      v.literal("sample"),
    ),
  },
  handler: async (ctx, { template }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const now = Date.now();
    const title =
      template === "blank"
        ? "Untitled Project"
        : template === "sample"
          ? "Quantum Entanglement Review"
          : TEMPLATES[template].label;
    const files =
      template === "sample"
        ? DEMO_FILES.filter((f) => f.type !== "folder").map((f) => ({
            path: f.path,
            content: f.content ?? "",
          }))
        : Object.entries(
            template === "blank"
              ? {
                  "main.tex":
                    "\\documentclass{article}\n\\begin{document}\n\n\\end{document}\n",
                }
              : TEMPLATES[template].files,
          ).map(([path, content]) => ({ path, content }));
    const projectId = await ctx.db.insert("projects", {
      name: title,
      ownerId: identity.subject,
      designMode: true,
      updatedAt: now,
    });
    for (const file of files)
      await ctx.db.insert("projectFiles", {
        ...file,
        projectId,
        version: 1,
        updatedAt: now,
        updatedBy: identity.subject,
      });
    return projectId;
  },
});

export const setMainFile = mutation({
  args: { projectId: v.id("projects"), path: v.string() },
  handler: async (ctx, { projectId, path }) => {
    const identity = await ctx.auth.getUserIdentity();
    const project = await ctx.db.get(projectId);
    if (!identity || !project || project.ownerId !== identity.subject)
      throw new Error("Forbidden");
    const file = await ctx.db
      .query("projectFiles")
      .withIndex("by_project_path", (q) =>
        q.eq("projectId", projectId).eq("path", path),
      )
      .unique();
    if (!path.endsWith(".tex") || !file)
      throw new Error("Select an existing TeX document");
    await ctx.db.patch(projectId, { mainFile: path, updatedAt: Date.now() });
  },
});
