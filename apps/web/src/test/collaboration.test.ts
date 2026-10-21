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

/** Owner invites + target accepts. */
async function shareAs(projectId: Id<"projects">, target: IdentityClient, subject: string, role: "editor" | "viewer") {
  const invitation = await alice.mutation(api.members.invite, { projectId, userId: subject, role });
  await target.mutation(api.members.accept, { invitationId: invitation });
}

describe("collaboration roles", () => {
  it("enforces owner/editor/viewer/outsider on file mutations", async () => {
    const pid = await blankProject();
    await shareAs(pid, bob, "bob", "editor");
    await shareAs(pid, carol, "carol", "viewer");

    // Editor creates, updates, renames, deletes.
    const created = await bob.mutation(api.files.save, { projectId: pid, path: "shared.tex", content: "v1" });
    expect(created.conflict).toBe(false);
    const token = (created as { incarnation?: string }).incarnation!;
    const updated = await bob.mutation(api.files.save, {
      projectId: pid, path: "shared.tex", content: "v2", expectedVersion: 1, expectedIncarnation: token,
    });
    expect(updated.conflict).toBe(false);
    const renamed = await bob.mutation(api.files.renameFile, {
      projectId: pid, oldPath: "shared.tex", newPath: "moved.tex", expectedVersion: 2, expectedIncarnation: token,
    });
    expect((renamed as { conflict?: boolean }).conflict).not.toBe(true);
    const removed = await bob.mutation(api.files.deleteFile, {
      projectId: pid, path: "moved.tex", expectedVersion: 2,
      expectedIncarnation: (renamed as { incarnation?: string }).incarnation ?? token,
    });
    expect((removed as { conflict?: boolean }).conflict).not.toBe(true);

    // Viewer reads but every mutation is forbidden.
    expect((await carol.query(api.files.list, { projectId: pid })).length).toBeGreaterThan(0);
    await expect(carol.mutation(api.files.save, { projectId: pid, path: "nope.tex", content: "x" })).rejects.toThrow("Forbidden");
    const main = await tokenFor(carol, pid, "main.tex");
    await expect(carol.mutation(api.files.save, {
      projectId: pid, path: "main.tex", content: "x", expectedVersion: main.version, expectedIncarnation: main.incarnation,
    })).rejects.toThrow("Forbidden");
    await expect(carol.mutation(api.files.deleteFile, {
      projectId: pid, path: "main.tex", expectedVersion: main.version, expectedIncarnation: main.incarnation,
    })).rejects.toThrow("Forbidden");
    await expect(carol.mutation(api.files.renameFile, {
      projectId: pid, oldPath: "main.tex", newPath: "z.tex", expectedVersion: main.version, expectedIncarnation: main.incarnation,
    })).rejects.toThrow("Forbidden");

    // Outsider sees nothing and mutates nothing.
    expect(await dave.query(api.files.list, { projectId: pid })).toEqual([]);
    await expect(dave.mutation(api.files.save, { projectId: pid, path: "x.tex", content: "x" })).rejects.toThrow("Forbidden");
  });

  it("enforces the matrix on project metadata", async () => {
    const pid = await blankProject();
    await shareAs(pid, bob, "bob", "editor");
    await shareAs(pid, carol, "carol", "viewer");

    await bob.mutation(api.projects.rename, { projectId: pid, name: "Edited Title" });
    expect((await alice.query(api.projects.get, { projectId: pid }))?.name).toBe("Edited Title");
    await bob.mutation(api.projects.setMainFile, { projectId: pid, path: "main.tex" });
    await expect(carol.mutation(api.projects.rename, { projectId: pid, name: "Nope" })).rejects.toThrow("Forbidden");
    await expect(carol.mutation(api.projects.setMainFile, { projectId: pid, path: "main.tex" })).rejects.toThrow("Forbidden");
    await expect(dave.mutation(api.projects.rename, { projectId: pid, name: "Nope" })).rejects.toThrow("Forbidden");
    await expect(dave.mutation(api.projects.remove, { projectId: pid })).rejects.toThrow("Forbidden");

    // Design mode stays owner-scoped even for editors.
    await expect(bob.mutation(api.projects.setDesignMode, { projectId: pid, designMode: false })).rejects.toThrow("Forbidden");
    await alice.mutation(api.projects.setDesignMode, { projectId: pid, designMode: false });
  });

  it("shares listMine with roles and hides outsiders", async () => {
    const pid = await blankProject();
    await shareAs(pid, bob, "bob", "editor");
    await shareAs(pid, carol, "carol", "viewer");

    const mine = await alice.query(api.projects.listMine, {});
    expect(mine.find((p) => String(p._id) === String(pid))?.role).toBe("owner");
    const bobList = await bob.query(api.projects.listMine, {});
    expect(bobList.find((p) => String(p._id) === String(pid))?.role).toBe("editor");
    const carolList = await carol.query(api.projects.listMine, {});
    expect(carolList.find((p) => String(p._id) === String(pid))?.role).toBe("viewer");
    expect(await dave.query(api.projects.listMine, {})).toEqual([]);
    expect((await bob.query(api.projects.get, { projectId: pid }))?.role).toBe("editor");
    expect(await dave.query(api.projects.get, { projectId: pid })).toBeNull();
  });

  it("scopes member roster and invitations to owners", async () => {
    const pid = await blankProject();
    await shareAs(pid, bob, "bob", "editor");
    await shareAs(pid, carol, "carol", "viewer");
    // One outstanding invitation for dave.
    await alice.mutation(api.members.invite, { projectId: pid, userId: "dave", role: "viewer" });

    const ownerList = await alice.query(api.members.list, { projectId: pid });
    expect(ownerList.members.map((m) => m.userId).sort()).toEqual(["bob", "carol"]);
    expect(ownerList.invitations).toHaveLength(1);

    const editorList = await bob.query(api.members.list, { projectId: pid });
    expect(editorList.members.length).toBe(2);
    expect(editorList.invitations).toEqual([]);
    await expect(dave.query(api.members.list, { projectId: pid })).rejects.toThrow("Forbidden");
  });

  it("restricts inviting to owners", async () => {
    const pid = await blankProject();
    await shareAs(pid, bob, "bob", "editor");
    await expect(bob.mutation(api.members.invite, { projectId: pid, userId: "carol", role: "viewer" })).rejects.toThrow("Forbidden");
    await expect(carol.mutation(api.members.invite, { projectId: pid, userId: "dave", role: "viewer" })).rejects.toThrow("Forbidden");
    await expect(dave.mutation(api.members.invite, { projectId: pid, userId: "carol", role: "viewer" })).rejects.toThrow("Forbidden");
    await expect(alice.mutation(api.members.invite, { projectId: pid, userId: "alice", role: "viewer" })).rejects.toThrow();
  });

  it("matches invitations to the target, honours expiry/revoke, and rejects replays", async () => {
    const pid = await blankProject();
    const forBob = await alice.mutation(api.members.invite, { projectId: pid, userId: "bob", role: "editor" });

    // Wrong user cannot steal the invitation.
    await expect(carol.mutation(api.members.accept, { invitationId: forBob })).rejects.toThrow("Invitation unavailable");
    // Target accepts once; the invitation is consumed.
    await bob.mutation(api.members.accept, { invitationId: forBob });
    expect((await bob.query(api.members.pending, {})).length).toBe(0);
    await expect(bob.mutation(api.members.accept, { invitationId: forBob })).rejects.toThrow("Invitation unavailable");

    // Expired invitations are invisible and unusable.
    const forCarol = await alice.mutation(api.members.invite, { projectId: pid, userId: "carol", role: "viewer" });
    await t.run(async (ctx) => {
      await ctx.db.patch(forCarol, { expiresAt: Date.now() - 1000 });
    });
    expect(await carol.query(api.members.pending, {})).toEqual([]);
    await expect(carol.mutation(api.members.accept, { invitationId: forCarol })).rejects.toThrow("Invitation unavailable");

    // Revoked invitations are unusable even before expiry.
    const forDave = await alice.mutation(api.members.invite, { projectId: pid, userId: "dave", role: "viewer" });
    expect((await dave.query(api.members.pending, {})).length).toBe(1);
    await alice.mutation(api.members.revokeInvite, { invitationId: forDave });
    expect(await dave.query(api.members.pending, {})).toEqual([]);
    await expect(dave.mutation(api.members.accept, { invitationId: forDave })).rejects.toThrow("Invitation unavailable");

    // Non-owners cannot revoke.
    const again = await alice.mutation(api.members.invite, { projectId: pid, userId: "dave", role: "viewer" });
    await expect(bob.mutation(api.members.revokeInvite, { invitationId: again })).rejects.toThrow("Forbidden");
    await alice.mutation(api.members.revokeInvite, { invitationId: again });
  });

  it("accepting while already a member patches the role without duplicating", async () => {
    const pid = await blankProject();
    await shareAs(pid, bob, "bob", "editor");
    const second = await alice.mutation(api.members.invite, { projectId: pid, userId: "bob", role: "viewer" });
    await bob.mutation(api.members.accept, { invitationId: second });
    const roster = await alice.query(api.members.list, { projectId: pid });
    expect(roster.members.filter((m) => m.userId === "bob")).toHaveLength(1);
    expect(roster.members.find((m) => m.userId === "bob")?.role).toBe("viewer");
    // Downgraded effective permission applies immediately.
    await expect(bob.mutation(api.files.save, { projectId: pid, path: "x.tex", content: "x" })).rejects.toThrow("Forbidden");
  });

  it("rejects acceptance for a deleted project", async () => {
    const pid = await blankProject();
    const invite = await alice.mutation(api.members.invite, { projectId: pid, userId: "bob", role: "editor" });
    await alice.mutation(api.projects.remove, { projectId: pid });
    await expect(bob.mutation(api.members.accept, { invitationId: invite })).rejects.toThrow("Invitation unavailable");
  });

  it("applies downgrade and removal immediately, including presence", async () => {
    const pid = await blankProject();
    await shareAs(pid, bob, "bob", "editor");
    await bob.mutation(api.presence.heartbeat, { projectId: pid, name: "Bob", color: "blue" });
    expect(await alice.query(api.presence.list, { projectId: pid })).toHaveLength(1);

    await alice.mutation(api.members.setRole, { projectId: pid, userId: "bob", role: "viewer" });
    expect((await bob.query(api.projects.get, { projectId: pid }))?.role).toBe("viewer");
    await expect(bob.mutation(api.files.save, { projectId: pid, path: "x.tex", content: "x" })).rejects.toThrow("Forbidden");
    expect((await bob.query(api.files.list, { projectId: pid })).length).toBeGreaterThan(0);

    // Only owners can change roles.
    await expect(carol.mutation(api.members.setRole, { projectId: pid, userId: "bob", role: "editor" })).rejects.toThrow("Forbidden");
    await expect(bob.mutation(api.members.setRole, { projectId: pid, userId: "carol", role: "editor" })).rejects.toThrow("Forbidden");

    // Removal revokes reads and drops presence immediately.
    await alice.mutation(api.members.setRole, { projectId: pid, userId: "bob", role: null });
    expect(await bob.query(api.files.list, { projectId: pid })).toEqual([]);
    expect(await bob.query(api.projects.get, { projectId: pid })).toBeNull();
    expect(await alice.query(api.presence.list, { projectId: pid })).toEqual([]);
    expect(await bob.query(api.projects.listMine, {})).toEqual([]);
  });

  it("authorizes presence per role and filters stale heartbeats", async () => {
    const pid = await blankProject();
    await shareAs(pid, bob, "bob", "editor");
    await shareAs(pid, carol, "carol", "viewer");

    await alice.mutation(api.presence.heartbeat, { projectId: pid, name: "Alice", color: "red" });
    await bob.mutation(api.presence.heartbeat, { projectId: pid, name: "Bob", color: "blue", cursorLine: 3 });
    await carol.mutation(api.presence.heartbeat, { projectId: pid, name: "Carol", color: "green" });
    await expect(dave.mutation(api.presence.heartbeat, { projectId: pid, name: "Dave", color: "x" })).rejects.toThrow("Forbidden");
    expect(await dave.query(api.presence.list, { projectId: pid })).toEqual([]);

    const seenByViewer = await carol.query(api.presence.list, { projectId: pid });
    expect(seenByViewer.map((r) => r.userId).sort()).toEqual(["alice", "bob", "carol"]);

    // Stale heartbeats are filtered without a delete.
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("presence").collect();
      for (const row of rows) await ctx.db.patch(row._id, { updatedAt: Date.now() - 60_000 });
    });
    expect(await alice.query(api.presence.list, { projectId: pid })).toEqual([]);
  });
});
