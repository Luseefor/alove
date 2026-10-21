// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.*s");

declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}

type TestClient = ReturnType<typeof convexTest>;
type IdentityClient = ReturnType<TestClient["withIdentity"]>;

let t: TestClient;
let alice: IdentityClient;
let bob: IdentityClient;

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

beforeEach(() => {
  t = convexTest(schema, modules);
  alice = t.withIdentity({ subject: "alice" });
  bob = t.withIdentity({ subject: "bob" });
});

async function blankProject() {
  return await alice.mutation(api.projects.create, { template: "blank" });
}

async function snapshotOf(client: IdentityClient, projectId: string) {
  const files = await client.query(api.files.list, { projectId: projectId as never });
  return (files as { path: string; version: number; _id: string }[]).map((f) => ({
    path: f.path,
    version: f.version,
    incarnation: String(f._id),
  }));
}

async function targetOf(client: IdentityClient, projectId: string) {
  const connection = await client.query(api.github.getConnection, { projectId: projectId as never });
  if (!connection) throw new Error("No connection");
  return { owner: connection.owner, repo: connection.repo, branch: connection.branch, baseline: connection.lastCommitSha };
}

describe("github connection authorization", () => {
  it("starts disconnected and only the owner can connect", async () => {
    const pid = await blankProject();
    expect(await alice.query(api.github.getConnection, { projectId: pid })).toBeNull();
    await expect(
      bob.mutation(api.github.connect, { projectId: pid, owner: "octo", repo: "docs", branch: "main" }),
    ).rejects.toThrow("Forbidden");
    const connection = await alice.mutation(api.github.connect, {
      projectId: pid,
      owner: "octo",
      repo: "docs",
      branch: "main",
    });
    expect(connection?.owner).toBe("octo");
    // No silent baseline: a fresh connection authorizes no push.
    expect(connection?.lastCommitSha).toBeUndefined();
    expect(connection?.trackedPaths).toEqual([]);
  });

  it("rejects malformed targets and clears the baseline on retarget", async () => {
    const pid = await blankProject();
    await expect(
      alice.mutation(api.github.connect, { projectId: pid, owner: "not an owner!", repo: "r", branch: "main" }),
    ).rejects.toThrow();
    await expect(
      alice.mutation(api.github.connect, { projectId: pid, owner: "octo", repo: "r", branch: "a..b" }),
    ).rejects.toThrow();
    await alice.mutation(api.github.connect, { projectId: pid, owner: "octo", repo: "docs", branch: "main" });
    // Simulate an established baseline, then retarget.
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("githubConnections").collect();
      const row = rows.find((r) => String(r.projectId) === String(pid));
      if (row) await ctx.db.patch(row._id, { lastCommitSha: HEAD_A, trackedPaths: ["main.tex"] });
    });
    const retargeted = await alice.mutation(api.github.connect, {
      projectId: pid,
      owner: "octo",
      repo: "other",
      branch: "main",
    });
    expect(retargeted?.lastCommitSha).toBeUndefined();
    expect(retargeted?.trackedPaths).toEqual([]);
  });

  it("lets editors read but only owners disconnect", async () => {
    const pid = await blankProject();
    await alice.mutation(api.github.connect, { projectId: pid, owner: "octo", repo: "docs", branch: "main" });
    await expect(
      bob.mutation(api.github.disconnect, { projectId: pid }),
    ).rejects.toThrow("Forbidden");
    await t.run(async (ctx) => {
      await ctx.db.insert("memberships", {
        projectId: pid,
        userId: "bob",
        role: "editor",
        createdAt: Date.now(),
      });
    });
    const seen = await bob.query(api.github.getConnection, { projectId: pid });
    expect(seen?.repo).toBe("docs");
    await expect(
      bob.mutation(api.github.disconnect, { projectId: pid }),
    ).rejects.toThrow("Forbidden");
    await alice.mutation(api.github.disconnect, { projectId: pid });
    expect(await alice.query(api.github.getConnection, { projectId: pid })).toBeNull();
  });
});

