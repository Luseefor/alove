import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireProject } from "./projectAccess";
import { recordSource } from "./sourceHistory";
import { captureAnchor, resolveAnchor } from "../src/lib/sourceAnchors";
import {
  checkFileSize,
  MAX_PROJECT_BYTES,
  utf8ByteLength,
} from "../src/lib/cloudProjectLimits";

const anchorArgs = {
  projectId: v.id("projects"),
  path: v.string(),
  from: v.number(),
  to: v.number(),
  expectedVersion: v.number(),
  expectedIncarnation: v.string(),
};
function body(value: string) {
  if (!value.trim() || value.length > 8000)
    throw new Error("Enter between 1 and 8,000 characters.");
  return value.trim();
}
async function fileAt(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  path: string,
  version: number,
  incarnation: string,
) {
  const file = await ctx.db
    .query("projectFiles")
    .withIndex("by_project_path", (q) =>
      q.eq("projectId", projectId).eq("path", path),
    )
    .unique();
  if (
    !file ||
    file.version !== version ||
    String(file._id) !== incarnation ||
    file.content.startsWith("data:")
  )
    throw new Error("Source changed. Refresh the selection before continuing.");
  return file;
}
export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    await requireProject(ctx, projectId);
    const threads = await ctx.db
      .query("commentThreads")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .order("desc")
      .take(100);
    const messages = await ctx.db
      .query("commentMessages")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .take(1000);
    const suggestions = await ctx.db
      .query("suggestions")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .order("desc")
      .take(100);
    return {
      threads: threads.map((thread) => ({
        ...thread,
        messages: messages.filter((m) => m.threadId === thread._id),
      })),
      suggestions,
    };
  },
});
export const comment = mutation({
  args: { ...anchorArgs, body: v.string() },
  handler: async (ctx, args) => {
    const { identity } = await requireProject(ctx, args.projectId, "edit");
    const file = await fileAt(
      ctx,
      args.projectId,
      args.path,
      args.expectedVersion,
      args.expectedIncarnation,
    );
    const anchor = captureAnchor(file.content, args.from, args.to);
    const count = await ctx.db
      .query("commentThreads")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(100);
    if (count.length >= 100)
      throw new Error("Project comment limit reached (100 threads).");
    const now = Date.now();
    const { original, ...range } = anchor;
    const threadId = await ctx.db.insert("commentThreads", {
      ...range,
      quote: original,
      projectId: args.projectId,
      path: args.path,
      authorId: identity.subject,
      authorName: (identity.name ?? identity.email ?? "Collaborator").slice(
        0,
        254,
      ),
      resolved: false,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("commentMessages", {
      projectId: args.projectId,
      threadId,
      authorId: identity.subject,
      authorName: (identity.name ?? identity.email ?? "Collaborator").slice(
        0,
        254,
      ),
      body: body(args.body),
      createdAt: now,
    });
    return threadId;
  },
});
export const reply = mutation({
  args: { threadId: v.id("commentThreads"), body: v.string() },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread unavailable.");
    const { identity } = await requireProject(ctx, thread.projectId, "edit");
    const messages = await ctx.db
      .query("commentMessages")
      .withIndex("by_project", (q) => q.eq("projectId", thread.projectId))
      .take(1000);
    if (messages.length >= 1000)
      throw new Error("Project reply limit reached.");
    await ctx.db.insert("commentMessages", {
      projectId: thread.projectId,
      threadId: thread._id,
      authorId: identity.subject,
      authorName: (identity.name ?? identity.email ?? "Collaborator").slice(
        0,
        254,
      ),
      body: body(args.body),
      createdAt: Date.now(),
    });
    await ctx.db.patch(thread._id, { updatedAt: Date.now() });
  },
});
export const resolve = mutation({
  args: { threadId: v.id("commentThreads"), resolved: v.boolean() },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) throw new Error("Thread unavailable.");
    await requireProject(ctx, thread.projectId, "edit");
    await ctx.db.patch(thread._id, {
      resolved: args.resolved,
      updatedAt: Date.now(),
    });
  },
});
export const suggest = mutation({
  args: { ...anchorArgs, replacement: v.string() },
  handler: async (ctx, args) => {
    const { identity } = await requireProject(ctx, args.projectId, "edit");
    const file = await fileAt(
      ctx,
      args.projectId,
      args.path,
      args.expectedVersion,
      args.expectedIncarnation,
    );
    const anchor = captureAnchor(file.content, args.from, args.to);
    if (
      args.replacement.length > 16_000 ||
      args.replacement === anchor.original
    )
      throw new Error(
        "Enter a changed replacement of at most 16,000 characters.",
      );
    const count = await ctx.db
      .query("suggestions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(100);
    if (count.length >= 100)
      throw new Error("Project suggestion limit reached (100).");
    return ctx.db.insert("suggestions", {
      ...anchor,
      replacement: args.replacement,
      projectId: args.projectId,
      path: args.path,
      authorId: identity.subject,
      authorName: (identity.name ?? identity.email ?? "Collaborator").slice(
        0,
        254,
      ),
      status: "pending",
      createdAt: Date.now(),
    });
  },
});
export const decide = mutation({
  args: {
    suggestionId: v.id("suggestions"),
    accept: v.boolean(),
    expectedVersion: v.optional(v.number()),
    expectedIncarnation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const suggestion = await ctx.db.get(args.suggestionId);
    if (!suggestion || suggestion.status !== "pending")
      throw new Error("Suggestion is no longer pending.");
    const { identity } = await requireProject(
      ctx,
      suggestion.projectId,
      "edit",
    );
    if (args.accept) {
      const file = await fileAt(
        ctx,
        suggestion.projectId,
        suggestion.path,
        args.expectedVersion ?? -1,
        args.expectedIncarnation ?? "",
      );
      const range = resolveAnchor(file.content, suggestion);
      if (!range)
        throw new Error(
          "The original passage changed or is ambiguous. Review and create a new suggestion.",
        );
      const content =
        file.content.slice(0, range.from) +
        suggestion.replacement +
        file.content.slice(range.to);
      const size = checkFileSize(file.path, content);
      if (size) throw new Error(size);
      const files = await ctx.db
        .query("projectFiles")
        .withIndex("by_project", (q) => q.eq("projectId", suggestion.projectId))
        .collect();
      if (
        files.reduce(
          (sum, row) =>
            sum + utf8ByteLength(row._id === file._id ? content : row.content),
          0,
        ) > MAX_PROJECT_BYTES
      )
        throw new Error("Project too large.");
      await recordSource(ctx, {
        projectId: file.projectId,
        path: file.path,
        content: file.content,
        version: file.version,
        incarnation: String(file._id),
        authorId: file.updatedBy,
        operation: "save",
      });
      await ctx.db.patch(file._id, {
        content,
        version: file.version + 1,
        updatedAt: Date.now(),
        updatedBy: identity.subject,
      });
      await recordSource(ctx, {
        projectId: file.projectId,
        path: file.path,
        content,
        version: file.version + 1,
        incarnation: String(file._id),
        authorId: identity.subject,
        operation: "save",
      });
      await ctx.db.patch(file.projectId, { updatedAt: Date.now() });
    }
    await ctx.db.patch(suggestion._id, {
      status: args.accept ? "accepted" : "rejected",
      resolvedBy: identity.subject,
      resolvedAt: Date.now(),
    });
  },
});
