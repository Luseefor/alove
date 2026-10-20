import { describe, expect, it } from "vitest";
import {
  IDBFactory as FDBFactory,
  IDBObjectStore as FDBObjectStore,
} from "fake-indexeddb";
import {
  BuildRecordConflictError,
  BuildRecordDataError,
  createBuildRecordRepository,
} from "@/lib/buildRecordRepository";
import type { BuildRecord } from "@/lib/buildRecord";

const DB = "alove-build-records-v1";

function newFactory(): IDBFactory {
  return new FDBFactory() as unknown as IDBFactory;
}

let seq = 0;

function makeRecord(overrides: Partial<BuildRecord> = {}): BuildRecord {
  seq += 1;
  return {
    schema: 1,
    id: `rec-${seq}`,
    projectId: "proj-a",
    revision: 1,
    startedAt: 1000,
    completedAt: 1000 + seq,
    sourceHash: `hash-${seq}`,
    mainFile: "main.tex",
    engine: "pdflatex",
    cleanAux: false,
    files: { "main.tex": "\\documentclass{article}" },
    result: {
      ok: false,
      log: "log",
      diagnostics: [],
    },
    ...overrides,
  } as BuildRecord;
}

function openRaw(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("records")) {
        const store = db.createObjectStore("records", { keyPath: "id" });
        store.createIndex("projectId", "projectId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putRaw(factory: IDBFactory, value: unknown): Promise<void> {
  const db = await openRaw(factory);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("records", "readwrite");
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.objectStore("records").put(value);
  });
}

