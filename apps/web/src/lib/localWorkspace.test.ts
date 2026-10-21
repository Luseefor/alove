import { describe, expect, it } from "vitest";
import {
  IDBFactory as FDBFactory,
  IDBObjectStore as FDBObjectStore,
} from "fake-indexeddb";
import {
  createLocalWorkspaceRepository,
  LocalWorkspaceConflictError,
  LocalWorkspaceDataError,
  type LocalWorkspaceInput,
} from "@/lib/localWorkspace";

const DB_NAME = "alove-workspaces";

function newFactory(): IDBFactory {
  return new FDBFactory() as unknown as IDBFactory;
}

function makeInput(
  overrides: Partial<LocalWorkspaceInput> = {},
): LocalWorkspaceInput {
  return {
    id: "ws-1",
    title: "Test workspace",
    files: {
      "main.tex": "\\documentclass{article}",
      "chapters/intro.tex": "",
      "notes.txt": "",
    },
    mainFile: "main.tex",
    activeFile: "chapters/intro.tex",
    openFiles: ["main.tex", "chapters/intro.tex"],
    ...overrides,
  };
}

function openRaw(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("workspaces")) {
        db.createObjectStore("workspaces", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("checkpoints"))
        db.createObjectStore("checkpoints", {
          keyPath: ["id", "revision"],
        }).createIndex("id", "id");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putRaw(factory: IDBFactory, value: unknown): Promise<void> {
  const db = await openRaw(factory);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("workspaces", "readwrite");
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.objectStore("workspaces").put(value);
  });
}

