import { v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { projectAccess, requireProject } from "./projectAccess";
import {
  MAX_FILES,
  MAX_PROJECTS,
  MAX_PROJECT_BYTES,
  PROJECT_TOO_LARGE_ERROR,
  TOO_MANY_PROJECTS_ERROR,
  checkFileSize,
  checkProjectPath,
  findPathCollision,
  utf8ByteLength,
} from "../src/lib/cloudProjectLimits";
import { TEMPLATES } from "../src/lib/templates";
import { DEMO_FILES } from "../src/demo/demoProject";

function assertSeedFiles(
  files: ReadonlyArray<{ path: string; content: string }>,
): string[] {
  if (files.length < 1 || files.length > MAX_FILES)
    throw new Error("Project must contain 1-250 files.");
  const paths: string[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const file of files) {
    const check = checkProjectPath(file.path);
    if (!check.ok) throw new Error(check.error);
    if (seen.has(check.path))
      throw new Error(`Duplicate file "${check.path}".`);
    seen.add(check.path);
    paths.push(check.path);
    const sizeError = checkFileSize(check.path, file.content);
    if (sizeError) throw new Error(sizeError);
    total += utf8ByteLength(file.content);
    if (total > MAX_PROJECT_BYTES) throw new Error(PROJECT_TOO_LARGE_ERROR);
  }
  for (const path of paths) {
    const collision = findPathCollision(path, paths, path);
    if (collision) throw new Error(collision);
  }
  return paths;
}

export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const id = await ctx.auth.getUserIdentity();
    if (!id) return [];
    const owned = await ctx.db.query("projects").withIndex("by_owner", q => q.eq("ownerId", id.subject)).collect();
    const memberships = await ctx.db.query("memberships").withIndex("by_user", q => q.eq("userId", id.subject)).take(100);
    const shared = [];
    for (const row of memberships) { const project = await ctx.db.get(row.projectId); if (project && project.ownerId !== id.subject) shared.push({ ...project, role: row.role }); }
    return [...owned.map(project => ({ ...project, role: "owner" as const })), ...shared];
  },
});

export const ensureDefault = mutation({
  args: {},
  handler: async (ctx) => {
    const id = await ctx.auth.getUserIdentity();
    if (!id) throw new Error("Unauthorized");
    const owned = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", id.subject))
      .collect();
    if (owned.length > 0) return owned[0]._id;
    if (owned.length >= MAX_PROJECTS) throw new Error(TOO_MANY_PROJECTS_ERROR);
    const now = Date.now();
    const pid = await ctx.db.insert("projects", {
      name: "Deep Learning Survey",
      ownerId: id.subject,
      designMode: true,
      updatedAt: now,
    });

    // Seed with demo files
    const seed = DEMO_FILES.filter((f) => f.type !== "folder").map((f) => ({
      path: f.path,
      content: f.content ?? "",
    }));
    assertSeedFiles(seed);
    for (const file of seed) {
      await ctx.db.insert("projectFiles", {
        projectId: pid,
        path: file.path,
        content: file.content,
        version: 1,
        updatedAt: now,
        updatedBy: id.subject,
      });
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
    const access = await projectAccess(ctx, normalized);
    return access ? { ...access.project, role: access.role } : null;
  },
});

export const rename = mutation({
  args: { projectId: v.id("projects"), name: v.string() },
  handler: async (ctx, { projectId, name }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Forbidden");
    await requireProject(ctx, projectId, "edit");
    const title = name.trim();
    if (!title || title.length > 200)
      throw new Error("Project name must be 1-200 characters");
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
    const owned = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.subject))
      .collect();
    if (owned.length >= MAX_PROJECTS)
      throw new Error(TOO_MANY_PROJECTS_ERROR);
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
    assertSeedFiles(files);
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
    if (!identity) throw new Error("Forbidden");
    await requireProject(ctx, projectId, "edit");
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

export const remove = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const project = await ctx.db.get(projectId);
    if (!project || project.ownerId !== identity.subject)
      throw new Error("Forbidden");
    const files = await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    const roster = await ctx.db
      .query("presence")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
    for (const file of files) {
      await ctx.db.delete(file._id);
    }
    for (const row of roster) {
      await ctx.db.delete(row._id);
    }
    await ctx.db.delete(projectId);
    await ctx.scheduler.runAfter(0, internal.accountLifecycle.cleanupMetadata, { projectId });
    return { deletedFiles: files.length };
  },
});

export const importSource = mutation({
  args: {
    name: v.string(),
    mainFile: v.union(v.string(), v.null()),
    files: v.array(v.object({ path: v.string(), content: v.string() })),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const title = args.name.trim();
    if (!title || title.length > 200)
      throw new Error("Project name must be 1-200 characters");
    const owned = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.subject))
      .collect();
    if (owned.length >= MAX_PROJECTS)
      throw new Error(TOO_MANY_PROJECTS_ERROR);
    const paths = assertSeedFiles(args.files);
    if (
      args.mainFile !== null &&
      (!args.mainFile.endsWith(".tex") || !paths.includes(args.mainFile))
    )
      throw new Error("Select an existing TeX document");
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      name: title,
      ownerId: identity.subject,
      ...(args.mainFile !== null ? { mainFile: args.mainFile } : {}),
      designMode: true,
      updatedAt: now,
    });
    for (const file of args.files) {
      await ctx.db.insert("projectFiles", {
        projectId,
        path: file.path,
        content: file.content,
        version: 1,
        updatedAt: now,
        updatedBy: identity.subject,
      });
    }
    return projectId;
  },
});
