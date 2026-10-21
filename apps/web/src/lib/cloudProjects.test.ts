import { describe, it, expect, vi } from "vitest";
import { renameFile, deleteFile } from "../../convex/files";
import { create, rename, setMainFile, get } from "../../convex/projects";

const handler = (fn: unknown) =>
  (fn as { _handler: (ctx: unknown, args: unknown) => Promise<unknown> })
    ._handler;
function context(owner = "owner") {
  const unique = vi.fn(async () => ({ _id: "file", path: "chapter.tex", version: 1 }));
  const db = {
    get: vi.fn(async () => ({ _id: "project", ownerId: owner, name: "Paper" })),
    insert: vi.fn(async (table: string, value: unknown) => {
      void table;
      void value;
      return "new-project";
    }),
    patch: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    normalizeId: vi.fn((_: string, value: string) =>
      value === "bad" ? null : value,
    ),
    query: vi.fn(() => ({ withIndex: () => ({ unique, collect: vi.fn(async () => []) }) })),
  };
  return {
    auth: { getUserIdentity: vi.fn(async () => ({ subject: "owner" })) },
    db,
    unique,
  };
}
describe("cloud project controls", () => {
  it("creates a blank owned project and valid main source", async () => {
    const ctx = context();
    await handler(create)(ctx, { template: "blank" });
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "projects",
      expect.objectContaining({ ownerId: "owner", name: "Untitled Project" }),
    );
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "projectFiles",
      expect.objectContaining({
        path: "main.tex",
        content: expect.stringContaining("\\begin{document}"),
        projectId: "new-project",
      }),
    );
  });
  it("creates a bibliography template with both files", async () => {
    const ctx = context();
    await handler(create)(ctx, { template: "bib" });
    expect(
      ctx.db.insert.mock.calls.filter(([table]) => table === "projectFiles"),
    ).toHaveLength(2);
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "projectFiles",
      expect.objectContaining({ path: "refs.bib" }),
    );
  });
  it("refuses unauthenticated creation", async () => {
    const ctx = context();
    ctx.auth.getUserIdentity.mockResolvedValue(null as never);
    await expect(handler(create)(ctx, { template: "blank" })).rejects.toThrow(
      "Unauthorized",
    );
    expect(ctx.db.insert).not.toHaveBeenCalled();
  });
  it("refuses project mutations by another owner", async () => {
    const ctx = context("someone-else");
    await expect(
      handler(rename)(ctx, { projectId: "project", name: "Changed" }),
    ).rejects.toThrow("Forbidden");
    await expect(
      handler(setMainFile)(ctx, { projectId: "project", path: "chapter.tex" }),
    ).rejects.toThrow("Forbidden");
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
  it("persists a valid root and rejects missing or non-TeX files", async () => {
    const ctx = context();
    await handler(setMainFile)(ctx, {
      projectId: "project",
      path: "chapter.tex",
    });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "project",
      expect.objectContaining({ mainFile: "chapter.tex" }),
    );
    await expect(
      handler(setMainFile)(ctx, { projectId: "project", path: "notes.txt" }),
    ).rejects.toThrow("TeX");
    ctx.unique.mockResolvedValue(null as never);
    await expect(
      handler(setMainFile)(ctx, { projectId: "project", path: "missing.tex" }),
    ).rejects.toThrow("TeX");
  });
  it("does not query invalid project IDs or expose a foreign project", async () => {
    const ctx = context("someone-else");
    expect(await handler(get)(ctx, { projectId: "bad" })).toBeNull();
    expect(ctx.db.get).not.toHaveBeenCalled();
    expect(await handler(get)(ctx, { projectId: "project" })).toBeNull();
  });
  it("retains the configured root through cloud file rename", async () => {
    const ctx = context();
    ctx.db.get.mockResolvedValue({
      _id: "project",
      ownerId: "owner",
      name: "Paper",
      mainFile: "chapter.tex",
    } as never);
    ctx.unique
      .mockResolvedValueOnce({ _id: "file", path: "chapter.tex", version: 1 })
      .mockResolvedValueOnce(null as never);
    await handler(renameFile)(ctx, {
      projectId: "project",
      oldPath: "chapter.tex",
      newPath: "renamed.tex",
      expectedVersion: 1,
      expectedIncarnation: "file",
    });
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "project",
      expect.objectContaining({ mainFile: "renamed.tex" }),
    );
  });
  it("clears a deleted cloud root so the next existing TeX file can be selected", async () => {
    const ctx = context();
    ctx.db.get.mockResolvedValue({
      _id: "project",
      ownerId: "owner",
      name: "Paper",
      mainFile: "chapter.tex",
    } as never);
    await handler(deleteFile)(ctx, {
      projectId: "project",
      path: "chapter.tex",
      expectedVersion: 1,
      expectedIncarnation: "file",
    });
    expect(ctx.db.delete).toHaveBeenCalledWith("file");
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "project",
      expect.objectContaining({ mainFile: undefined }),
    );
  });
});
