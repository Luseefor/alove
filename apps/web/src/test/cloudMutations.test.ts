// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import {
  MAX_FILE_BYTES,
  MAX_PROJECT_BYTES,
  utf8ByteLength,
} from "../lib/cloudProjectLimits";

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

beforeEach(() => {
  t = convexTest(schema, modules);
  alice = t.withIdentity({ subject: "alice" });
  bob = t.withIdentity({ subject: "bob" });
});

async function blankProject() {
  return await alice.mutation(api.projects.create, { template: "blank" });
}

describe("cloud mutations", () => {
  it("denies foreign access without revealing files", async () => {
    const pid = await blankProject();
    expect(await bob.query(api.files.list, { projectId: pid })).toEqual([]);
    expect(await bob.query(api.projects.get, { projectId: pid })).toBeNull();
    await expect(
      bob.mutation(api.files.save, { projectId: pid, path: "x.tex", content: "hi" }),
    ).rejects.toThrow("Forbidden");
    await expect(
      bob.mutation(api.files.renameFile, { projectId: pid, oldPath: "main.tex", newPath: "y.tex" }),
    ).rejects.toThrow("Forbidden");
    await expect(
      bob.mutation(api.files.deleteFile, { projectId: pid, path: "main.tex" }),
    ).rejects.toThrow("Forbidden");
    await expect(
      bob.mutation(api.projects.rename, { projectId: pid, name: "Taken" }),
    ).rejects.toThrow("Forbidden");
    await expect(
      bob.mutation(api.projects.setMainFile, { projectId: pid, path: "main.tex" }),
    ).rejects.toThrow("Forbidden");
    await expect(bob.mutation(api.projects.remove, { projectId: pid })).rejects.toThrow(
      "Forbidden",
    );
    const files = await alice.query(api.files.list, { projectId: pid });
    expect(files.map((f) => f.path)).toContain("main.tex");
  });

  it("saves a valid nested path", async () => {
    const pid = await blankProject();
    const res = await alice.mutation(api.files.save, {
      projectId: pid,
      path: "chapters/intro.tex",
      content: "hello",
    });
    expect(res.conflict).toBe(false);
    expect(res.version).toBe(1);
    const files = await alice.query(api.files.list, { projectId: pid });
    expect(files.map((f) => f.path).sort()).toEqual(["chapters/intro.tex", "main.tex"]);
  });

  it("enforces compare-and-swap with default 0", async () => {
    const pid = await blankProject();
    const created = await alice.mutation(api.files.save, { projectId: pid, path: "a.tex", content: "v1" });
    expect(created.conflict).toBe(false);
    const token = (created as { incarnation?: string }).incarnation ?? String((await alice.query(api.files.list, { projectId: pid })).find((f) => f.path === "a.tex")!._id);
    const stale = await alice.mutation(api.files.save, {
      projectId: pid,
      path: "a.tex",
      content: "stale write",
      expectedVersion: 0,
    });
    expect(stale.conflict).toBe(true);
    expect(stale.version).toBe(1);
    if (stale.conflict) expect(stale.content).toBe("v1");
    const files = await alice.query(api.files.list, { projectId: pid });
    expect(files.find((f) => f.path === "a.tex")?.content).toBe("v1");
    // Existing write without the row token is stale, even on version match.
    const missingToken = await alice.mutation(api.files.save, {
      projectId: pid,
      path: "a.tex",
      content: "no token",
      expectedVersion: 1,
    });
    expect(missingToken.conflict).toBe(true);
    const fresh = await alice.mutation(api.files.save, {
      projectId: pid,
      path: "a.tex",
      content: "v2",
      expectedVersion: 1,
      expectedIncarnation: token,
    });
    expect(fresh.conflict).toBe(false);
    expect(fresh.version).toBe(2);
  });

  it("rejects stale incarnation writes after delete and recreate with the same version", async () => {
    const pid = await blankProject();
    const created = await alice.mutation(api.files.save, { projectId: pid, path: "a.tex", content: "v1" });
    const oldToken = (created as { incarnation?: string }).incarnation!;
    const listed = await alice.query(api.files.list, { projectId: pid });
    expect(String(listed.find((f) => f.path === "a.tex")!._id)).toBe(oldToken);
    const removed = await alice.mutation(api.files.deleteFile, { projectId: pid, path: "a.tex", expectedVersion: 1, expectedIncarnation: oldToken });
    expect(removed.deleted).toBe(true);
    const recreated = await alice.mutation(api.files.save, { projectId: pid, path: "a.tex", content: "new file" });
    expect(recreated.conflict).toBe(false);
    expect(recreated.version).toBe(1);
    const newToken = (recreated as { incarnation?: string }).incarnation!;
    expect(newToken).not.toBe(oldToken);
    // Old incarnation write with a matching version still conflicts.
    const staleWrite = await alice.mutation(api.files.save, {
      projectId: pid,
      path: "a.tex",
      content: "stale overwrite",
      expectedVersion: 1,
      expectedIncarnation: oldToken,
    });
    expect(staleWrite.conflict).toBe(true);
    expect((staleWrite as { recreated?: boolean }).recreated).toBe(true);
    expect(await alice.query(api.files.list, { projectId: pid }).then((rows) => rows.find((f) => f.path === "a.tex")?.content)).toBe("new file");
    // Stale delete and stale rename are refused as well.
    const staleDelete = await alice.mutation(api.files.deleteFile, { projectId: pid, path: "a.tex", expectedVersion: 1, expectedIncarnation: oldToken });
    expect(staleDelete.deleted).toBe(false);
    expect(staleDelete.conflict).toBe(true);
    const staleRename = await alice.mutation(api.files.renameFile, { projectId: pid, oldPath: "a.tex", newPath: "b.tex", expectedVersion: 1, expectedIncarnation: oldToken });
    expect((staleRename as { conflict?: boolean }).conflict).toBe(true);
    expect(await alice.query(api.files.list, { projectId: pid }).then((rows) => rows.map((f) => f.path))).toContain("a.tex");
    // Fresh token still works.
    const fresh = await alice.mutation(api.files.save, { projectId: pid, path: "a.tex", content: "v2", expectedVersion: 1, expectedIncarnation: newToken });
    expect(fresh.conflict).toBe(false);
  });

  it("requires version 0 to create", async () => {
    const pid = await blankProject();
    const bad = await alice.mutation(api.files.save, {
      projectId: pid,
      path: "new.tex",
      content: "hi",
      expectedVersion: 4,
    });
    expect(bad.conflict).toBe(true);
    expect(bad.version).toBe(0);
    const zero = await alice.mutation(api.files.save, {
      projectId: pid,
      path: "new.tex",
      content: "hi",
      expectedVersion: 0,
    });
    expect(zero.conflict).toBe(false);
    expect(zero.version).toBe(1);
  });

  it("rejects unsafe paths", async () => {
    const pid = await blankProject();
    for (const path of ["../evil.tex", "/abs.tex", "a\\b.tex", "a//b.tex", "a/../b.tex", ""]) {
      await expect(
        alice.mutation(api.files.save, { projectId: pid, path, content: "x" }),
      ).rejects.toThrow();
    }
    const files = await alice.query(api.files.list, { projectId: pid });
    expect(files).toHaveLength(1);
  });

  it("rejects file and ancestor collisions on save", async () => {
    const pid = await blankProject();
    await alice.mutation(api.files.save, {
      projectId: pid,
      path: "chapters/intro.tex",
      content: "hi",
    });
    await expect(
      alice.mutation(api.files.save, { projectId: pid, path: "chapters", content: "hi" }),
    ).rejects.toThrow();
    await expect(
      alice.mutation(api.files.save, {
        projectId: pid,
        path: "chapters/intro.tex/extra.tex",
        content: "hi",
      }),
    ).rejects.toThrow();
  });

  it("rejects oversize files at 768 KB", async () => {
    const pid = await blankProject();
    const atLimit = "x".repeat(MAX_FILE_BYTES);
    const ok = await alice.mutation(api.files.save, {
      projectId: pid,
      path: "big.tex",
      content: atLimit,
    });
    expect(ok.conflict).toBe(false);
    await expect(
      alice.mutation(api.files.save, {
        projectId: pid,
        path: "too-big.tex",
        content: `${atLimit}x`,
      }),
    ).rejects.toThrow("too large");
  });

  it("rejects projects over 4 MB total", async () => {
    const pid = await blankProject();
    const chunk = "y".repeat(700 * 1024);
    for (let i = 0; i < 5; i++) {
      await alice.mutation(api.files.save, {
        projectId: pid,
        path: `part-${i}.tex`,
        content: chunk,
      });
    }
    await expect(
      alice.mutation(api.files.save, { projectId: pid, path: "one-more.tex", content: chunk }),
    ).rejects.toThrow("too large");
    const files = await alice.query(api.files.list, { projectId: pid });
    expect(files.map((f) => f.path)).not.toContain("one-more.tex");
  });

  it("rejects files past the 250 count", async () => {
    const pid = await blankProject();
    await t.run(async (ctx) => {
      for (let i = 0; i < 249; i++) {
        await ctx.db.insert("projectFiles", {
          projectId: pid,
          path: `seed/${i}.tex`,
          content: "x",
          version: 1,
          updatedAt: Date.now(),
          updatedBy: "alice",
        });
      }
    });
    await expect(
      alice.mutation(api.files.save, { projectId: pid, path: "extra.tex", content: "x" }),
    ).rejects.toThrow("too many files");
  });

  it("rejects projects past the 50 count", async () => {
    await t.run(async (ctx) => {
      for (let i = 0; i < 50; i++) {
        await ctx.db.insert("projects", {
          name: `Seed ${i}`,
          ownerId: "alice",
          designMode: true,
          updatedAt: Date.now(),
        });
      }
    });
    await expect(alice.mutation(api.projects.create, { template: "blank" })).rejects.toThrow(
      "Too many projects",
    );
  });

  it("seeds the sample template within file and total limits", async () => {
    const pid = await alice.mutation(api.projects.create, { template: "sample" });
    const files = await alice.query(api.files.list, { projectId: pid });
    expect(files.length).toBeGreaterThan(1);
    let total = 0;
    for (const f of files) {
      expect(utf8ByteLength(f.content)).toBeLessThanOrEqual(MAX_FILE_BYTES);
      total += utf8ByteLength(f.content);
    }
    expect(total).toBeLessThanOrEqual(MAX_PROJECT_BYTES);
  });

  it("returns one project for concurrent ensureDefault", async () => {
    const [first, second] = await Promise.all([
      alice.mutation(api.projects.ensureDefault, {}),
      alice.mutation(api.projects.ensureDefault, {}),
    ]);
    expect(first).toEqual(second);
    expect(await alice.query(api.projects.listMine, {})).toHaveLength(1);
  });

  it("handles rename missing, collision, and same-path", async () => {
    const pid = await blankProject();
    await alice.mutation(api.files.save, { projectId: pid, path: "a.tex", content: "a" });
    await alice.mutation(api.files.save, { projectId: pid, path: "b.tex", content: "b" });
    const tokenA = String((await alice.query(api.files.list, { projectId: pid })).find((f) => f.path === "a.tex")!._id);
    await expect(
      alice.mutation(api.files.renameFile, { projectId: pid, oldPath: "missing.tex", newPath: "x.tex" }),
    ).rejects.toThrow();
    await expect(
      alice.mutation(api.files.renameFile, { projectId: pid, oldPath: "a.tex", newPath: "b.tex", expectedVersion: 1, expectedIncarnation: tokenA }),
    ).rejects.toThrow("already exists");
    await alice.mutation(api.files.renameFile, {
      projectId: pid,
      oldPath: "a.tex",
      newPath: "a.tex",
    });
    await alice.mutation(api.files.renameFile, {
      projectId: pid,
      oldPath: "a.tex",
      newPath: "c.tex",
      expectedVersion: 1,
      expectedIncarnation: tokenA,
    });
    const files = await alice.query(api.files.list, { projectId: pid });
    expect(files.map((f) => f.path).sort()).toEqual(["b.tex", "c.tex", "main.tex"]);
  });

  it("moves the main file on rename and clears it on delete", async () => {
    const pid = await blankProject();
    const created = await alice.mutation(api.files.save, { projectId: pid, path: "a.tex", content: "a" });
    expect(created.conflict).toBe(false);
    const tokenA = (created as { incarnation?: string }).incarnation!;
    await alice.mutation(api.projects.setMainFile, { projectId: pid, path: "a.tex" });
    const renamed = await alice.mutation(api.files.renameFile, {
      projectId: pid,
      oldPath: "a.tex",
      newPath: "renamed.tex",
      expectedVersion: 1,
      expectedIncarnation: tokenA,
    });
    expect((renamed as { conflict?: boolean }).conflict).not.toBe(true);
    const afterRename = await alice.query(api.projects.get, { projectId: pid });
    expect(afterRename?.mainFile).toBe("renamed.tex");
    const deleted = await alice.mutation(api.files.deleteFile, {
      projectId: pid,
      path: "renamed.tex",
      expectedVersion: 1,
      expectedIncarnation: (renamed as { incarnation?: string }).incarnation ?? tokenA,
    });
    expect((deleted as { conflict?: boolean }).conflict).not.toBe(true);
    const afterDelete = await alice.query(api.projects.get, { projectId: pid });
    expect(afterDelete?.mainFile).toBeUndefined();
  });

  it("rejects bad main file choices", async () => {
    const pid = await blankProject();
    await alice.mutation(api.files.save, { projectId: pid, path: "notes.txt", content: "x" });
    await expect(
      alice.mutation(api.projects.setMainFile, { projectId: pid, path: "missing.tex" }),
    ).rejects.toThrow("TeX");
    await expect(
      alice.mutation(api.projects.setMainFile, { projectId: pid, path: "notes.txt" }),
    ).rejects.toThrow("TeX");
  });

  it("treats delete of a missing file as fine", async () => {
    const pid = await blankProject();
    await alice.mutation(api.files.deleteFile, { projectId: pid, path: "missing.tex" });
    const files = await alice.query(api.files.list, { projectId: pid });
    expect(files).toHaveLength(1);
  });

  it("validates project rename titles", async () => {
    const pid = await blankProject();
    await expect(alice.mutation(api.projects.rename, { projectId: pid, name: "   " })).rejects.toThrow(
      "1-200",
    );
    await expect(
      alice.mutation(api.projects.rename, { projectId: pid, name: "x".repeat(201) }),
    ).rejects.toThrow("1-200");
    await alice.mutation(api.projects.rename, { projectId: pid, name: "  Real Title  " });
    expect((await alice.query(api.projects.get, { projectId: pid }))?.name).toBe("Real Title");
  });

  it("deletes a project with its files and presence, leaving others alone", async () => {
    const mine = await blankProject();
    await alice.mutation(api.files.save, { projectId: mine, path: "a.tex", content: "a" });
    await alice.mutation(api.presence.heartbeat, {
      projectId: mine,
      name: "Alice",
      color: "red",
    });
    const theirs = await bob.mutation(api.projects.create, { template: "blank" });
    const res = await alice.mutation(api.projects.remove, { projectId: mine });
    expect(res.deletedFiles).toBe(2);
    expect(await alice.query(api.projects.get, { projectId: mine })).toBeNull();
    expect(await alice.query(api.files.list, { projectId: mine })).toEqual([]);
    expect(await alice.query(api.presence.list, { projectId: mine })).toEqual([]);
    expect(await bob.query(api.projects.get, { projectId: theirs })).not.toBeNull();
    expect(await bob.query(api.files.list, { projectId: theirs })).toHaveLength(1);
  });
  it("requires both a version and a row identity for destructive existing-file mutations", async () => {
    const pid = await blankProject();
    const created = await alice.mutation(api.files.save, { projectId: pid, path: "guard.tex", content: "original" });
    const token = created.incarnation!;
    const changed = await alice.mutation(api.files.save, { projectId: pid, path: "guard.tex", content: "newer", expectedVersion: 1, expectedIncarnation: token });
    expect(changed.conflict).toBe(false);
    const deleted = await alice.mutation(api.files.deleteFile, { projectId: pid, path: "guard.tex", expectedIncarnation: token });
    expect(deleted.conflict).toBe(true);
    const renamed = await alice.mutation(api.files.renameFile, { projectId: pid, oldPath: "guard.tex", newPath: "moved.tex", expectedIncarnation: token });
    expect(renamed.conflict).toBe(true);
    const unbound = await alice.mutation(api.files.save, { projectId: pid, path: "guard.tex", content: "stale", expectedVersion: 2 });
    expect(unbound.conflict).toBe(true);
    const files = await alice.query(api.files.list, { projectId: pid });
    expect(files.find((file) => file.path === "guard.tex")?.content).toBe("newer");
  });

});
