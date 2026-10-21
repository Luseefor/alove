// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
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

let t: TestClient;
let alice: IdentityClient;
let bob: IdentityClient;
let carol: IdentityClient;
let dave: IdentityClient;

beforeEach(() => {
  t = convexTest(schema, modules);
  alice = t.withIdentity({ subject: "alice" });
  bob = t.withIdentity({ subject: "bob" });
  carol = t.withIdentity({ subject: "carol" });
  dave = t.withIdentity({ subject: "dave" });
});

async function blankProject() {
  return await alice.mutation(api.projects.create, { template: "blank" });
}

async function tokenFor(client: IdentityClient, projectId: Id<"projects">, path: string) {
  const files = await client.query(api.files.list, { projectId });
  const row = files.find((f) => f.path === path)!;
  return { version: row.version, incarnation: String(row._id) };
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
  return res;
}

async function blobCount() {
  return await t.run(async (ctx) => (await ctx.db.query("historyContents").collect()).length);
}

describe("source history", () => {
  it("records saves, deletes, and renames with content retrievable", async () => {
    const pid = await blankProject();
    await writeVersioned(alice, pid, "a.tex", "v1");
    await writeVersioned(alice, pid, "a.tex", "v2");
    const tok = await tokenFor(alice, pid, "a.tex");
    await alice.mutation(api.files.renameFile, {
      projectId: pid, oldPath: "a.tex", newPath: "b.tex", expectedVersion: tok.version, expectedIncarnation: tok.incarnation,
    });
    const tok2 = await tokenFor(alice, pid, "b.tex");
    await alice.mutation(api.files.deleteFile, {
      projectId: pid, path: "b.tex", expectedVersion: tok2.version, expectedIncarnation: tok2.incarnation,
    });

    const entries = await alice.query(api.sourceHistory.list, { projectId: pid });
    const ops = entries.filter((e) => e.path === "a.tex" || e.path === "b.tex").map((e) => e.operation);
    expect(ops).toContain("save");
    expect(ops).toContain("rename");
    expect(ops).toContain("delete");
    const renameEntry = entries.find((e) => e.operation === "rename")!;
    expect(renameEntry.previousPath).toBe("a.tex");
    expect(renameEntry.path).toBe("b.tex");

    const fetched = await alice.query(api.sourceHistory.get, { revisionId: entries[0]._id });
    expect(typeof fetched.content).toBe("string");
    for (const entry of entries) {
      expect(entry.bytes).toBeGreaterThan(0);
      expect(entry.incarnation.length).toBeGreaterThan(0);
      expect(entry.authorId).toBe("alice");
    }
  });

  it("lets viewers read history but blocks outsiders", async () => {
    const pid = await blankProject();
    await writeVersioned(alice, pid, "a.tex", "v1");
    const invite = await alice.mutation(api.members.invite, { projectId: pid, userId: "carol", role: "viewer" });
    await carol.mutation(api.members.accept, { invitationId: invite });

    expect((await carol.query(api.sourceHistory.list, { projectId: pid })).length).toBeGreaterThan(0);
    const one = (await carol.query(api.sourceHistory.list, { projectId: pid }))[0];
    expect((await carol.query(api.sourceHistory.get, { revisionId: one._id })).content).toBeDefined();
    await expect(dave.query(api.sourceHistory.list, { projectId: pid })).rejects.toThrow("Forbidden");
    await expect(dave.query(api.sourceHistory.get, { revisionId: one._id })).rejects.toThrow("Forbidden");
  });

  it("restores with CAS, preserves previous bytes, and refuses stale or viewer attempts", async () => {
    const pid = await blankProject();
    await writeVersioned(alice, pid, "a.tex", "v1");
    await writeVersioned(alice, pid, "a.tex", "v2");
    const v2 = await tokenFor(alice, pid, "a.tex");

    const entries = await alice.query(api.sourceHistory.list, { projectId: pid });
    const v1entry = entries.filter((e) => e.path === "a.tex" && e.version === 1).sort((a, b) => b.createdAt - a.createdAt)[0];
    expect((await alice.query(api.sourceHistory.get, { revisionId: v1entry._id })).content).toBe("v1");

    // Stale version and wrong incarnation are refused without mutation.
    await expect(alice.mutation(api.sourceHistory.restore, {
      revisionId: v1entry._id, expectedVersion: 1, expectedIncarnation: v2.incarnation,
    })).rejects.toThrow("File changed");
    await expect(alice.mutation(api.sourceHistory.restore, {
      revisionId: v1entry._id, expectedVersion: v2.version, expectedIncarnation: "deadbeef",
    })).rejects.toThrow("File changed");
    expect((await alice.query(api.files.list, { projectId: pid })).find((f) => f.path === "a.tex")?.content).toBe("v2");

    // Correct CAS restores and bumps the version.
    const done = await alice.mutation(api.sourceHistory.restore, {
      revisionId: v1entry._id, expectedVersion: v2.version, expectedIncarnation: v2.incarnation,
    });
    expect(done.content).toBe("v1");
    expect(done.version).toBe(3);
    expect(done.incarnation).toBe(v2.incarnation);

    // The pre-restore bytes were preserved atomically: head is restore(v3),
    // next is the saved v2 snapshot.
    const after = await alice.query(api.sourceHistory.list, { projectId: pid });
    expect(after[0].operation).toBe("restore");
    expect(after[0].version).toBe(3);
    expect(after[1].operation).toBe("save");
    expect((await alice.query(api.sourceHistory.get, { revisionId: after[1]._id })).content).toBe("v2");

    // Viewers cannot restore.
    const invite = await alice.mutation(api.members.invite, { projectId: pid, userId: "carol", role: "viewer" });
    await carol.mutation(api.members.accept, { invitationId: invite });
    const v3 = await tokenFor(alice, pid, "a.tex");
    await expect(carol.mutation(api.sourceHistory.restore, {
      revisionId: v1entry._id, expectedVersion: v3.version, expectedIncarnation: v3.incarnation,
    })).rejects.toThrow("Forbidden");
  });

  it("restores across delete and recreate with incarnation CAS", async () => {
    const pid = await blankProject();
    await writeVersioned(alice, pid, "a.tex", "v1");
    await writeVersioned(alice, pid, "a.tex", "v2");
    const entries = await alice.query(api.sourceHistory.list, { projectId: pid });
    const v1entry = entries.filter((e) => e.path === "a.tex" && e.version === 1)[0];

    // Delete then recreate: same version number, new incarnation.
    const v2 = await tokenFor(alice, pid, "a.tex");
    await alice.mutation(api.files.deleteFile, {
      projectId: pid, path: "a.tex", expectedVersion: v2.version, expectedIncarnation: v2.incarnation,
    });
    const recreated = await alice.mutation(api.files.save, { projectId: pid, path: "a.tex", content: "fresh" });
    const newToken = (recreated as { incarnation?: string }).incarnation!;
    expect(newToken).not.toBe(v2.incarnation);

    // Stale incarnation is refused even though the version matches.
    await expect(alice.mutation(api.sourceHistory.restore, {
      revisionId: v1entry._id, expectedVersion: 1, expectedIncarnation: v2.incarnation,
    })).rejects.toThrow("File changed");
    // Fresh incarnation applies.
    const done = await alice.mutation(api.sourceHistory.restore, {
      revisionId: v1entry._id, expectedVersion: 1, expectedIncarnation: newToken,
    });
    expect(done.content).toBe("v1");
    expect(done.version).toBe(2);

    // Restore onto a missing file recreates it at version 1.
    const cur = await tokenFor(alice, pid, "a.tex");
    await alice.mutation(api.files.deleteFile, {
      projectId: pid, path: "a.tex", expectedVersion: cur.version, expectedIncarnation: cur.incarnation,
    });
    const revived = await alice.mutation(api.sourceHistory.restore, { revisionId: v1entry._id, expectedVersion: 0 });
    expect(revived.content).toBe("v1");
    expect(revived.version).toBe(1);
    // But claiming version 0 while the file exists is refused.
    await expect(alice.mutation(api.sourceHistory.restore, { revisionId: v1entry._id, expectedVersion: 0 })).rejects.toThrow("File changed");
  });

  it("caps history at 100 entries and drops evicted blobs", async () => {
    const pid = await blankProject();
    // Each update nets one entry: the pre-save snapshot dedupes against the
    // identical post-save record, so 1 create + 100 updates = 101 > 100.
    for (let i = 0; i < 100; i++) {
      await writeVersioned(alice, pid, "a.tex", `content-${i}`);
    }
    const entries = await alice.query(api.sourceHistory.list, { projectId: pid });
    expect(entries.length).toBe(100);
    expect(await blobCount()).toBe(entries.length);
    // Newest work is retained; the oldest creations are gone.
    const contents = new Set<string>();
    for (const e of entries.slice(0, 10)) {
      contents.add((await alice.query(api.sourceHistory.get, { revisionId: e._id })).content);
    }
    expect(contents.has("content-99")).toBe(true);
  });

  it("caps history bytes at 8 MiB and drops evicted blobs", async () => {
    const pid = await blankProject();
    const chunk = "z".repeat(700 * 1024);
    await writeVersioned(alice, pid, "big.tex", `${chunk}0`);
    for (let i = 1; i <= 11; i++) {
      await writeVersioned(alice, pid, "big.tex", `${chunk}${i}`);
    }
    const entries = await alice.query(api.sourceHistory.list, { projectId: pid });
    const bytes = entries.reduce((sum, e) => sum + e.bytes, 0);
    expect(bytes).toBeLessThanOrEqual(8 * 1024 * 1024);
    expect(entries.length).toBeLessThan(24);
    expect(await blobCount()).toBe(entries.length);
  });

  it("records editor-authored revisions under the editor identity", async () => {
    const pid = await blankProject();
    const invite = await alice.mutation(api.members.invite, { projectId: pid, userId: "bob", role: "editor" });
    await bob.mutation(api.members.accept, { invitationId: invite });
    await writeVersioned(bob, pid, "a.tex", "bob-write");
    const entries = await alice.query(api.sourceHistory.list, { projectId: pid });
    expect(entries.filter((e) => e.path === "a.tex").every((e) => e.authorId === "bob")).toBe(true);
  });
});
