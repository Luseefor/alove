import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  projects: defineTable({
    name: v.string(),
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
});
