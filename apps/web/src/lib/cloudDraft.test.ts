import { describe, expect, it } from "vitest";
import {
  IDBFactory as FDBFactory,
  IDBObjectStore as FDBObjectStore,
} from "fake-indexeddb";
import {
  CloudDraftDataError,
  createCloudDraftRepository,
  type CloudDraft,
} from "@/lib/cloudDraft";

const DB = "alove-cloud-drafts";
const STORE = "drafts";

function newFactory(): IDBFactory {
  return new FDBFactory() as unknown as IDBFactory;
}

let seq = 0;

function makeDraft(overrides: Partial<CloudDraft> = {}): CloudDraft {
  seq += 1;
  return {
    userId: "user-a",
    projectId: "proj-a",
    tabId: `tab-${seq}`,
    files: { "main.tex": "\\documentclass{article}" },
    versions: { "main.tex": 1 },
    title: "Draft title",
    mainFile: "main.tex",
    updatedAt: 1000 + seq,
    ...overrides,
  };
}

function openRaw(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, {
          keyPath: ["userId", "projectId", "tabId"],
        });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putRaw(
  factory: IDBFactory,
  value: unknown,
): Promise<void> {
  const db = await openRaw(factory);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.objectStore(STORE).put(value);
  });
}

async function getRaw(
  factory: IDBFactory,
  userId: string,
  projectId: string,
  tabId: string,
): Promise<unknown> {
  const db = await openRaw(factory);
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get([userId, projectId, tabId]);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

describe("cloudDraftRepository", () => {
  it("roundtrips a full draft", async () => {
    const factory = newFactory();
    const repo = createCloudDraftRepository(factory);
    const draft = makeDraft({
      userId: "u1",
      projectId: "p1",
      tabId: "t1",
      files: { "main.tex": "hello", "chapters/intro.tex": "world" },
      versions: { "main.tex": 3, "chapters/intro.tex": 0 },
      title: "My draft",
      mainFile: "main.tex",
      updatedAt: 12345,
    });
    await repo.save(draft);
    const loaded = await repo.load("u1", "p1", "t1");
    expect(loaded).toEqual(draft);
    expect(await repo.load("u1", "p1", "missing")).toBeNull();
  });

  it("separates per user, project, and tab without concat collisions", async () => {
    const factory = newFactory();
    const repo = createCloudDraftRepository(factory);
    const a = makeDraft({
      userId: "a/b",
      projectId: "c",
      tabId: "t",
      title: "first",
    });
    const b = makeDraft({
      userId: "a",
      projectId: "b/c",
      tabId: "t",
      title: "second",
    });
    const c = makeDraft({
      userId: "a/b",
      projectId: "c",
      tabId: "other",
      title: "third",
    });
    await repo.save(a);
    await repo.save(b);
    await repo.save(c);
    expect((await repo.load("a/b", "c", "t"))?.title).toBe("first");
    expect((await repo.load("a", "b/c", "t"))?.title).toBe("second");
    expect((await repo.load("a/b", "c", "other"))?.title).toBe("third");
    expect(await repo.load("a/b", "c", "missing")).toBeNull();
  });

  it("snapshots save input before first await so later mutations cannot leak", async () => {
    const factory = newFactory();
    const repo = createCloudDraftRepository(factory);
    const input = makeDraft({
      userId: "u-snap",
      projectId: "p-snap",
      tabId: "t-snap",
    });
    const pending = repo.save(input);
    input.files["main.tex"] = "MUTATED WHILE SAVING";
    input.versions["main.tex"] = 999;
    input.title = "MUTATED TITLE";
    await pending;
    const loaded = await repo.load("u-snap", "p-snap", "t-snap");
    expect(loaded?.files["main.tex"]).toBe("\\documentclass{article}");
    expect(loaded?.versions["main.tex"]).toBe(1);
    expect(loaded?.title).toBe("Draft title");
  });

  it("returns detached rows so load mutations cannot affect later reads", async () => {
    const factory = newFactory();
    const repo = createCloudDraftRepository(factory);
    await repo.save(
      makeDraft({ userId: "u-detach", projectId: "p-detach", tabId: "t1" }),
    );
    const first = await repo.load("u-detach", "p-detach", "t1");
    expect(first).not.toBeNull();
    first!.files["main.tex"] = "MUTATED";
    first!.versions["main.tex"] = 999;
    first!.title = "MUTATED";
    const second = await repo.load("u-detach", "p-detach", "t1");
    expect(second?.files["main.tex"]).toBe("\\documentclass{article}");
    expect(second?.versions["main.tex"]).toBe(1);
    expect(second?.title).toBe("Draft title");
  });

  it("removes only the exact requested record", async () => {
    const factory = newFactory();
    const repo = createCloudDraftRepository(factory);
    await repo.save(
      makeDraft({ userId: "u", projectId: "p", tabId: "t1", title: "one" }),
    );
    await repo.save(
      makeDraft({ userId: "u", projectId: "p", tabId: "t2", title: "two" }),
    );
    await repo.save(
      makeDraft({ userId: "u", projectId: "other", tabId: "t1", title: "three" }),
    );
    await repo.remove("u", "p", "t1");
    expect(await repo.load("u", "p", "t1")).toBeNull();
    expect((await repo.load("u", "p", "t2"))?.title).toBe("two");
    expect((await repo.load("u", "other", "t1"))?.title).toBe("three");
    await expect(repo.remove("u", "p", "missing")).resolves.toBeUndefined();
  });

  it("rejects unsafe paths, bad versions, and oversize drafts", async () => {
    const factory = newFactory();
    const repo = createCloudDraftRepository(factory);
    const base = makeDraft({ userId: "u-v", projectId: "p-v", tabId: "t-v" });

    await expect(
      repo.save({ ...base, files: { "../evil.tex": "x" }, versions: {} }),
    ).rejects.toBeInstanceOf(CloudDraftDataError);
    await expect(
      repo.save({
        ...base,
        files: { "main.tex": "x" },
        versions: { "main.tex": -1 },
      }),
    ).rejects.toBeInstanceOf(CloudDraftDataError);
    await expect(
      repo.save({
        ...base,
        files: { "main.tex": "x" },
        versions: { "other.tex": 1 },
      }),
    ).rejects.toBeInstanceOf(CloudDraftDataError);
    await expect(
      repo.save({ ...base, mainFile: "missing.tex" }),
    ).rejects.toBeInstanceOf(CloudDraftDataError);
    expect(await repo.load("u-v", "p-v", "t-v")).toBeNull();

    const big = makeDraft({
      userId: "u-big",
      projectId: "p-big",
      tabId: "t-big",
      files: { "main.tex": "a".repeat(20 * 1024 * 1024 + 1) },
      versions: { "main.tex": 1 },
    });
    await expect(repo.save(big)).rejects.toBeInstanceOf(CloudDraftDataError);
    expect(await repo.load("u-big", "p-big", "t-big")).toBeNull();
  });

  it("rejects when IndexedDB is unavailable", async () => {
    const previous = (globalThis as unknown as Record<string, unknown>)[
      "indexedDB"
    ];
    try {
      delete (globalThis as unknown as Record<string, unknown>)["indexedDB"];
      const repo = createCloudDraftRepository();
      await expect(repo.load("u", "p", "t")).rejects.toThrow();
      await expect(repo.save(makeDraft())).rejects.toThrow();
      await expect(repo.remove("u", "p", "t")).rejects.toThrow();
    } finally {
      if (previous !== undefined) {
        (globalThis as unknown as Record<string, unknown>)["indexedDB"] =
          previous;
      }
    }
  });

  it("resolves the default factory at operation time", async () => {
    const previous = (globalThis as unknown as Record<string, unknown>)[
      "indexedDB"
    ];
    const repo = createCloudDraftRepository();
    try {
      (globalThis as unknown as Record<string, unknown>)["indexedDB"] =
        newFactory();
      const draft = makeDraft({
        userId: "u-late",
        projectId: "p-late",
        tabId: "t-late",
      });
      await repo.save(draft);
      expect(
        (await repo.load("u-late", "p-late", "t-late"))?.title,
      ).toBe(draft.title);
    } finally {
      if (previous !== undefined) {
        (globalThis as unknown as Record<string, unknown>)["indexedDB"] =
          previous;
      } else {
        delete (globalThis as unknown as Record<string, unknown>)["indexedDB"];
      }
    }
  });

  it("never reports success for an aborted write", async () => {
    const factory = newFactory();
    const repo = createCloudDraftRepository(factory);
    const original = makeDraft({
      userId: "u-abort",
      projectId: "p-abort",
      tabId: "keep",
      title: "keep",
    });
    await repo.save(original);
    const proto = FDBObjectStore.prototype as unknown as Record<
      string,
      unknown
    >;
    const originalPut = proto["put"] as (...args: unknown[]) => IDBRequest;
    proto["put"] = function (...args: unknown[]) {
      const store = this as unknown as { transaction: IDBTransaction };
      const req = (
        originalPut as (...a: unknown[]) => IDBRequest
      ).apply(this, args);
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
        repo.save(
          makeDraft({
            userId: "u-abort",
            projectId: "p-abort",
            tabId: "aborted",
            title: "aborted",
          }),
        ),
      ).rejects.toThrow();
    } finally {
      proto["put"] = originalPut;
    }
    expect(
      (await repo.load("u-abort", "p-abort", "keep"))?.title,
    ).toBe("keep");
    expect(await repo.load("u-abort", "p-abort", "aborted")).toBeNull();
  });

  it("throws on corrupt rows without overwriting or deleting bytes", async () => {
    const factory = newFactory();
    const repo = createCloudDraftRepository(factory);
    const corrupt = {
      userId: "u-corrupt",
      projectId: "p-corrupt",
      tabId: "t-corrupt",
      files: { "../evil.tex": "x" },
      versions: {},
      title: "corrupt",
      mainFile: null,
      updatedAt: 1,
    };
    await putRaw(factory, corrupt);
    const before = await getRaw(factory, "u-corrupt", "p-corrupt", "t-corrupt");
    await expect(
      repo.load("u-corrupt", "p-corrupt", "t-corrupt"),
    ).rejects.toBeInstanceOf(CloudDraftDataError);
    expect(await getRaw(factory, "u-corrupt", "p-corrupt", "t-corrupt")).toEqual(
      before,
    );

    const other = makeDraft({
      userId: "u-corrupt",
      projectId: "p-corrupt",
      tabId: "t-other",
      title: "other",
    });
    await repo.save(other);
    expect(
      (await repo.load("u-corrupt", "p-corrupt", "t-other"))?.title,
    ).toBe("other");
    expect(await getRaw(factory, "u-corrupt", "p-corrupt", "t-corrupt")).toEqual(
      before,
    );
  });
});


describe("draft write ordering", () => {
  it("retains the newest snapshot when an older unload write arrives late", async () => {
    const repo = createCloudDraftRepository(newFactory());
    const current = makeDraft({ tabId: "ordered-tab", updatedAt: 200, files: { "main.tex": "new text" } });
    await repo.save(current);
    await repo.save({ ...current, updatedAt: 100, files: { "main.tex": "old text" } });
    expect((await repo.load(current.userId, current.projectId, current.tabId))?.files["main.tex"]).toBe("new text");
  });
});
