import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  projects: defineTable({
    name: v.string(),
    mainFile: v.optional(v.string()),
    ownerId: v.string(),
    /** When true, collaborators may edit files (still owner-scoped in MVP). */
    designMode: v.boolean(),
    updatedAt: v.number(),
  }).index("by_owner", ["ownerId"]),
  projectFiles: defineTable({
    projectId: v.id("projects"),
    path: v.string(),
    content: v.string(),
    version: v.number(),
    updatedAt: v.number(),
    updatedBy: v.string(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_path", ["projectId", "path"]),
  memberships: defineTable({
    projectId: v.id("projects"), userId: v.string(), displayName: v.optional(v.string()), role: v.union(v.literal("editor"), v.literal("viewer")), createdAt: v.number(),
  }).index("by_project", ["projectId"]).index("by_project_user", ["projectId", "userId"]).index("by_user", ["userId"]),
  invitations: defineTable({
    projectId: v.id("projects"), invitedUserId: v.string(), displayName: v.optional(v.string()), role: v.union(v.literal("editor"), v.literal("viewer")), invitedBy: v.string(), createdAt: v.number(), expiresAt: v.number(),
  }).index("by_project", ["projectId"]).index("by_user", ["invitedUserId"]),
  historyContents: defineTable({ content: v.string() }),
  projectCheckpoints: defineTable({
    projectId: v.id("projects"), title: v.string(), mainFile: v.optional(v.string()), authorId: v.string(), createdAt: v.number(), bytes: v.number(),
    files: v.array(v.object({ path: v.string(), contentId: v.id("historyContents"), version: v.number(), incarnation: v.string() })),
  }).index("by_project", ["projectId"]),
  sourceHistory: defineTable({
    projectId: v.id("projects"), path: v.string(), contentId: v.id("historyContents"), bytes: v.number(),
    operation: v.union(v.literal("save"), v.literal("delete"), v.literal("rename"), v.literal("restore")),
    version: v.number(), incarnation: v.string(), authorId: v.string(), createdAt: v.number(), previousPath: v.optional(v.string()),
  }).index("by_project", ["projectId"]),
  commentThreads: defineTable({
    projectId: v.id("projects"), path: v.string(), from: v.number(), to: v.number(), quote: v.string(), before: v.string(), after: v.string(),
    authorId: v.string(), authorName: v.optional(v.string()), resolved: v.boolean(), createdAt: v.number(), updatedAt: v.number(),
  }).index("by_project", ["projectId"]),
  commentMessages: defineTable({
    projectId: v.id("projects"), threadId: v.id("commentThreads"), authorId: v.string(), authorName: v.optional(v.string()), body: v.string(), createdAt: v.number(),
  }).index("by_project", ["projectId"]).index("by_thread", ["threadId"]),
  suggestions: defineTable({
    projectId: v.id("projects"), path: v.string(), from: v.number(), to: v.number(), original: v.string(), replacement: v.string(), before: v.string(), after: v.string(),
    authorId: v.string(), authorName: v.optional(v.string()), status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("rejected")), createdAt: v.number(), resolvedBy: v.optional(v.string()), resolvedAt: v.optional(v.number()),
  }).index("by_project", ["projectId"]),
  presence: defineTable({
    projectId: v.id("projects"),
    userId: v.string(),
    name: v.string(),
    color: v.string(),
    cursorLine: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_project_user", ["projectId", "userId"]),
  githubConnections: defineTable({
    projectId: v.id("projects"),
    owner: v.string(),
    repo: v.string(),
    branch: v.string(),
    /** Remote head at the last applied pull / recorded push. Absent until
     *  the first pull is applied, so connect alone never authorizes a push. */
    lastCommitSha: v.optional(v.string()),
    /** Repo paths managed by sync at the last baseline. */
    trackedPaths: v.array(v.string()),
    updatedBy: v.string(),
    updatedAt: v.number(),
  }).index("by_project", ["projectId"]),
});
