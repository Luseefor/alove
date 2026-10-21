import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireProject } from "./projectAccess";
const role = v.union(v.literal("editor"), v.literal("viewer"));

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const access = await requireProject(ctx, projectId);
    const members = await ctx.db
      .query("memberships")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .take(100);
    const invitations =
      access.role === "owner"
        ? await ctx.db
            .query("invitations")
            .withIndex("by_project", (q) => q.eq("projectId", projectId))
            .take(100)
        : [];
    return {
      ownerId: access.project.ownerId,
      role: access.role,
      members,
      invitations,
    };
  },
});
export const invite = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.string(),
    displayName: v.optional(v.string()),
    role,
  },
  handler: async (ctx, args) => {
    const access = await requireProject(ctx, args.projectId, "owner");
    const userId = args.userId.trim();
    const displayName = args.displayName?.trim().slice(0, 254);
    if (!userId || userId.length > 200 || userId === access.project.ownerId)
      throw new Error("Choose a different account.");
    const members = await ctx.db
      .query("memberships")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(100);
    const invitations = await ctx.db
      .query("invitations")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(100);
    if (members.length + invitations.length >= 100)
      throw new Error("Project participant limit reached.");
    const existing = invitations.find((row) => row.invitedUserId === userId);
    if (existing) {
      await ctx.db.patch(existing._id, {
        role: args.role,
        expiresAt: Date.now() + 7 * 86400000,
      });
      return existing._id;
    }
    return ctx.db.insert("invitations", {
      projectId: args.projectId,
      invitedUserId: userId,
      displayName,
      role: args.role,
      invitedBy: access.identity.subject,
      createdAt: Date.now(),
      expiresAt: Date.now() + 7 * 86400000,
    });
  },
});
export const pending = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("invitations")
      .withIndex("by_user", (q) => q.eq("invitedUserId", identity.subject))
      .take(100);
    const result = [];
    for (const row of rows) {
      const project = await ctx.db.get(row.projectId);
      if (project && row.expiresAt > Date.now())
        result.push({ ...row, projectName: project.name });
    }
    return result;
  },
});
export const accept = mutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, { invitationId }) => {
    const identity = await ctx.auth.getUserIdentity();
    const invitation = await ctx.db.get(invitationId);
    if (
      !identity ||
      !invitation ||
      invitation.invitedUserId !== identity.subject ||
      invitation.expiresAt <= Date.now() ||
      !(await ctx.db.get(invitation.projectId))
    )
      throw new Error("Invitation unavailable.");
    const member = await ctx.db
      .query("memberships")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", invitation.projectId).eq("userId", identity.subject),
      )
      .unique();
    if (member) await ctx.db.patch(member._id, { role: invitation.role });
    else
      await ctx.db.insert("memberships", {
        projectId: invitation.projectId,
        userId: identity.subject,
        displayName: (
          identity.name ??
          identity.email ??
          invitation.displayName
        )?.slice(0, 254),
        role: invitation.role,
        createdAt: Date.now(),
      });
    await ctx.db.delete(invitationId);
    return invitation.projectId;
  },
});
export const setRole = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.string(),
    role: v.union(role, v.null()),
  },
  handler: async (ctx, args) => {
    await requireProject(ctx, args.projectId, "owner");
    const member = await ctx.db
      .query("memberships")
      .withIndex("by_project_user", (q) =>
        q.eq("projectId", args.projectId).eq("userId", args.userId),
      )
      .unique();
    if (!member) throw new Error("Member not found.");
    if (args.role === null) {
      await ctx.db.delete(member._id);
      const presence = await ctx.db
        .query("presence")
        .withIndex("by_project_user", (q) =>
          q.eq("projectId", args.projectId).eq("userId", args.userId),
        )
        .unique();
      if (presence) await ctx.db.delete(presence._id);
    } else await ctx.db.patch(member._id, { role: args.role });
  },
});
export const revokeInvite = mutation({
  args: { invitationId: v.id("invitations") },
  handler: async (ctx, { invitationId }) => {
    const row = await ctx.db.get(invitationId);
    if (!row) return;
    await requireProject(ctx, row.projectId, "owner");
    await ctx.db.delete(row._id);
  },
});
