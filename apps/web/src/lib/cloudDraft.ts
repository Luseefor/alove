import { normalizeCompilePath } from "@alove/protocol";

export type CloudDraft = {
  userId: string;
  projectId: string;
  tabId: string;
  files: Record<string, string>;
  versions: Record<string, number>;
  dirtyPaths?: string[];
  title: string;
  mainFile: string | null;
  updatedAt: number;
};

export class CloudDraftDataError extends Error {
  constructor(message = "Invalid cloud draft data") {
    super(message);
    this.name = "CloudDraftDataError";
  }
}

// Local browser backup only. There is no retention promise. A draft stays
// stored until save overwrites it or remove deletes it. The browser can evict
// IndexedDB at any time, so callers must treat a missing draft as normal.
const DEFAULT_DB = "alove-cloud-drafts";
const STORE = "drafts";
const MAX_SERIALIZED_BYTES = 20 * 1024 * 1024;

function fail(message: string): never {
  throw new CloudDraftDataError(message);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  return true;
}

function checkKeyPart(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) fail(`Invalid ${name}`);
}

function checkFiles(value: unknown): asserts value is Record<string, string> {
  if (!isPlainRecord(value)) fail("Invalid files");
  for (const [k, v] of Object.entries(value)) {
    if (normalizeCompilePath(k) !== k) fail("Invalid files");
    if (typeof v !== "string") fail("Invalid files");
  }
}

function checkVersions(
  value: unknown,
  files: Record<string, string>,
): asserts value is Record<string, number> {
  if (!isPlainRecord(value)) fail("Invalid versions");
  for (const [k, v] of Object.entries(value)) {
    if (normalizeCompilePath(k) !== k) fail("Invalid versions");
    if (!Object.hasOwn(files, k)) fail("Invalid versions");
    if (!Number.isSafeInteger(v) || (v as number) < 0) fail("Invalid versions");
  }
}

function checkDraft(value: unknown): asserts value is CloudDraft {
  if (!isPlainRecord(value)) fail("Invalid draft");
  const d = value as Record<string, unknown>;
  checkKeyPart(d["userId"], "userId");
  checkKeyPart(d["projectId"], "projectId");
  checkKeyPart(d["tabId"], "tabId");
  if (typeof d["title"] !== "string") fail("Invalid title");
  if (!isPlainRecord(d["files"])) fail("Invalid files");
  checkFiles(d["files"]);
  if (!isPlainRecord(d["versions"])) fail("Invalid versions");
  checkVersions(
    d["versions"],
    d["files"] as Record<string, string>,
  );
  if (d["dirtyPaths"] !== undefined && (!Array.isArray(d["dirtyPaths"]) || d["dirtyPaths"].some((path: unknown) => typeof path !== "string" || !Object.hasOwn(d["files"] as object, path)))) fail("Invalid dirty paths");
  const mainFile = d["mainFile"];
  if (mainFile !== null) {
    if (typeof mainFile !== "string") fail("Invalid mainFile");
    if (normalizeCompilePath(mainFile) !== mainFile) fail("Invalid mainFile");
    if (!Object.hasOwn(d["files"] as Record<string, string>, mainFile)) {
      fail("Invalid mainFile");
    }
  }
  if (
    typeof d["updatedAt"] !== "number" ||
    !Number.isFinite(d["updatedAt"] as number)
  ) {
    fail("Invalid updatedAt");
  }
}

const utf8Encoder = new TextEncoder();

function checkBudget(snapshot: CloudDraft): void {
  let json: string;
  try {
    json = JSON.stringify(snapshot);
  } catch {
    fail("Invalid draft");
  }
  if (utf8Encoder.encode(json).length > MAX_SERIALIZED_BYTES) {
    fail("Draft exceeds 20 MiB serialize budget");
  }
}

function snapshotDraft(draft: CloudDraft): CloudDraft {
  try {
    return structuredClone(draft);
  } catch {
    fail("Invalid draft");
  }
}

function openDb(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(name, 1);
    } catch (error) {
      reject(
        error instanceof Error
          ? error
          : new CloudDraftDataError("IndexedDB open failed"),
      );
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE)) return;
      db.createObjectStore(STORE, {
        keyPath: ["userId", "projectId", "tabId"],
      });
    };
    req.onsuccess = () => {
      const db = req.result;
      try {
        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            // Ignore close failures.
          }
        };
      } catch {
        // Ignore handler setup failures.
      }
      if (settled) {
        try {
          db.close();
        } catch {
          // Ignore close failures.
        }
        return;
      }
      settled = true;
      resolve(db);
    };
    req.onerror = () => {
      if (settled) return;
      settled = true;
      reject(req.error ?? new CloudDraftDataError("IndexedDB open failed"));
    };
    req.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new CloudDraftDataError("IndexedDB open blocked"));
    };
  });
}

