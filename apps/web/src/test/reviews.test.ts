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

async function shareAs(projectId: Id<"projects">, target: IdentityClient, subject: string, role: "editor" | "viewer") {
  const invitation = await alice.mutation(api.members.invite, { projectId, userId: subject, role });
  await target.mutation(api.members.accept, { invitationId: invitation });
}

describe("reviews", () => {
  it("runs the comment thread lifecycle with edit-only writes", async () => {
    const pid = await blankProject();
    await shareAs(pid, bob, "bob", "editor");
    await shareAs(pid, carol, "carol", "viewer");
    const content = "alpha beta gamma";
    await writeVersioned(alice, pid, "a.tex", content);
    const tok = await tokenFor(alice, pid, "a.tex");

    // Editors comment; viewers and outsiders cannot.
    const threadId = await bob.mutation(api.reviews.comment, {
      projectId: pid, path: "a.tex", from: 6, to: 10,
      expectedVersion: tok.version, expectedIncarnation: tok.incarnation, body: "check beta",
    });
    await expect(carol.mutation(api.reviews.comment, {
      projectId: pid, path: "a.tex", from: 6, to: 10,
      expectedVersion: tok.version, expectedIncarnation: tok.incarnation, body: "nope",
    })).rejects.toThrow("Forbidden");
    await expect(dave.mutation(api.reviews.comment, {
      projectId: pid, path: "a.tex", from: 6, to: 10,
      expectedVersion: tok.version, expectedIncarnation: tok.incarnation, body: "nope",
    })).rejects.toThrow("Forbidden");

    await bob.mutation(api.reviews.reply, { threadId, body: "agreed" });
    await expect(carol.mutation(api.reviews.reply, { threadId, body: "nope" })).rejects.toThrow("Forbidden");
    await bob.mutation(api.reviews.resolve, { threadId, resolved: true });

    const listed = await carol.query(api.reviews.list, { projectId: pid });
    expect(listed.threads).toHaveLength(1);
    expect(listed.threads[0].resolved).toBe(true);
    expect(listed.threads[0].quote).toBe("beta");
    expect(listed.threads[0].messages.map((m) => m.body).sort()).toEqual(["agreed", "check beta"]);
    await expect(dave.query(api.reviews.list, { projectId: pid })).rejects.toThrow("Forbidden");

    // Body validation.
    await expect(bob.mutation(api.reviews.comment, {
      projectId: pid, path: "a.tex", from: 6, to: 10,
      expectedVersion: tok.version, expectedIncarnation: tok.incarnation, body: "   ",
    })).rejects.toThrow();
    await expect(bob.mutation(api.reviews.reply, { threadId, body: "x".repeat(8001) })).rejects.toThrow();
  });

  it("rebases suggestion anchors across unrelated edits", async () => {
    const pid = await blankProject();
    await shareAs(pid, bob, "bob", "editor");
    await writeVersioned(alice, pid, "a.tex", "AAA beta BBB");
    const tok = await tokenFor(alice, pid, "a.tex");
    const suggestionId = await bob.mutation(api.reviews.suggest, {
      projectId: pid, path: "a.tex", from: 4, to: 8,
      expectedVersion: tok.version, expectedIncarnation: tok.incarnation, replacement: "GAMMA",
    });

    // Unrelated edit elsewhere preserves the anchor context.
    await writeVersioned(alice, pid, "a.tex", "ZZZ AAA beta BBB");
    const fresh = await tokenFor(alice, pid, "a.tex");
    const decided = await alice.mutation(api.reviews.decide, {
      suggestionId, accept: true, expectedVersion: fresh.version, expectedIncarnation: fresh.incarnation,
    });
    void decided;
    expect((await alice.query(api.files.list, { projectId: pid })).find((f) => f.path === "a.tex")?.content)
      .toBe("ZZZ AAA GAMMA BBB");
    const listed = await alice.query(api.reviews.list, { projectId: pid });
    expect(listed.suggestions.find((s) => String(s._id) === String(suggestionId))?.status).toBe("accepted");
  });

  it("refuses ambiguous anchors and stale applies", async () => {
    const pid = await blankProject();
    await shareAs(pid, bob, "bob", "editor");
    const unit = "P".repeat(60) + "beta" + "S".repeat(60);
    await writeVersioned(alice, pid, "a.tex", unit + unit);
    const tok = await tokenFor(alice, pid, "a.tex");
    const suggestionId = await bob.mutation(api.reviews.suggest, {
      projectId: pid, path: "a.tex", from: 60, to: 64,
      expectedVersion: tok.version, expectedIncarnation: tok.incarnation, replacement: "GAMMA",
    });

    // Two identical contexts: resolution is ambiguous, never guessed.
    await expect(alice.mutation(api.reviews.decide, {
      suggestionId, accept: true, expectedVersion: tok.version, expectedIncarnation: tok.incarnation,
    })).rejects.toThrow(/ambiguous/);

    // Editing the anchored passage itself also refuses: with both copies
    // uppercased there is no matching anchor left.
    const cleared = `${"P".repeat(60)}BETA${"S".repeat(60)}${"P".repeat(60)}BETA${"S".repeat(60)}`;
    await writeVersioned(alice, pid, "a.tex", cleared);
    const fresh = await tokenFor(alice, pid, "a.tex");
    await expect(alice.mutation(api.reviews.decide, {
      suggestionId, accept: true, expectedVersion: fresh.version, expectedIncarnation: fresh.incarnation,
    })).rejects.toThrow(/ambiguous|changed/);

    // Missing CAS never applies.
    await expect(alice.mutation(api.reviews.decide, { suggestionId, accept: true })).rejects.toThrow("Source changed");
    expect((await alice.query(api.files.list, { projectId: pid })).find((f) => f.path === "a.tex")?.content).toContain("BETA");
  });

  it("lets any editor accept or reject; viewers cannot decide", async () => {
    const pid = await blankProject();
    await shareAs(pid, bob, "bob", "editor");
    await shareAs(pid, carol, "carol", "viewer");
    await writeVersioned(alice, pid, "a.tex", "one two");
    const tok = await tokenFor(alice, pid, "a.tex");
    const acceptId = await bob.mutation(api.reviews.suggest, {
      projectId: pid, path: "a.tex", from: 0, to: 3,
      expectedVersion: tok.version, expectedIncarnation: tok.incarnation, replacement: "1",
    });
    const rejectId = await bob.mutation(api.reviews.suggest, {
      projectId: pid, path: "a.tex", from: 4, to: 7,
      expectedVersion: tok.version, expectedIncarnation: tok.incarnation, replacement: "2",
    });

    // Owner (not the author) accepts; the file changes exactly once.
    await alice.mutation(api.reviews.decide, {
      suggestionId: acceptId, accept: true, expectedVersion: tok.version, expectedIncarnation: tok.incarnation,
    });
    expect((await alice.query(api.files.list, { projectId: pid })).find((f) => f.path === "a.tex")?.content).toBe("1 two");

    // Deciding twice is rejected; rejecting leaves source untouched.
    await expect(alice.mutation(api.reviews.decide, {
      suggestionId: acceptId, accept: true, expectedVersion: tok.version + 1, expectedIncarnation: tok.incarnation,
    })).rejects.toThrow("no longer pending");
    const afterAccept = await tokenFor(alice, pid, "a.tex");
    await carol.mutation(api.reviews.decide, {
      suggestionId: rejectId, accept: false,
    }).catch((e: unknown) => {
      expect(String((e as Error).message)).toMatch("Forbidden");
    });
    await alice.mutation(api.reviews.decide, { suggestionId: rejectId, accept: false });
    expect((await alice.query(api.files.list, { projectId: pid })).find((f) => f.path === "a.tex")?.content).toBe("1 two");
    const listed = await alice.query(api.reviews.list, { projectId: pid });
    expect(listed.suggestions.find((s) => String(s._id) === String(rejectId))?.status).toBe("rejected");
    expect(listed.suggestions.find((s) => String(s._id) === String(rejectId))?.resolvedBy).toBe("alice");
    void afterAccept;
  });

  it("validates suggestions and refuses binary selections", async () => {
    const pid = await blankProject();
    await shareAs(pid, bob, "bob", "editor");
    await writeVersioned(alice, pid, "a.tex", "hello");
    const tok = await tokenFor(alice, pid, "a.tex");
    await expect(bob.mutation(api.reviews.suggest, {
      projectId: pid, path: "a.tex", from: 0, to: 5,
      expectedVersion: tok.version, expectedIncarnation: tok.incarnation, replacement: "hello",
    })).rejects.toThrow(/changed/);
    await expect(bob.mutation(api.reviews.suggest, {
      projectId: pid, path: "a.tex", from: 0, to: 5,
      expectedVersion: tok.version, expectedIncarnation: tok.incarnation, replacement: `x${"y".repeat(16_000)}`,
    })).rejects.toThrow();

    await alice.mutation(api.files.save, { projectId: pid, path: "fig.png", content: "data:image/png;base64,aGVsbG8=" });
    const bin = await tokenFor(alice, pid, "fig.png");
    await expect(bob.mutation(api.reviews.comment, {
      projectId: pid, path: "fig.png", from: 0, to: 4,
      expectedVersion: bin.version, expectedIncarnation: bin.incarnation, body: "on binary",
    })).rejects.toThrow("Source changed");
  });
});
