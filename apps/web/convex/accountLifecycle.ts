import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { utf8ByteLength, MAX_PROJECT_BYTES } from "../src/lib/cloudProjectLimits";

const PRESENCE_CHUNK = 100;
const FILES_PER_RUN = 10;

const CLERK_ID_MAX = 200;

function isUsableClerkId(value: string): boolean {
  return value.length > 0 && value.length <= CLERK_ID_MAX;
}

export async function purgeProjectMetadata(ctx: MutationCtx, projectId: Id<"projects">): Promise<boolean> {
  let more = false;
  for (const table of ["memberships", "invitations", "commentThreads", "commentMessages", "suggestions", "githubConnections"] as const) {
    const rows = await ctx.db.query(table).withIndex("by_project", q => q.eq("projectId", projectId)).take(101);
    more ||= rows.length > 100;
    for (const row of rows.slice(0, 100)) await ctx.db.delete(row._id);
  }
  const checkpoints = await ctx.db.query("projectCheckpoints").withIndex("by_project", q => q.eq("projectId", projectId)).take(1);
  for (const row of checkpoints) { for (const file of row.files) await ctx.db.delete(file.contentId); await ctx.db.delete(row._id); }
  more ||= checkpoints.length > 0;
  const history = await ctx.db.query("sourceHistory").withIndex("by_project", q => q.eq("projectId", projectId)).take(5);
  more ||= history.length > 4;
  for (const row of history.slice(0, 4)) { await ctx.db.delete(row.contentId); await ctx.db.delete(row._id); }
  return more;
}

/** Also runs after explicit project deletion; never requires the parent to survive. */
export const cleanupMetadata = internalMutation({ args: { projectId: v.id("projects") }, handler: async (ctx, { projectId }): Promise<void> => {
  if (await purgeProjectMetadata(ctx, projectId)) await ctx.scheduler.runAfter(0, internal.accountLifecycle.cleanupMetadata, { projectId });
}});

export const cleanupMemberships = internalMutation({ args: { clerkId: v.string() }, handler: async (ctx, { clerkId }): Promise<void> => {
  if (!isUsableClerkId(clerkId)) return;
  let more = false;
  for (const table of ["memberships", "invitations"] as const) {
    const rows = await ctx.db.query(table).withIndex("by_user", q => q.eq(table === "memberships" ? "userId" : "invitedUserId", clerkId)).take(101);
    more ||= rows.length > 100;
    for (const row of rows.slice(0, 100)) await ctx.db.delete(row._id);
  }
  if (more) await ctx.scheduler.runAfter(0, internal.accountLifecycle.cleanupMemberships, { clerkId });
}});

// Internal entry point for the Clerk webhook. It only reads project ids
// here, never file contents, so one user with many projects stays bounded.
export const startUserCleanup = internalMutation({
  args: { clerkId: v.string() },
  handler: async (ctx, { clerkId }): Promise<{ scheduled: number }> => {
    if (!isUsableClerkId(clerkId)) return { scheduled: 0 };
    await ctx.scheduler.runAfter(0, internal.accountLifecycle.cleanupMemberships, { clerkId });
    const owned = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", clerkId))
      .collect();
    for (const project of owned) {
      await ctx.scheduler.runAfter(
        0,
        internal.accountLifecycle.cleanupProject,
        { projectId: project._id, clerkId },
      );
    }
    return { scheduled: owned.length };
  },
});

// Deletes a single project in bounded chunks. Safe to run twice for
// the same project, a second run finds nothing and exits.
export const cleanupProject = internalMutation({
  args: { projectId: v.id("projects"), clerkId: v.string() },
  handler: async (ctx, { projectId, clerkId }): Promise<{ status: "skipped" | "gone" | "partial" | "done" }> => {
    if (!isUsableClerkId(clerkId)) return { status: "skipped" as const };
    const project = await ctx.db.get(projectId);
    if (project === null) return { status: "gone" as const };
    if (project.ownerId !== clerkId) return { status: "skipped" as const };

    const fileBatch = await ctx.db
      .query("projectFiles")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .take(FILES_PER_RUN + 1);
    const hasMoreFilesBeyondBatch = fileBatch.length > FILES_PER_RUN;
    const candidates = fileBatch.slice(0, FILES_PER_RUN);

    let cutoff = candidates.length;
    let bytes = 0;
    for (let i = 0; i < candidates.length; i++) {
      bytes += utf8ByteLength(candidates[i].content);
      if (bytes > MAX_PROJECT_BYTES) {
        cutoff = i === 0 ? 1 : i;
        break;
      }
    }
    const filesRemain =
      hasMoreFilesBeyondBatch || cutoff < candidates.length;
    const filesToDelete = candidates.slice(0, cutoff);

    const presenceBatch = await ctx.db
      .query("presence")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .take(PRESENCE_CHUNK + 1);
    const presenceRemain = presenceBatch.length > PRESENCE_CHUNK;
    const presenceToDelete = presenceBatch.slice(0, PRESENCE_CHUNK);

    for (const file of filesToDelete) {
      await ctx.db.delete(file._id);
    }
    for (const row of presenceToDelete) {
      await ctx.db.delete(row._id);
    }

    const metadataRemain = await purgeProjectMetadata(ctx, projectId);
    if (filesRemain || presenceRemain || metadataRemain) {
      await ctx.scheduler.runAfter(
        0,
        internal.accountLifecycle.cleanupProject,
        { projectId, clerkId },
      );
      return { status: "partial" as const };
    }

    await ctx.db.delete(projectId);
    return { status: "done" as const };
  },
});
