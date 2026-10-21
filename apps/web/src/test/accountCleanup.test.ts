// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { convexTest } from "convex-test";
import { Webhook } from "svix";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.*s");

declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}

type TestClient = ReturnType<typeof convexTest>;
type IdentityClient = ReturnType<TestClient["withIdentity"]>;

const TEST_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const USER_A = "user_acct_owner";
const USER_B = "user_acct_collab";
const USER_C = "user_acct_invited";
let msgCounter = 0;

let t: TestClient;

beforeEach(() => {
  t = convexTest(schema, modules);
  vi.stubEnv("CLERK_WEBHOOK_SECRET", TEST_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function clientFor(subject: string): IdentityClient {
  return t.withIdentity({ subject });
}

async function drainScheduler() {
  vi.useFakeTimers();
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
}

function signedHeaders(raw: string, opts?: { msgId?: string; when?: Date; secret?: string }) {
  const secret = opts?.secret ?? TEST_SECRET;
  const wh = new Webhook(secret);
  const msgId = opts?.msgId ?? `msg_${Date.now()}_${msgCounter++}`;
  const when = opts?.when ?? new Date();
  return {
    "svix-id": msgId,
    "svix-timestamp": Math.floor(when.getTime() / 1000).toString(),
    "svix-signature": wh.sign(msgId, when, raw),
  };
}

/** Counts rows per table across the whole test database. */
async function countAll() {
  return await t.run(async (ctx) => {
    const out: Record<string, number> = {};
    for (const table of [
      "projects",
      "projectFiles",
      "memberships",
      "invitations",
      "commentThreads",
      "commentMessages",
      "suggestions",
      "sourceHistory",
      "historyContents",
      "presence",
    ] as const) {
      out[table] = (await ctx.db.query(table).collect()).length;
    }
    return out;
  });
}

async function writeVersioned(client: IdentityClient, projectId: Id<"projects">, path: string, content: string) {
  const current = await client.query(api.files.list, { projectId });
  const row = current.find((f) => f.path === path);
  const res = await client.mutation(api.files.save, {
    projectId,
    path,
    content,
    ...(row ? { expectedVersion: row.version, expectedIncarnation: String(row._id) } : {}),
  });
  if ((res as { conflict?: boolean }).conflict) throw new Error("setup write conflicted");
}

describe("deletion and account cleanup", () => {
  it("cleans an over-batch project in bounded runs", async () => {
    const alice = clientFor(USER_A);
    const pid = await alice.mutation(api.projects.create, { template: "blank" });
    // 12 files forces a partial first run (10 files per bounded job).
    for (let i = 0; i < 12; i++) {
      await alice.mutation(api.files.save, { projectId: pid, path: `f${i}.tex`, content: `file ${i}` });
    }
    await alice.mutation(api.presence.heartbeat, { projectId: pid, name: "A", color: "red" });

    const first = await t.mutation(internal.accountLifecycle.cleanupProject, { projectId: pid, clerkId: USER_A });
    expect(first.status).toBe("partial");
    await drainScheduler();

    expect(await countAll()).toEqual({
      projects: 0,
      projectFiles: 0,
      memberships: 0,
      invitations: 0,
      commentThreads: 0,
      commentMessages: 0,
      suggestions: 0,
      sourceHistory: 0,
      historyContents: 0,
      presence: 0,
    });
  });

  it("purges collaboration rows and blobs after explicit project deletion", async () => {
    const alice = clientFor(USER_A);
    const bob = clientFor(USER_B);
    const pid = await alice.mutation(api.projects.create, { template: "blank" });

    // Member, pending invitation, review rows, presence, history.
    const inviteBob = await alice.mutation(api.members.invite, { projectId: pid, userId: USER_B, role: "editor" });
    await bob.mutation(api.members.accept, { invitationId: inviteBob });
    await alice.mutation(api.members.invite, { projectId: pid, userId: USER_C, role: "viewer" });
    await writeVersioned(alice, pid, "a.tex", "alpha beta gamma");
    const tok = await alice.query(api.files.list, { projectId: pid }).then((rows) => {
      const row = rows.find((f) => f.path === "a.tex")!;
      return { version: row.version, incarnation: String(row._id) };
    });
    const threadId = await bob.mutation(api.reviews.comment, {
      projectId: pid, path: "a.tex", from: 6, to: 10,
      expectedVersion: tok.version, expectedIncarnation: tok.incarnation, body: "note",
    });
    await bob.mutation(api.reviews.reply, { threadId, body: "reply" });
    await bob.mutation(api.reviews.suggest, {
      projectId: pid, path: "a.tex", from: 0, to: 5,
      expectedVersion: tok.version, expectedIncarnation: tok.incarnation, replacement: "ALPHA",
    });
    await bob.mutation(api.presence.heartbeat, { projectId: pid, name: "B", color: "blue" });

    // Over-100 batches to exercise bounded purge rescheduling.
    await t.run(async (ctx) => {
      for (let i = 0; i < 105; i++) {
        const thread = await ctx.db.insert("commentThreads", {
          projectId: pid, path: "bulk.tex", from: i, to: i + 1, quote: `q${i}`,
          before: "b", after: "a", authorId: USER_A, resolved: false, createdAt: Date.now(), updatedAt: Date.now(),
        });
        await ctx.db.insert("commentMessages", {
          projectId: pid, threadId: thread, authorId: USER_A, body: `m${i}`, createdAt: Date.now(),
        });
        await ctx.db.insert("suggestions", {
          projectId: pid, path: "bulk.tex", from: i, to: i + 1, original: `o${i}`, replacement: `r${i}`,
          before: "b", after: "a", authorId: USER_A, status: "pending", createdAt: Date.now(),
        });
      }
    });
    const before = await countAll();
    expect(before.commentThreads).toBeGreaterThan(100);
    expect(before.projectFiles).toBeGreaterThan(0);

    const res = await alice.mutation(api.projects.remove, { projectId: pid });
    expect(res.deletedFiles).toBe(before.projectFiles);
    // Files and presence drop synchronously.
    expect(await alice.query(api.files.list, { projectId: pid })).toEqual([]);
    expect(await alice.query(api.presence.list, { projectId: pid })).toEqual([]);
    await drainScheduler();

    expect(await countAll()).toEqual({
      projects: 0,
      projectFiles: 0,
      memberships: 0,
      invitations: 0,
      commentThreads: 0,
      commentMessages: 0,
      suggestions: 0,
      sourceHistory: 0,
      historyContents: 0,
      presence: 0,
    });
  });

  it("removes owned data and cross-project traces on account deletion, leaving others alone", async () => {
    const alice = clientFor(USER_A);
    const bob = clientFor(USER_B);
    const owned = await alice.mutation(api.projects.create, { template: "blank" });
    await writeVersioned(alice, owned, "a.tex", "owned content");
    const inviteBob = await alice.mutation(api.members.invite, { projectId: owned, userId: USER_B, role: "editor" });
    await bob.mutation(api.members.accept, { invitationId: inviteBob });
    await alice.mutation(api.members.invite, { projectId: owned, userId: USER_C, role: "viewer" });
    const tok = await alice.query(api.files.list, { projectId: owned }).then((rows) => {
      const row = rows.find((f) => f.path === "a.tex")!;
      return { version: row.version, incarnation: String(row._id) };
    });
    const threadId = await bob.mutation(api.reviews.comment, {
      projectId: owned, path: "a.tex", from: 0, to: 5,
      expectedVersion: tok.version, expectedIncarnation: tok.incarnation, body: "thread",
    });
    await bob.mutation(api.reviews.reply, { threadId, body: "msg" });
    await bob.mutation(api.reviews.suggest, {
      projectId: owned, path: "a.tex", from: 0, to: 5,
      expectedVersion: tok.version, expectedIncarnation: tok.incarnation, replacement: "OWNED",
    });
    await bob.mutation(api.presence.heartbeat, { projectId: owned, name: "B", color: "blue" });

    // Alice also edits Bob's project and holds a pending invite there.
    const bobs = await bob.mutation(api.projects.create, { template: "blank" });
    const inviteAlice = await bob.mutation(api.members.invite, { projectId: bobs, userId: USER_A, role: "editor" });
    await alice.mutation(api.members.accept, { invitationId: inviteAlice });
    const inviteCarol = await bob.mutation(api.members.invite, { projectId: bobs, userId: USER_C, role: "viewer" });
    void inviteCarol;
    // A second, still-pending invitation addressed to Alice herself.
    const pendingToAlice = await bob.mutation(api.members.invite, { projectId: bobs, userId: USER_A, role: "viewer" });
    void pendingToAlice;
    await writeVersioned(bob, bobs, "b.tex", "bob content");

    // Snapshot Alice's blob ids so resurrection can be detected.
    const aliceBlobs: string[] = await t.run(async (ctx) => {
      const rows = await ctx.db.query("sourceHistory").collect();
      return rows.filter((r) => String(r.projectId) === String(owned)).map((r) => String(r.contentId));
    });
    expect(aliceBlobs.length).toBeGreaterThan(0);

    const raw = JSON.stringify({ type: "user.deleted", data: { id: USER_A } });
    const res = await t.fetch("/clerk-users-webhook", {
      method: "POST",
      headers: { "content-type": "application/json", ...signedHeaders(raw) },
      body: raw,
    });
    expect(res.status).toBe(200);
    await drainScheduler();

    // Owned project fully gone, blobs unresolvable.
    expect(await bob.query(api.projects.get, { projectId: owned })).toBeNull();
    await t.run(async (ctx) => {
      for (const id of aliceBlobs) {
        expect(await ctx.db.get(id as Id<"historyContents">)).toBeNull();
      }
      const remaining = await ctx.db.query("sourceHistory").collect();
      expect(remaining.filter((r) => String(r.projectId) === String(owned))).toEqual([]);
    });
    // Cross-project traces of Alice removed; Bob's world intact.
    const bobsRoster = await bob.query(api.members.list, { projectId: bobs });
    expect(bobsRoster.members).toEqual([]);
    expect(bobsRoster.invitations.map((i) => i.invitedUserId)).toEqual([USER_C]);
    expect((await clientFor(USER_A).query(api.projects.listMine, {})).length).toBe(0);
    expect((await bob.query(api.projects.listMine, {})).map((p) => String(p._id))).toContain(String(bobs));
    expect((await bob.query(api.files.list, { projectId: bobs })).map((f) => f.path)).toContain("b.tex");
    // Bob's own history still resolves (no cross-project blob damage).
    const bobHistory = await bob.query(api.sourceHistory.list, { projectId: bobs });
    expect(bobHistory.length).toBeGreaterThan(0);
    expect((await bob.query(api.sourceHistory.get, { revisionId: bobHistory[0]._id })).content).toBeDefined();
  });
});
