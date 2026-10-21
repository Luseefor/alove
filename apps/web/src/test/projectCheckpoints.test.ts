// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
const modules = import.meta.glob("../../convex/**/*.*s");
let t: ReturnType<typeof convexTest>;
beforeEach(() => {
  t = convexTest(schema, modules);
});
describe("whole-project recovery around bulk replacement", () => {
  async function setup() {
    const owner = t.withIdentity({ subject: "owner" });
    const pid = await owner.mutation(api.projects.create, {
      template: "blank",
    });
    await owner.mutation(api.github.connect, {
      projectId: pid,
      owner: "octo",
      repo: "manuscript",
      branch: "main",
    });
    const target = { owner: "octo", repo: "manuscript", branch: "main" };
    const rows = () => owner.query(api.files.list, { projectId: pid });
    const snapshot = async () =>
      (await rows()).map((file) => ({
        path: file.path,
        version: file.version,
        incarnation: String(file._id),
      }));
    return { owner, pid, target, rows, snapshot };
  }
  it("preserves all 250 original files in one snapshot, beyond per-file history retention", async () => {
    const { owner, pid, target, snapshot } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 249; i++)
        await ctx.db.insert("projectFiles", {
          projectId: pid,
          path: `chapters/${i}.tex`,
          content: `original-${i}`,
          version: 1,
          updatedBy: "owner",
          updatedAt: 1,
        });
    });
    await owner.mutation(api.github.applyPull, {
      projectId: pid,
      expectedTarget: target,
      expected: await snapshot(),
      remoteHead: "a".repeat(40),
      files: [{ path: "main.tex", content: "remote replacement" }],
      deletePaths: [],
    });
    const checkpoints = await owner.query(api.sourceHistory.checkpoints, {
      projectId: pid,
    });
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].files).toHaveLength(250);
    const full = await owner.query(api.sourceHistory.getCheckpoint, {
      checkpointId: checkpoints[0]._id,
    });
    expect(Object.keys(full.files)).toHaveLength(250);
    expect(full.files["chapters/248.tex"]).toBe("original-248");
    expect(full.files["main.tex"]).not.toBe("remote replacement");
  });
  it("checks retained local files when enforcing count and ancestor constraints", async () => {
    const { owner, pid, target, snapshot, rows } = await setup();
    await owner.mutation(api.files.save, {
      projectId: pid,
      path: "notes",
      content: "local",
    });
    await expect(
      owner.mutation(api.github.applyPull, {
        projectId: pid,
        expectedTarget: target,
        expected: await snapshot(),
        remoteHead: "a".repeat(40),
        files: [{ path: "notes/chapter.tex", content: "remote" }],
        deletePaths: [],
      }),
    ).rejects.toThrow(/folder|blocks/);
    expect((await rows()).find((row) => row.path === "notes")?.content).toBe(
      "local",
    );
    expect(
      await owner.query(api.sourceHistory.checkpoints, { projectId: pid }),
    ).toEqual([]);
    await t.run(async (ctx) => {
      for (let i = 0; i < 248; i++)
        await ctx.db.insert("projectFiles", {
          projectId: pid,
          path: `${i}.tex`,
          content: "x",
          version: 1,
          updatedBy: "owner",
          updatedAt: 1,
        });
    });
    await expect(
      owner.mutation(api.github.applyPull, {
        projectId: pid,
        expectedTarget: target,
        expected: await snapshot(),
        remoteHead: "a".repeat(40),
        files: [{ path: "extra.tex", content: "remote" }],
        deletePaths: [],
      }),
    ).rejects.toThrow("too many");
  });
  it("retains two complete checkpoints and deletes evicted content blobs", async () => {
    const { owner, pid, snapshot, rows } = await setup();
    const firstId = await owner.mutation(api.sourceHistory.checkpoint, {
      projectId: pid,
      expected: await snapshot(),
    });
    const first = await owner.query(api.sourceHistory.checkpoints, {
      projectId: pid,
    });
    for (const content of ["second", "third"]) {
      const file = (await rows())[0];
      await owner.mutation(api.files.save, {
        projectId: pid,
        path: file.path,
        content,
        expectedVersion: file.version,
        expectedIncarnation: String(file._id),
      });
      await owner.mutation(api.sourceHistory.checkpoint, {
        projectId: pid,
        expected: await snapshot(),
      });
    }
    expect(
      await owner.query(api.sourceHistory.checkpoints, { projectId: pid }),
    ).toHaveLength(2);
    await t.run(async (ctx) => {
      expect(await ctx.db.get(firstId)).toBeNull();
      for (const file of first[0].files)
        expect(await ctx.db.get(file.contentId)).toBeNull();
    });
  });
  it("rejects pulls if the repository binding changes during the request", async () => {
    const { owner, pid, target, snapshot } = await setup();
    const expected = await snapshot();
    await owner.mutation(api.github.connect, {
      projectId: pid,
      owner: "octo",
      repo: "different",
      branch: "main",
    });
    await expect(
      owner.mutation(api.github.applyPull, {
        projectId: pid,
        expectedTarget: target,
        expected,
        remoteHead: "a".repeat(40),
        files: [{ path: "main.tex", content: "wrong repository" }],
        deletePaths: [],
      }),
    ).rejects.toThrow("connection changed");
  });
  it("restores checkpoint files with row identity CAS and protects viewer access", async () => {
    const { owner, pid, snapshot, rows } = await setup();
    const original = (await rows())[0];
    const checkpointId = await owner.mutation(api.sourceHistory.checkpoint, {
      projectId: pid,
      expected: await snapshot(),
    });
    await owner.mutation(api.files.save, {
      projectId: pid,
      path: original.path,
      content: "new",
      expectedVersion: original.version,
      expectedIncarnation: String(original._id),
    });
    await expect(
      owner.mutation(api.sourceHistory.restoreCheckpointFile, {
        checkpointId,
        path: original.path,
        expectedVersion: original.version,
        expectedIncarnation: String(original._id),
      }),
    ).rejects.toThrow("changed");
    const current = (await rows())[0];
    await owner.mutation(api.sourceHistory.restoreCheckpointFile, {
      checkpointId,
      path: current.path,
      expectedVersion: current.version,
      expectedIncarnation: String(current._id),
    });
    expect((await rows())[0].content).toBe(original.content);
    const viewer = t.withIdentity({ subject: "viewer" });
    await t.run(async (ctx) => {
      await ctx.db.insert("memberships", {
        projectId: pid,
        userId: "viewer",
        role: "viewer",
        createdAt: 1,
      });
    });
    expect(
      (await viewer.query(api.sourceHistory.getCheckpoint, { checkpointId }))
        .files[original.path],
    ).toBe(original.content);
    await expect(
      viewer.mutation(api.sourceHistory.checkpoint, {
        projectId: pid,
        expected: await snapshot(),
      }),
    ).rejects.toThrow("Forbidden");
  });
});