export function createCloudDraftRepository(
  factory?: IDBFactory,
  databaseName?: string,
) {
  const dbName = databaseName ?? DEFAULT_DB;
  const resolveFactory = (): IDBFactory => {
    const effective =
      factory ??
      (globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB;
    if (!effective || typeof effective.open !== "function") {
      throw new CloudDraftDataError("IndexedDB unavailable");
    }
    return effective;
  };

  async function save(draft: CloudDraft): Promise<void> {
    const snapshot = snapshotDraft(draft);
    checkDraft(snapshot);
    checkBudget(snapshot);
    const db = await openDb(resolveFactory(), dbName);
    return new Promise<void>((resolve, reject) => {
      let done = false;
      const ok = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      const bad = (e: unknown) => {
        if (!done) {
          done = true;
          reject(e);
        }
      };
      const close = () => {
        try {
          db.close();
        } catch {
          // Ignore close failures.
        }
      };
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE, "readwrite");
      } catch (e) {
        close();
        bad(e);
        return;
      }
      let failure: unknown = null;
      tx.oncomplete = () => {
        close();
        if (failure) bad(failure);
        else ok();
      };
      tx.onerror = () => {
        close();
        bad(
          failure ??
            tx.error ??
            new CloudDraftDataError("Cloud draft save failed"),
        );
      };
      tx.onabort = () => {
        close();
        bad(
          failure ??
            tx.error ??
            new CloudDraftDataError("Cloud draft save aborted"),
        );
      };
      let store: IDBObjectStore;
      try {
        store = tx.objectStore(STORE);
      } catch (e) {
        failure = e;
        try {
          tx.abort();
        } catch {
          // Ignore abort failures.
        }
        return;
      }
      const current = store.get([snapshot.userId, snapshot.projectId, snapshot.tabId]);
      current.onerror = () => { failure = current.error ?? new CloudDraftDataError("Cloud draft read failed"); };
      current.onsuccess = () => {
        try {
          if (current.result !== undefined) {
            checkDraft(current.result);
            // A delayed unload backup must not replace a newer same-tab edit.
            if (current.result.updatedAt > snapshot.updatedAt) return;
          }
          const put = store.put(snapshot);
          put.onerror = () => { failure = put.error ?? new CloudDraftDataError("Cloud draft write failed"); };
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    });
  }

  async function load(
    userId: string,
    projectId: string,
    tabId: string,
  ): Promise<CloudDraft | null> {
    checkKeyPart(userId, "userId");
    checkKeyPart(projectId, "projectId");
    checkKeyPart(tabId, "tabId");
    const key = [userId, projectId, tabId];
    const db = await openDb(resolveFactory(), dbName);
    return new Promise<CloudDraft | null>((resolve, reject) => {
      let done = false;
      const ok = (v: CloudDraft | null) => {
        if (!done) {
          done = true;
          resolve(v);
        }
      };
      const bad = (e: unknown) => {
        if (!done) {
          done = true;
          reject(e);
        }
      };
      const close = () => {
        try {
          db.close();
        } catch {
          // Ignore close failures.
        }
      };
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE, "readonly");
      } catch (e) {
        close();
        bad(e);
        return;
      }
      let failure: unknown = null;
      let row: CloudDraft | null = null;
      let hasRow = false;
      tx.oncomplete = () => {
        close();
        if (failure) bad(failure);
        else if (hasRow) ok(row);
        else bad(new CloudDraftDataError("Cloud draft load failed"));
      };
      tx.onerror = () => {
        close();
        bad(
          failure ??
            tx.error ??
            new CloudDraftDataError("Cloud draft load failed"),
        );
      };
      tx.onabort = () => {
        close();
        bad(
          failure ??
            tx.error ??
            new CloudDraftDataError("Cloud draft load aborted"),
        );
      };
      let getReq: IDBRequest;
      try {
        getReq = tx.objectStore(STORE).get(key);
      } catch (e) {
        failure = e;
        try {
          tx.abort();
        } catch {
          // Ignore abort failures.
        }
        return;
      }
      getReq.onerror = () => {
        failure =
          getReq.error ?? new CloudDraftDataError("Cloud draft read failed");
        try {
          tx.abort();
        } catch {
          // Ignore abort failures.
        }
      };
      getReq.onsuccess = () => {
        try {
          const stored: unknown = getReq.result;
          if (stored === undefined || stored === null) {
            row = null;
            hasRow = true;
            return;
          }
          checkDraft(stored);
          row = stored as CloudDraft;
          hasRow = true;
        } catch (e) {
          failure = e;
          try {
            tx.abort();
          } catch {
            // Ignore abort failures.
          }
        }
      };
    });
  }

  async function remove(
    userId: string,
    projectId: string,
    tabId: string,
  ): Promise<void> {
    checkKeyPart(userId, "userId");
    checkKeyPart(projectId, "projectId");
    checkKeyPart(tabId, "tabId");
    const key = [userId, projectId, tabId];
    const db = await openDb(resolveFactory(), dbName);
    return new Promise<void>((resolve, reject) => {
      let done = false;
      const ok = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      const bad = (e: unknown) => {
        if (!done) {
          done = true;
          reject(e);
        }
      };
      const close = () => {
        try {
          db.close();
        } catch {
          // Ignore close failures.
        }
      };
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE, "readwrite");
      } catch (e) {
        close();
        bad(e);
        return;
      }
      let failure: unknown = null;
      tx.oncomplete = () => {
        close();
        if (failure) bad(failure);
        else ok();
      };
      tx.onerror = () => {
        close();
        bad(
          failure ??
            tx.error ??
            new CloudDraftDataError("Cloud draft remove failed"),
        );
      };
      tx.onabort = () => {
        close();
        bad(
          failure ??
            tx.error ??
            new CloudDraftDataError("Cloud draft remove aborted"),
        );
      };
      let store: IDBObjectStore;
      try {
        store = tx.objectStore(STORE);
      } catch (e) {
        failure = e;
        try {
          tx.abort();
        } catch {
          // Ignore abort failures.
        }
        return;
      }
      let delReq: IDBRequest;
      try {
        delReq = store.delete(key);
      } catch (e) {
        failure = e;
        try {
          tx.abort();
        } catch {
          // Ignore abort failures.
        }
        return;
      }
      delReq.onerror = () => {
        if (!failure) {
          failure =
            delReq.error ??
            new CloudDraftDataError("Cloud draft delete failed");
        }
      };
    });
  }

  return { save, load, remove };
}

export const cloudDraftRepository = createCloudDraftRepository();