describe("github applyPull CAS and atomic history", () => {
  async function connected() {
    const pid = await blankProject();
    await alice.mutation(api.github.connect, { projectId: pid, owner: "octo", repo: "docs", branch: "main" });
    return pid;
  }

  it("applies inserts, updates, and tracked deletes with checkpoints", async () => {
    const pid = await connected();
    // Local-only file must survive the pull; tracked main.tex gets updated.
    await alice.mutation(api.files.save, { projectId: pid, path: "notes.tex", content: "local only" });
    const expected = await snapshotOf(alice, pid);
    const result = await alice.mutation(api.github.applyPull, {
      expectedTarget: await targetOf(alice, pid),
      projectId: pid,
      remoteHead: HEAD_A,
      files: [
        { path: "main.tex", content: "remote main" },
        { path: "chapters/one.tex", content: "new chapter" },
      ],
      deletePaths: ["notes.tex", "gone.tex"],
      expected,
    });
    const byPath = new Map(result.files.map((f) => [f.path, f]));
    expect(byPath.get("main.tex")?.content).toBe("remote main");
    expect(byPath.get("main.tex")?.version).toBe(2);
    expect(byPath.get("chapters/one.tex")?.content).toBe("new chapter");
    // notes.tex was never tracked, so the pull must not delete it.
    expect(byPath.get("notes.tex")?.content).toBe("local only");
    expect(byPath.has("gone.tex")).toBe(false);
    // Baseline established from the applied head.
    const connection = await alice.query(api.github.getConnection, { projectId: pid });
    expect(connection?.lastCommitSha).toBe(HEAD_A);
    expect(connection?.trackedPaths.sort()).toEqual(["chapters/one.tex", "main.tex"]);
    // History checkpointed the overwritten source before replacing it.
    const history = await alice.query(api.sourceHistory.checkpoints, { projectId: pid });
    expect(history[0].files.some((h) => h.path === "main.tex")).toBe(true);
  });

  it("deletes tracked paths that vanished remotely", async () => {
    const pid = await connected();
    const expected = await snapshotOf(alice, pid);
    await alice.mutation(api.github.applyPull, {
      expectedTarget: await targetOf(alice, pid),
      projectId: pid,
      remoteHead: HEAD_A,
      files: [{ path: "main.tex", content: "v2" }],
      deletePaths: [],
      expected,
    });
    const afterFirst = await snapshotOf(alice, pid);
    const result = await alice.mutation(api.github.applyPull, {
      expectedTarget: await targetOf(alice, pid),
      projectId: pid,
      remoteHead: HEAD_B,
      files: [{ path: "other.tex", content: "only" }],
      deletePaths: ["main.tex"],
      expected: afterFirst,
    });
    expect(result.files.map((f) => f.path)).toEqual(["other.tex"]);
    const connection = await alice.query(api.github.getConnection, { projectId: pid });
    expect(connection?.lastCommitSha).toBe(HEAD_B);
  });

  it("rejects a stale snapshot without touching any row", async () => {
    const pid = await connected();
    const expected = await snapshotOf(alice, pid);
    // Local edit after the preview snapshot.
    const rows = await alice.query(api.files.list, { projectId: pid });
    const main = (rows as { path: string; version: number; _id: string; content: string }[]).find(
      (f) => f.path === "main.tex",
    )!;
    await alice.mutation(api.files.save, {
      projectId: pid,
      path: "main.tex",
      content: "local edit",
      expectedVersion: main.version,
      expectedIncarnation: String(main._id),
    });
    await expect(
      alice.mutation(api.github.applyPull, {
      expectedTarget: await targetOf(alice, pid),
        projectId: pid,
        remoteHead: HEAD_A,
        files: [{ path: "main.tex", content: "remote" }],
        deletePaths: [],
        expected,
      }),
    ).rejects.toThrow("changed");
    const after = await alice.query(api.files.list, { projectId: pid });
    expect(
      (after as { path: string; content: string }[]).find((f) => f.path === "main.tex")?.content,
    ).toBe("local edit");
    expect((await alice.query(api.github.getConnection, { projectId: pid }))?.lastCommitSha).toBeUndefined();
  });

  it("denies foreign and viewer pulls", async () => {
    const pid = await connected();
    const expected = await snapshotOf(alice, pid);
    await expect(
      bob.mutation(api.github.applyPull, {
      expectedTarget: await targetOf(alice, pid),
        projectId: pid,
        remoteHead: HEAD_A,
        files: [],
        deletePaths: [],
        expected: [],
      }),
    ).rejects.toThrow("Forbidden");
    await t.run(async (ctx) => {
      await ctx.db.insert("memberships", { projectId: pid, userId: "bob", role: "viewer", createdAt: Date.now() });
    });
    await expect(
      bob.mutation(api.github.applyPull, {
      expectedTarget: await targetOf(alice, pid),
        projectId: pid,
        remoteHead: HEAD_A,
        files: [],
        deletePaths: [],
        expected,
      }),
    ).rejects.toThrow("Forbidden");
  });
});

