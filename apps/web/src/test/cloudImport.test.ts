// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
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

beforeEach(() => {
  t = convexTest(schema, modules);
  alice = t.withIdentity({ subject: "alice" });
  bob = t.withIdentity({ subject: "bob" });
});

const UNICODE_TEX = "\\section{caf\u00e9 \u03b1\u03b2\u03b3 \u{1F389}}\n";
const BINARY_PDF =
  "data:application/pdf;base64,JVBERi0xLjAKMSAwIG9iajw8L1R5cGUvUGFnZXMvQ291bnQgMC9LaWRzW10+PmVuZG9iaiAyIDAgb2JqPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDEgMCBSPj5lbmRvYmogdHJhaWxlcjw8L1Jvb3QgMiAwIFI+PmVvZg==";
const BINARY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function archive() {
  return {
    name: "Imported Paper",
    mainFile: "main.tex" as string | null,
    files: [
      { path: "main.tex", content: UNICODE_TEX },
      { path: "sections/body.tex", content: "plain body" },
      { path: "assets/fig.pdf", content: BINARY_PDF },
      { path: "assets/img.png", content: BINARY_PNG },
    ],
  };
}

describe("project import", () => {
  it("imports a valid archive with unicode and binary strings intact", async () => {
    const pid = await alice.mutation(api.projects.importSource, archive());
    const project = await alice.query(api.projects.get, { projectId: pid });
    expect(project?.name).toBe("Imported Paper");
    expect(project?.mainFile).toBe("main.tex");
    expect(project?.ownerId).toBe("alice");
    const files = await alice.query(api.files.list, { projectId: pid });
    expect(files).toHaveLength(4);
    for (const f of files) {
      expect(f.version).toBe(1);
      expect(f.updatedBy).toBe("alice");
    }
    const byPath = new Map(files.map((f) => [f.path, f.content]));
    expect(byPath.get("main.tex")).toBe(UNICODE_TEX);
    expect(byPath.get("assets/fig.pdf")).toBe(BINARY_PDF);
    expect(byPath.get("assets/img.png")).toBe(BINARY_PNG);
  });

  it("rejects unauthenticated imports", async () => {
    await expect(t.mutation(api.projects.importSource, archive())).rejects.toThrow(
      "Unauthorized",
    );
  });

  it("keeps imports private to the owner", async () => {
    const pid = await alice.mutation(api.projects.importSource, archive());
    expect(await bob.query(api.files.list, { projectId: pid })).toEqual([]);
    expect(await bob.query(api.projects.get, { projectId: pid })).toBeNull();
    const own = await bob.mutation(api.projects.importSource, {
      ...archive(),
      name: "Bob Paper",
    });
    expect(await bob.query(api.files.list, { projectId: own })).toHaveLength(4);
  });

  it("rejects unsafe paths with nothing written", async () => {
    await expect(
      alice.mutation(api.projects.importSource, {
        ...archive(),
        files: [{ path: "../evil.tex", content: "x" }],
      }),
    ).rejects.toThrow("Invalid path");
    expect(await alice.query(api.projects.listMine, {})).toHaveLength(0);
  });

  it("rejects duplicate paths with nothing written", async () => {
    await expect(
      alice.mutation(api.projects.importSource, {
        ...archive(),
        mainFile: null,
        files: [
          { path: "a.tex", content: "one" },
          { path: "a.tex", content: "two" },
        ],
      }),
    ).rejects.toThrow("Duplicate");
    expect(await alice.query(api.projects.listMine, {})).toHaveLength(0);
  });

  it("rejects ancestor collisions with nothing written", async () => {
    await expect(
      alice.mutation(api.projects.importSource, {
        ...archive(),
        mainFile: null,
        files: [
          { path: "chapters", content: "x" },
          { path: "chapters/a.tex", content: "y" },
        ],
      }),
    ).rejects.toThrow("folder");
    expect(await alice.query(api.projects.listMine, {})).toHaveLength(0);
  });

  it("requires mainFile to be null or an existing TeX file", async () => {
    await expect(
      alice.mutation(api.projects.importSource, { ...archive(), mainFile: "missing.tex" }),
    ).rejects.toThrow("TeX");
    await expect(
      alice.mutation(api.projects.importSource, {
        ...archive(),
        mainFile: "assets/fig.pdf",
      }),
    ).rejects.toThrow("TeX");
    const pid = await alice.mutation(api.projects.importSource, {
      ...archive(),
      mainFile: null,
    });
    expect((await alice.query(api.projects.get, { projectId: pid }))?.mainFile).toBeUndefined();
  });

  it("rejects oversize files with nothing written", async () => {
    const big = "x".repeat(768 * 1024 + 1);
    await expect(
      alice.mutation(api.projects.importSource, {
        ...archive(),
        files: [{ path: "big.tex", content: big }],
      }),
    ).rejects.toThrow("too large");
    expect(await alice.query(api.projects.listMine, {})).toHaveLength(0);
  });

  it("rejects oversize totals with nothing written", async () => {
    const chunk = "y".repeat(700 * 1024);
    await expect(
      alice.mutation(api.projects.importSource, {
        ...archive(),
        mainFile: null,
        files: [0, 1, 2, 3, 4, 5].map((i) => ({ path: `part-${i}.tex`, content: chunk })),
      }),
    ).rejects.toThrow("too large");
    expect(await alice.query(api.projects.listMine, {})).toHaveLength(0);
  });

  it("rejects empty archives and enforces the project cap", async () => {
    await expect(
      alice.mutation(api.projects.importSource, { ...archive(), files: [] }),
    ).rejects.toThrow("1-250");
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
    await expect(alice.mutation(api.projects.importSource, archive())).rejects.toThrow(
      "Too many projects",
    );
  });

  it("trims titles and enforces the 1-200 range", async () => {
    await expect(
      alice.mutation(api.projects.importSource, { ...archive(), name: "   " }),
    ).rejects.toThrow("1-200");
    await expect(
      alice.mutation(api.projects.importSource, { ...archive(), name: "x".repeat(201) }),
    ).rejects.toThrow("1-200");
    const pid = await alice.mutation(api.projects.importSource, {
      ...archive(),
      name: "  Spaced Title  ",
    });
    expect((await alice.query(api.projects.get, { projectId: pid }))?.name).toBe("Spaced Title");
  });
});
