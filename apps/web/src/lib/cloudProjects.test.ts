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
let owner: IdentityClient;
let stranger: IdentityClient;

beforeEach(() => {
  t = convexTest(schema, modules);
  owner = t.withIdentity({ subject: "owner" });
  stranger = t.withIdentity({ subject: "someone-else" });
});

async function tokenFor(client: IdentityClient, projectId: Id<"projects">, path: string) {
  const files = await client.query(api.files.list, { projectId });
  const row = files.find((f) => f.path === path)!;
  return { version: row.version, incarnation: String(row._id) };
}

describe("cloud project controls", () => {
  it("creates a blank owned project and valid main source", async () => {
    const pid = await owner.mutation(api.projects.create, { template: "blank" });
    const project = await owner.query(api.projects.get, { projectId: pid });
    expect(project?.ownerId).toBe("owner");
    expect(project?.name).toBe("Untitled Project");
    const files = await owner.query(api.files.list, { projectId: pid });
    const main = files.find((f) => f.path === "main.tex")!;
    expect(main.content).toContain("\\begin{document}");
  });

  it("creates a bibliography template with both files", async () => {
    const pid = await owner.mutation(api.projects.create, { template: "bib" });
    const files = await owner.query(api.files.list, { projectId: pid });
    expect(files.map((f) => f.path).sort()).toEqual(["main.tex", "refs.bib"]);
  });

  it("refuses unauthenticated creation", async () => {
    await expect(t.mutation(api.projects.create, { template: "blank" })).rejects.toThrow("Unauthorized");
    expect(await owner.query(api.projects.listMine, {})).toEqual([]);
  });

  it("refuses project mutations by another owner", async () => {
    const pid = await owner.mutation(api.projects.create, { template: "blank" });
    await expect(stranger.mutation(api.projects.rename, { projectId: pid, name: "Changed" })).rejects.toThrow("Forbidden");
    await expect(stranger.mutation(api.projects.setMainFile, { projectId: pid, path: "main.tex" })).rejects.toThrow("Forbidden");
    expect((await owner.query(api.projects.get, { projectId: pid }))?.name).toBe("Untitled Project");
  });

  it("persists a valid root and rejects missing or non-TeX files", async () => {
    const pid = await owner.mutation(api.projects.create, { template: "blank" });
    await owner.mutation(api.files.save, { projectId: pid, path: "chapter.tex", content: "chapter" });
    await owner.mutation(api.projects.setMainFile, { projectId: pid, path: "chapter.tex" });
    expect((await owner.query(api.projects.get, { projectId: pid }))?.mainFile).toBe("chapter.tex");
    await owner.mutation(api.files.save, { projectId: pid, path: "notes.txt", content: "notes" });
    await expect(owner.mutation(api.projects.setMainFile, { projectId: pid, path: "notes.txt" })).rejects.toThrow("TeX");
    await expect(owner.mutation(api.projects.setMainFile, { projectId: pid, path: "missing.tex" })).rejects.toThrow("TeX");
  });

  it("does not expose a foreign project and rejects bad ids", async () => {
    const pid = await owner.mutation(api.projects.create, { template: "blank" });
    expect(await owner.query(api.projects.get, { projectId: "bad" })).toBeNull();
    expect(await stranger.query(api.projects.get, { projectId: pid })).toBeNull();
  });

  it("retains the configured root through cloud file rename", async () => {
    const pid = await owner.mutation(api.projects.create, { template: "blank" });
    await owner.mutation(api.files.save, { projectId: pid, path: "chapter.tex", content: "chapter" });
    await owner.mutation(api.projects.setMainFile, { projectId: pid, path: "chapter.tex" });
    const tok = await tokenFor(owner, pid, "chapter.tex");
    await owner.mutation(api.files.renameFile, {
      projectId: pid,
      oldPath: "chapter.tex",
      newPath: "renamed.tex",
      expectedVersion: tok.version,
      expectedIncarnation: tok.incarnation,
    });
    expect((await owner.query(api.projects.get, { projectId: pid }))?.mainFile).toBe("renamed.tex");
  });

  it("clears a deleted cloud root so the next existing TeX file can be selected", async () => {
    const pid = await owner.mutation(api.projects.create, { template: "blank" });
    await owner.mutation(api.files.save, { projectId: pid, path: "chapter.tex", content: "chapter" });
    await owner.mutation(api.projects.setMainFile, { projectId: pid, path: "chapter.tex" });
    const tok = await tokenFor(owner, pid, "chapter.tex");
    await owner.mutation(api.files.deleteFile, {
      projectId: pid,
      path: "chapter.tex",
      expectedVersion: tok.version,
      expectedIncarnation: tok.incarnation,
    });
    const project = await owner.query(api.projects.get, { projectId: pid });
    expect(project?.mainFile).toBeUndefined();
    expect((await owner.query(api.files.list, { projectId: pid })).map((f) => f.path)).toContain("main.tex");
  });
});