async function getRaw(factory: IDBFactory, id: string): Promise<unknown> {
  const db = await openRaw(factory);
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction("workspaces", "readonly");
      const req = tx.objectStore("workspaces").get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

describe("localWorkspace repository", () => {
  it("roundtrips nested and empty files", async () => {
    const factory = newFactory();
    const repo = createLocalWorkspaceRepository(factory);
    const input = makeInput();
    const saved = await repo.save(input, 0);
    expect(saved.schemaVersion).toBe(1);
    expect(saved.revision).toBe(1);
    expect(saved.files).toEqual(input.files);
    expect(saved.files["chapters/intro.tex"]).toBe("");

    const loaded = await repo.load("ws-1");
    expect(loaded).toMatchObject({
      id: "ws-1",
      title: input.title,
      files: input.files,
      mainFile: "main.tex",
      revision: 1,
    });

    const saved2 = await repo.save({ ...input, title: "v2" }, 1);
    expect(saved2.revision).toBe(2);
    expect(await repo.load("missing")).toBeNull();
  });

  it("allows only one concurrent writer with the same expectedRevision", async () => {
    const factory = newFactory();
    const repo = createLocalWorkspaceRepository(factory);
    await repo.save(makeInput(), 0);
    const base = makeInput();
    const results = await Promise.allSettled([
      repo.save({ ...base, title: "writer-a" }, 1),
      repo.save({ ...base, title: "writer-b" }, 1),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      LocalWorkspaceConflictError,
    );
    const current = await repo.load("ws-1");
    expect(current?.revision).toBe(2);
  });

  it("rejects stale revisions and retains the original", async () => {
    const factory = newFactory();
    const repo = createLocalWorkspaceRepository(factory);
    const original = await repo.save(makeInput({ title: "original" }), 0);
    await expect(
      repo.save(makeInput({ title: "stale" }), 0),
    ).rejects.toBeInstanceOf(LocalWorkspaceConflictError);
    const current = await repo.load("ws-1");
    expect(current).toMatchObject({
      title: "original",
      revision: original.revision,
    });
    expect(current?.files).toEqual(original.files);
  });

  it.each([
    [
      "invalid",
      {
        schemaVersion: 1,
        id: "ws-1",
        title: 42,
        files: "bad",
        mainFile: null,
        activeFile: null,
        openFiles: [],
        revision: 1,
        updatedAt: 1,
      },
    ],
    [
      "future",
      {
        schemaVersion: 99,
        id: "ws-1",
        title: "future",
        files: { "main.tex": "x" },
        mainFile: "main.tex",
        activeFile: null,
        openFiles: [],
        revision: 1,
        updatedAt: 1,
      },
    ],
  ])(
    "preserves bytes for %s schema on load and save",
    async (_label, corrupt) => {
      const factory = newFactory();
      const repo = createLocalWorkspaceRepository(factory);
      await putRaw(factory, corrupt);
      const before = await getRaw(factory, "ws-1");
      await expect(repo.load("ws-1")).rejects.toBeInstanceOf(
        LocalWorkspaceDataError,
      );
      expect(await getRaw(factory, "ws-1")).toEqual(before);
      await expect(repo.save(makeInput(), 0)).rejects.toBeInstanceOf(
        LocalWorkspaceDataError,
      );
      await expect(repo.save(makeInput(), 1)).rejects.toBeInstanceOf(
        LocalWorkspaceDataError,
      );
      expect(await getRaw(factory, "ws-1")).toEqual(before);
    },
  );

  it("rejects when IndexedDB storage is absent", async () => {
    const previous = (globalThis as unknown as Record<string, unknown>)
      .indexedDB;
    try {
      delete (globalThis as unknown as Record<string, unknown>).indexedDB;
      const repo = createLocalWorkspaceRepository();
      await expect(repo.load("ws-1")).rejects.toThrow();
      await expect(repo.save(makeInput(), 0)).rejects.toThrow();
    } finally {
      if (previous !== undefined) {
        (globalThis as unknown as Record<string, unknown>).indexedDB = previous;
      }
    }
  });

  it("never reports success for an aborted write", async () => {
    const factory = newFactory();
    const repo = createLocalWorkspaceRepository(factory);
    await repo.save(makeInput({ title: "original" }), 0);
    const proto = FDBObjectStore.prototype as unknown as Record<
      string,
      unknown
    >;
    const originalPut = proto.put as (...args: unknown[]) => IDBRequest;
    proto.put = function (...args: unknown[]) {
      const store = this as unknown as { transaction: IDBTransaction };
      const req = (originalPut as (...a: unknown[]) => IDBRequest).apply(
        this,
        args,
      );
      queueMicrotask(() => {
        try {
          store.transaction.abort();
        } catch {
          // Ignore abort failures.
        }
      });
      return req;
    };
    try {
      await expect(
        repo.save(makeInput({ title: "aborted" }), 1),
      ).rejects.toThrow();
    } finally {
      proto.put = originalPut;
    }
    const current = await repo.load("ws-1");
    expect(current).toMatchObject({ title: "original", revision: 1 });
  });
});

describe("workspace library operations", () => {
  it("lists durable metadata without source and deletes only the expected revision", async () => {
    const repo = createLocalWorkspaceRepository(newFactory());
    const saved = await repo.save(makeInput(), 0);
    expect(await repo.list()).toEqual([
      {
        id: saved.id,
        title: saved.title,
        mainFile: saved.mainFile,
        updatedAt: saved.updatedAt,
        revision: 1,
        fileCount: 3,
      },
    ]);
    const newer = await repo.save(makeInput({ title: "Updated" }), 1);
    await expect(repo.remove(saved.id, 1)).rejects.toBeInstanceOf(
      LocalWorkspaceConflictError,
    );
    expect((await repo.load(saved.id))?.title).toBe("Updated");
    await repo.remove(saved.id, newer.revision);
    expect(await repo.list()).toEqual([]);
    expect(await repo.load(saved.id)).toBeNull();
  });
  it("keeps corrupt/future project data intact when listing or deleting fails", async () => {
    const factory = newFactory();
    const repo = createLocalWorkspaceRepository(factory);
    const corrupt = {
      ...makeInput(),
      schemaVersion: 99,
      revision: 4,
      updatedAt: 1,
    };
    await putRaw(factory, corrupt);
    expect((await repo.list())[0].unavailableReason).toMatch(/schema/i);
    await expect(repo.remove(corrupt.id, 4)).rejects.toBeInstanceOf(
      LocalWorkspaceDataError,
    );
    expect(await getRaw(factory, corrupt.id)).toEqual(corrupt);
  });
});

describe("workspace checkpoints", () => {
  it("checkpoints source replacements but not tab-only saves, and bounds retention", async () => {
    const repo = createLocalWorkspaceRepository(newFactory());
    let current = await repo.save(makeInput(), 0);
    current = await repo.save(
      { ...current, activeFile: "main.tex" },
      current.revision,
    );
    expect(await repo.listHistory(current.id)).toEqual([]);
    for (let i = 0; i < 25; i++) {
      current = await repo.save(
        {
          ...current,
          files: { "main.tex": `source ${i}` },
          activeFile: "main.tex",
          openFiles: ["main.tex"],
        },
        current.revision,
      );
    }
    const rows = await repo.listHistory(current.id);
    expect(rows).toHaveLength(20);
    expect(rows[0].files["main.tex"]).toBe("source 23");
    expect(rows[19].files["main.tex"]).toBe("source 4");
    expect(await repo.listHistory("unrelated")).toEqual([]);
  });

  it("atomically refuses replacement or deletion if its checkpoint cannot be written", async () => {
    const repo = createLocalWorkspaceRepository(newFactory());
    const original = await repo.save(makeInput(), 0);
    const proto = FDBObjectStore.prototype;
    const put = proto.put;
    proto.put = function (...args: Parameters<typeof put>) {
      if (this.name === "checkpoints")
        throw new DOMException("Full", "QuotaExceededError");
      return put.apply(this, args);
    };
    try {
      await expect(
        repo.save(
          {
            ...original,
            files: { "main.tex": "replace" },
            activeFile: "main.tex",
            openFiles: [],
          },
          1,
        ),
      ).rejects.toThrow("Full");
      await expect(repo.remove(original.id, 1)).rejects.toThrow("Full");
    } finally {
      proto.put = put;
    }
    expect(await repo.load(original.id)).toEqual(original);
    expect(await repo.listHistory(original.id)).toEqual([]);
  });

  it("keeps the last source of deleted projects available for recovery as a copy", async () => {
    const repo = createLocalWorkspaceRepository(newFactory());
    const original = await repo.save(makeInput(), 0);
    await repo.remove(original.id, 1);
    expect(await repo.listDeleted()).toEqual([original]);
    const restored = await repo.save({ ...original, id: "recovered-copy" }, 0);
    expect(restored.files).toEqual(original.files);
    expect(await repo.load(original.id)).toBeNull();
  });

  it("upgrades an existing v1 database without changing its workspace", async () => {
    const factory = newFactory();
    const original = {
      ...makeInput(),
      schemaVersion: 1,
      revision: 7,
      updatedAt: 1,
    };
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () =>
        req.result.createObjectStore("workspaces", { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
    });
    await new Promise<void>((resolve) => {
      const tx = db.transaction("workspaces", "readwrite");
      tx.objectStore("workspaces").put(original);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    });
    const repo = createLocalWorkspaceRepository(factory);
    expect(await repo.load(original.id)).toEqual(original);
    await repo.save({ ...original, title: "after upgrade" }, 7);
    expect(await repo.listHistory(original.id)).toEqual([original]);
  });
});

it("blocks replacement when its current-source checkpoint exceeds the history byte budget", async () => {
  const repo = createLocalWorkspaceRepository(newFactory());
  const input = makeInput({
    files: { "main.tex": "x".repeat(50 * 1024 * 1024) },
    activeFile: "main.tex",
    openFiles: [],
  });
  const current = await repo.save(input, 0);
  await expect(
    repo.save({ ...input, files: { "main.tex": "replacement" } }, 1),
  ).rejects.toThrow();
  expect((await repo.load(current.id))?.files["main.tex"].length).toBe(
    input.files["main.tex"].length,
  );
  expect(await repo.listHistory(current.id)).toEqual([]);
});