describe("github push baseline", () => {
  it("records pushes with CAS and reconciles explicitly", async () => {
    const pid = await blankProject();
    await alice.mutation(api.github.connect, { projectId: pid, owner: "octo", repo: "docs", branch: "main" });
    const expected = await snapshotOf(alice, pid);
    await alice.mutation(api.github.applyPull, {
      expectedTarget: await targetOf(alice, pid),
      projectId: pid,
      remoteHead: HEAD_A,
      files: [{ path: "main.tex", content: "synced" }],
      deletePaths: [],
      expected,
    });
    // Concurrent baseline move breaks the acknowledgement CAS.
    await expect(
      alice.mutation(api.github.recordPush, { expectedTarget: await targetOf(alice, pid), projectId: pid, prevSha: HEAD_B, newSha: "c".repeat(40), trackedPaths: ["main.tex"] }),
    ).rejects.toThrow("changed");
    const recorded = await alice.mutation(api.github.recordPush, { expectedTarget: await targetOf(alice, pid),
      projectId: pid,
      prevSha: HEAD_A,
      newSha: HEAD_B,
      trackedPaths: ["main.tex"],
    });
    expect(recorded.recorded).toBe(true);
    // Refresh is a no-op at the head.
    expect(
      await alice.mutation(api.github.refreshBaseline, { expectedTarget: await targetOf(alice, pid),
        projectId: pid,
        remoteHead: HEAD_B,
        remotePaths: ["main.tex"],
        remoteContents: [{ path: "main.tex", content: "synced" }],
      }),
    ).toMatchObject({ refreshed: false });
    // Refresh reconciles a moved head only when content matches exactly.
    await expect(
      alice.mutation(api.github.refreshBaseline, { expectedTarget: await targetOf(alice, pid),
        projectId: pid,
        remoteHead: HEAD_A,
        remotePaths: ["main.tex"],
        remoteContents: [{ path: "main.tex", content: "different" }],
        }),
    ).rejects.toThrow("differ");
    expect(
      await alice.mutation(api.github.refreshBaseline, { expectedTarget: await targetOf(alice, pid),
        projectId: pid,
        remoteHead: HEAD_A,
        remotePaths: ["main.tex"],
        remoteContents: [{ path: "main.tex", content: "synced" }],
      }),
    ).toMatchObject({ refreshed: true, remoteHead: HEAD_A });
  });
});

describe("github connection cleanup", () => {
  it("purges the connection with project metadata", async () => {
    const pid = await blankProject();
    await alice.mutation(api.github.connect, { projectId: pid, owner: "octo", repo: "docs", branch: "main" });
    expect(await alice.query(api.github.getConnection, { projectId: pid })).not.toBeNull();
    const result = await t.mutation(internal.accountLifecycle.cleanupProject, {
      projectId: pid,
      clerkId: "alice",
    });
    expect(result.status).toBe("done");
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("githubConnections").collect();
      expect(rows.filter((r) => String(r.projectId) === String(pid))).toEqual([]);
    });
  });
});
