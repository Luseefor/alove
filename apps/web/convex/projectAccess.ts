import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

export type ProjectRole = "owner" | "editor" | "viewer";
export async function projectAccess(
  ctx: Pick<QueryCtx, "db" | "auth">,
  projectId: Id<"projects">,
) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const project = await ctx.db.get(projectId);
  if (!project) return null;
  if (project.ownerId === identity.subject)
    return { project, identity, role: "owner" as const };
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_project_user", (q) =>
      q.eq("projectId", projectId).eq("userId", identity.subject),
    )
    .unique();
  return membership ? { project, identity, role: membership.role } : null;
}
export async function requireProject(
  ctx: Pick<QueryCtx, "db" | "auth">,
  projectId: Id<"projects">,
  permission: "read" | "edit" | "owner" = "read",
) {
  const access = await projectAccess(ctx, projectId);
  if (
    !access ||
    (permission === "owner" && access.role !== "owner") ||
    (permission === "edit" && access.role === "viewer")
  )
    throw new Error("Forbidden");
  return access;
}