async function getRaw(factory: IDBFactory, id: string): Promise<unknown> {
  const db = await openRaw(factory);
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction("records", "readonly");
      const req = tx.objectStore("records").get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function countRaw(factory: IDBFactory, projectId: string): Promise<number> {
  const db = await openRaw(factory);
  try {
    return await new Promise<number>((resolve, reject) => {
      const tx = db.transaction("records", "readonly");
      const req = tx.objectStore("records").index("projectId").getAll(projectId);
      req.onsuccess = () => resolve((req.result as unknown[]).length);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

describe("buildRecordRepository", () => {
  it("saves and lists newest-first", async () => {
    const factory = newFactory();
    const repo = createBuildRecordRepository(factory);
    const a = makeRecord({ id: "a", completedAt: 10, projectId: "p1" });
    const b = makeRecord({ id: "b", completedAt: 30, projectId: "p1" });
    const c = makeRecord({ id: "c", completedAt: 20, projectId: "p1" });
    await repo.save(a);
    await repo.save(b);
    await repo.save(c);
    const listed = await repo.list("p1");
    expect(listed.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("treats identical id writes as idempotent and rejects divergent content", async () => {
    const factory = newFactory();
    const repo = createBuildRecordRepository(factory);
    const original = makeRecord({ id: "same", completedAt: 50, result: { ok: true, log: "ok", diagnostics: [] } });
    await repo.save(original);
    await expect(repo.save({ ...original })).resolves.toBeUndefined();
    expect(await countRaw(factory, original.projectId)).toBe(1);

    const divergent = makeRecord({
      id: "same",
      projectId: original.projectId,
      completedAt: 51,
      result: { ok: false, log: "changed", diagnostics: [] },
    });
    await expect(repo.save(divergent)).rejects.toBeInstanceOf(
      BuildRecordConflictError,
    );
    const stored = (await getRaw(factory, "same")) as BuildRecord;
    expect(stored.completedAt).toBe(50);
    expect(stored.result.ok).toBe(true);
  });

  it("persists concurrent records for the same project", async () => {
    const factory = newFactory();
    const repo = createBuildRecordRepository(factory);
    const records = Array.from({ length: 5 }, (_, i) =>
      makeRecord({ id: `conc-${i}`, completedAt: 100 + i }),
    );
    await Promise.all(records.map((r) => repo.save(r)));
    const listed = await repo.list(records[0].projectId);
    expect(listed).toHaveLength(5);
    expect(new Set(listed.map((r) => r.id))).toEqual(
      new Set(records.map((r) => r.id)),
    );
  });

  it("isolates projects", async () => {
    const factory = newFactory();
    const repo = createBuildRecordRepository(factory);
    await repo.save(makeRecord({ id: "x1", projectId: "px", completedAt: 1 }));
    await repo.save(makeRecord({ id: "y1", projectId: "py", completedAt: 2 }));
    await repo.save(makeRecord({ id: "x2", projectId: "px", completedAt: 3 }));
    expect((await repo.list("px")).map((r) => r.id)).toEqual(["x2", "x1"]);
    expect((await repo.list("py")).map((r) => r.id)).toEqual(["y1"]);
    expect(await repo.list("missing")).toEqual([]);
  });

  it("retains max 20 records while pinning newest and most recent success", async () => {
    const factory = newFactory();
    const repo = createBuildRecordRepository(factory);
    const projectId = "retention";
    const oldestGood = makeRecord({
      id: "r-00",
      projectId,
      completedAt: 1000,
      result: { ok: true, log: "good", diagnostics: [] },
    });
    await repo.save(oldestGood);
    for (let i = 1; i <= 20; i++) {
      const id = `r-${String(i).padStart(2, "0")}`;
      await repo.save(
        makeRecord({ id, projectId, completedAt: 1000 + i, result: { ok: false, log: `f${i}`, diagnostics: [] } }),
      );
    }
    const newest = makeRecord({
      id: "r-21",
      projectId,
      completedAt: 2000,
      result: { ok: false, log: "newest", diagnostics: [] },
    });
    await repo.save(newest);

    const listed = await repo.list(projectId);
    expect(listed).toHaveLength(20);
    const ids = new Set(listed.map((r) => r.id));
    expect(ids.has("r-21")).toBe(true);
    expect(ids.has("r-00")).toBe(true);
    expect(ids.has("r-01")).toBe(false);
    expect(ids.has("r-02")).toBe(false);
    expect(listed[0].id).toBe("r-21");
  });

  it("rejects records with PDF fields and never deletes corrupt rows", async () => {
    const factory = newFactory();
    const repo = createBuildRecordRepository(factory);
    const pdfRecord = makeRecord({ id: "pdf-1" }) as unknown as Record<string, unknown>;
    (pdfRecord["result"] as Record<string, unknown>)["pdfBase64"] = "JVBERi0=";
    await expect(repo.save(pdfRecord as unknown as BuildRecord)).rejects.toBeInstanceOf(
      BuildRecordDataError,
    );
    expect(await countRaw(factory, "proj-a")).toBe(0);

    const corrupt = {
      schema: 99,
      id: "bad-1",
      projectId: "proj-a",
      revision: 1,
      startedAt: 1,
      completedAt: 2,
      sourceHash: "h",
      mainFile: "main.tex",
      engine: "pdflatex",
      cleanAux: false,
      files: { "main.tex": "x" },
      result: { ok: false, log: "x", diagnostics: [] },
    };
    await putRaw(factory, corrupt);
    const before = await getRaw(factory, "bad-1");
    await expect(repo.list("proj-a")).rejects.toBeInstanceOf(BuildRecordDataError);
    expect(await getRaw(factory, "bad-1")).toEqual(before);
    await expect(
      repo.save(makeRecord({ id: "good-after", projectId: "proj-a", completedAt: 9999 })),
    ).rejects.toBeInstanceOf(BuildRecordDataError);
    expect(await getRaw(factory, "bad-1")).toEqual(before);
  });

  it("never reports success for an aborted write", async () => {
    const factory = newFactory();
    const repo = createBuildRecordRepository(factory);
    const original = makeRecord({ id: "keep", completedAt: 10 });
    await repo.save(original);
    const proto = FDBObjectStore.prototype as unknown as Record<string, unknown>;
    const originalPut = proto["put"] as (...args: unknown[]) => IDBRequest;
    proto["put"] = function (...args: unknown[]) {
      const store = this as unknown as { transaction: IDBTransaction };
      const req = (originalPut as (...a: unknown[]) => IDBRequest).apply(this, args);
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
        repo.save(makeRecord({ id: "aborted", completedAt: 11 })),
      ).rejects.toThrow();
    } finally {
      proto["put"] = originalPut;
    }
    const listed = await repo.list(original.projectId);
    expect(listed.map((r) => r.id)).toEqual(["keep"]);
  });

  it("rejects when IndexedDB is unavailable", async () => {
    const previous = (globalThis as unknown as Record<string, unknown>)["indexedDB"];
    try {
      delete (globalThis as unknown as Record<string, unknown>)["indexedDB"];
      const repo = createBuildRecordRepository();
      await expect(repo.list("proj-a")).rejects.toThrow();
      await expect(repo.save(makeRecord())).rejects.toThrow();
    } finally {
      if (previous !== undefined) {
        (globalThis as unknown as Record<string, unknown>)["indexedDB"] = previous;
      }
    }
  });

  it("resolves the default factory at operation time", async () => {
    const previous = (globalThis as unknown as Record<string, unknown>)["indexedDB"];
    const repo = createBuildRecordRepository();
    try {
      (globalThis as unknown as Record<string, unknown>)["indexedDB"] =
        newFactory();
      const record = makeRecord({ id: "late-bind", projectId: "late" });
      await repo.save(record);
      expect((await repo.list("late")).map((r) => r.id)).toEqual(["late-bind"]);
    } finally {
      if (previous !== undefined) {
        (globalThis as unknown as Record<string, unknown>)["indexedDB"] = previous;
      } else {
        delete (globalThis as unknown as Record<string, unknown>)["indexedDB"];
      }
    }
  });

  it("snapshots save input before first await so later mutations cannot leak", async () => {
    const factory = newFactory();
    const repo = createBuildRecordRepository(factory);
    const input = makeRecord({
      id: "snapshot-mutate",
      projectId: "snap-proj",
      completedAt: 500,
    });
    const pending = repo.save(input);
    input.files["main.tex"] = "MUTATED WHILE SAVING";
    input.result.log = "MUTATED LOG";
    input.result.diagnostics.push({ severity: "error", message: "mutated" });
    await pending;
    const listed = await repo.list("snap-proj");
    expect(listed).toHaveLength(1);
    expect(listed[0].files["main.tex"]).toBe("\\documentclass{article}");
    expect(listed[0].result.log).toBe("log");
    expect(listed[0].result.diagnostics).toEqual([]);
  });

  it("returns detached list rows so nested mutations cannot affect later reads", async () => {
    const factory = newFactory();
    const repo = createBuildRecordRepository(factory);
    await repo.save(
      makeRecord({ id: "detach-1", projectId: "detach-proj", completedAt: 10 }),
    );
    const first = await repo.list("detach-proj");
    expect(first).toHaveLength(1);
    first[0].files["main.tex"] = "MUTATED";
    first[0].result.log = "MUTATED";
    first[0].result.diagnostics.push({ severity: "error", message: "mutated" });
    const second = await repo.list("detach-proj");
    expect(second).toHaveLength(1);
    expect(second[0].files["main.tex"]).toBe("\\documentclass{article}");
    expect(second[0].result.log).toBe("log");
    expect(second[0].result.diagnostics).toEqual([]);
  });
});

describe("legacy history compatibility",()=>{
  it("treats omitted optional fields like undefined when checking immutable IDs",async()=>{
    const factory=newFactory();const repo=createBuildRecordRepository(factory);
    const record=makeRecord();record.result.errorCode=undefined;record.result.environment=undefined;
    const legacy=JSON.parse(JSON.stringify(record));
    await putRaw(factory,legacy);
    await expect(repo.save(record)).resolves.toBeUndefined();
    expect(await getRaw(factory,record.id)).toEqual(legacy);
    await expect(repo.save({...record,files:{"main.tex":"changed"}})).rejects.toBeInstanceOf(BuildRecordConflictError);
  });
});


describe("sandbox policy storage",()=>{
  it("preserves the sandbox identity without requiring a database migration",async()=>{
    const repo=createBuildRecordRepository(newFactory());
    const record=makeRecord();
    record.result.environment={mode:"docker",runtimeId:"sha256:test",platform:"linux/amd64",policyId:"alove-tex-sandbox-v1:test"};
    await repo.save(record);
    expect((await repo.list(record.projectId))[0].result.environment).toEqual(record.result.environment);
  });
  it("refuses malformed policy metadata without deleting the original row",async()=>{
    const factory=newFactory();const repo=createBuildRecordRepository(factory);
    const row=makeRecord();
    const malformed={...row,result:{...row.result,environment:{mode:"docker",runtimeId:"sha256:test",platform:"linux/amd64",policyId:42}}};
    await putRaw(factory,malformed);
    await expect(repo.list(row.projectId)).rejects.toBeInstanceOf(BuildRecordDataError);
    expect(await getRaw(factory,row.id)).toEqual(malformed);
  });
});
