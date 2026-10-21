import { normalizeCompilePath } from "@alove/protocol";
export type LocalWorkspace = {
  schemaVersion: 1;
  id: string;
  title: string;
  files: Record<string, string>;
  mainFile: string | null;
  activeFile: string | null;
  openFiles: string[];
  revision: number;
  updatedAt: number;
};

export type LocalWorkspaceSummary = Pick<
  LocalWorkspace,
  "id" | "title" | "mainFile" | "updatedAt" | "revision"
> & { fileCount: number; unavailableReason?: string };

export type LocalWorkspaceInput = Omit<
  LocalWorkspace,
  "schemaVersion" | "revision" | "updatedAt"
>;

export class LocalWorkspaceConflictError extends Error {
  constructor(message = "Workspace revision conflict") {
    super(message);
    this.name = "LocalWorkspaceConflictError";
  }
}

export class LocalWorkspaceDataError extends Error {
  constructor(message = "Invalid workspace data") {
    super(message);
    this.name = "LocalWorkspaceDataError";
  }
}

const DEFAULT_DB = "alove-workspaces";
const STORE = "workspaces";
const HISTORY = "checkpoints";
export const MAX_WORKSPACE_CHECKPOINTS = 20;
export const MAX_WORKSPACE_HISTORY_BYTES = 50 * 1024 * 1024;

function sourceChanged(a: LocalWorkspaceInput, b: LocalWorkspaceInput) {
  return (
    a.title !== b.title ||
    a.mainFile !== b.mainFile ||
    JSON.stringify(Object.entries(a.files).sort()) !==
      JSON.stringify(Object.entries(b.files).sort())
  );
}

/** Called inside the same transaction as replacement/deletion: both commit or neither does. */
function checkpoint(tx: IDBTransaction, workspace: LocalWorkspace) {
  const history = tx.objectStore(HISTORY);
  history.put(workspace);
  const request = history.index("id").getAll(workspace.id);
  request.onsuccess = () => {
    const rows = (request.result as unknown[]).filter(
      (row): row is LocalWorkspace => {
        try {
          checkStored(row, workspace.id);
          return true;
        } catch {
          return false; /* Preserve unreadable history verbatim. */
        }
      },
    );
    rows.sort((a, b) => b.revision - a.revision);
    let bytes = 0;
    for (const [i, row] of rows.entries()) {
      const size = new TextEncoder().encode(JSON.stringify(row)).byteLength;
      // A single checkpoint too large for retention must block replacement.
      if (i === 0 && size > MAX_WORKSPACE_HISTORY_BYTES) {
        tx.abort();
        return;
      }
      bytes += size;
      if (i >= MAX_WORKSPACE_CHECKPOINTS || bytes > MAX_WORKSPACE_HISTORY_BYTES)
        history.delete([row.id, row.revision]);
    }
  };
}

function fail(message: string): never {
  throw new LocalWorkspaceDataError(message);
}

function checkFiles(value: unknown): asserts value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail("Invalid files");
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (normalizeCompilePath(k) !== k || typeof v !== "string")
      fail("Invalid files");
  }
}

function checkSelection(
  files: Record<string, string>,
  main: unknown,
  active: unknown,
  open: unknown,
): void {
  if (main !== null) {
    if (
      typeof main !== "string" ||
      !main ||
      !Object.hasOwn(files, main) ||
      !main.endsWith(".tex")
    )
      fail("Invalid mainFile");
  } else if (Object.keys(files).some((k) => k.endsWith(".tex"))) {
    fail("Invalid mainFile");
  }
  if (
    active !== null &&
    (typeof active !== "string" || !active || !Object.hasOwn(files, active))
  )
    fail("Invalid activeFile");
  if (!Array.isArray(open)) fail("Invalid openFiles");
  for (const p of open as unknown[]) {
    if (typeof p !== "string" || !p || !Object.hasOwn(files, p))
      fail("Invalid openFiles");
  }
}

function checkInput(input: unknown): asserts input is LocalWorkspaceInput {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    fail("Invalid workspace");
  const r = input as Record<string, unknown>;
  if (typeof r.id !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(r.id))
    fail("Invalid id");
  if (typeof r.title !== "string" || !r.title.trim() || r.title.length > 200)
    fail("Invalid title");
  checkFiles(r.files);
  checkSelection(
    r.files as Record<string, string>,
    r.mainFile,
    r.activeFile,
    r.openFiles,
  );
}

function checkStored(
  value: unknown,
  expectedId?: string,
): asserts value is LocalWorkspace {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail("Invalid stored workspace");
  const r = value as Record<string, unknown>;
  if (r.schemaVersion !== 1) fail("Unsupported schema version");
  if (typeof r.id !== "string" || !/^[a-zA-Z0-9_-]{1,120}$/.test(r.id))
    fail("Invalid id");
  if (expectedId !== undefined && r.id !== expectedId) fail("Mismatched id");
  if (typeof r.title !== "string" || !r.title.trim() || r.title.length > 200)
    fail("Invalid title");
  checkFiles(r.files);
  checkSelection(
    r.files as Record<string, string>,
    r.mainFile,
    r.activeFile,
    r.openFiles,
  );
  if (!Number.isSafeInteger(r.revision) || (r.revision as number) < 0)
    fail("Invalid revision");
  if (typeof r.updatedAt !== "number" || !Number.isFinite(r.updatedAt))
    fail("Invalid updatedAt");
}

function openDb(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(name, 2);
    } catch (error) {
      reject(
        error instanceof Error
          ? error
          : new LocalWorkspaceDataError("IndexedDB open failed"),
      );
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(HISTORY)) {
        db.createObjectStore(HISTORY, {
          keyPath: ["id", "revision"],
        }).createIndex("id", "id");
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      try {
        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            /* ignore */
          }
        };
      } catch {
        /* ignore */
      }
      if (settled) {
        try {
          db.close();
        } catch {
          /* ignore */
        }
        return;
      }
      settled = true;
      resolve(db);
    };
    req.onerror = () => {
      if (settled) return;
      settled = true;
      reject(req.error ?? new LocalWorkspaceDataError("IndexedDB open failed"));
    };
    req.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new LocalWorkspaceDataError("IndexedDB open blocked"));
    };
  });
}

export function createLocalWorkspaceRepository(
  factory?: IDBFactory,
  databaseName?: string,
) {
  const dbName = databaseName ?? DEFAULT_DB;
  const resolveFactory = (): IDBFactory => {
    const effective =
      factory ??
      (globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB;
    if (!effective || typeof effective.open !== "function")
      throw new LocalWorkspaceDataError("IndexedDB unavailable");
    return effective;
  };

  async function load(id: string): Promise<LocalWorkspace | null> {
    if (typeof id !== "string" || !id)
      throw new LocalWorkspaceDataError("Invalid id");
    const db = await openDb(resolveFactory(), dbName);
    return new Promise<LocalWorkspace | null>((resolve, reject) => {
      let done = false;
      const ok = (v: LocalWorkspace | null) => {
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
      let tx: IDBTransaction;
      try {
        tx = db.transaction(STORE, "readonly");
      } catch (e) {
        try {
          db.close();
        } catch {
          /* ignore */
        }
        bad(e);
        return;
      }
      const close = () => {
        try {
          db.close();
        } catch {
          /* ignore */
        }
      };
      tx.oncomplete = () => close();
      tx.onerror = () => {
        close();
        bad(tx.error ?? new LocalWorkspaceDataError("Workspace load failed"));
      };
      tx.onabort = () => {
        close();
        bad(tx.error ?? new LocalWorkspaceDataError("Workspace load aborted"));
      };
      let req: IDBRequest;
      try {
        req = tx.objectStore(STORE).get(id);
      } catch (e) {
        try {
          tx.abort();
        } catch {
          /* ignore */
        }
        bad(e);
        return;
      }
      req.onerror = () =>
        bad(req.error ?? new LocalWorkspaceDataError("Workspace load failed"));
      req.onsuccess = () => {
        try {
          const stored: unknown = req.result;
          if (stored === undefined || stored === null) {
            ok(null);
            return;
          }
          checkStored(stored, id);
          ok(stored);
        } catch (e) {
          bad(e);
        }
      };
    });
  }

  async function save(
    input: LocalWorkspaceInput,
    expectedRevision: number,
  ): Promise<LocalWorkspace> {
    checkInput(input);
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      expectedRevision >= Number.MAX_SAFE_INTEGER
    )
      throw new LocalWorkspaceDataError("Invalid expectedRevision");
    const db = await openDb(resolveFactory(), dbName);
    return new Promise<LocalWorkspace>((resolve, reject) => {
      let done = false;
      const ok = (v: LocalWorkspace) => {
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
      let tx: IDBTransaction;
      try {
        tx = db.transaction([STORE, HISTORY], "readwrite");
      } catch (e) {
        try {
          db.close();
        } catch {
          /* ignore */
        }
        bad(e);
        return;
      }
      let saved: LocalWorkspace | null = null;
      let failure: unknown = null;
      const close = () => {
        try {
          db.close();
        } catch {
          /* ignore */
        }
      };
      tx.oncomplete = () => {
        close();
        if (failure) bad(failure);
        else if (saved) ok(saved);
        else bad(new LocalWorkspaceDataError("Workspace save failed"));
      };
      tx.onerror = () => {
        close();
        bad(
          failure ??
            tx.error ??
            new LocalWorkspaceDataError("Workspace save failed"),
        );
      };
      tx.onabort = () => {
        close();
        bad(
          failure ??
            tx.error ??
            new LocalWorkspaceDataError("Workspace save aborted"),
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
          /* ignore */
        }
        return;
      }
      let getReq: IDBRequest;
      try {
        getReq = store.get(input.id);
      } catch (e) {
        failure = e;
        try {
          tx.abort();
        } catch {
          /* ignore */
        }
        return;
      }
      getReq.onerror = () => {
        failure =
          getReq.error ?? new LocalWorkspaceDataError("Workspace read failed");
        try {
          tx.abort();
        } catch {
          /* ignore */
        }
      };
      getReq.onsuccess = () => {
        try {
          const stored: unknown = getReq.result;
          if (stored !== undefined && stored !== null) {
            checkStored(stored, input.id);
            const current = (stored as LocalWorkspace).revision;
            if (current !== expectedRevision)
              throw new LocalWorkspaceConflictError(
                `Stale revision: expected ${expectedRevision}, found ${current}`,
              );
          } else if (expectedRevision !== 0) {
            throw new LocalWorkspaceConflictError(
              `Stale revision: expected ${expectedRevision}, workspace absent`,
            );
          }
          const next: LocalWorkspace = {
            schemaVersion: 1,
            id: input.id,
            title: input.title,
            files: { ...(input.files as Record<string, string>) },
            mainFile: input.mainFile,
            activeFile: input.activeFile,
            openFiles: [...input.openFiles],
            revision: expectedRevision + 1,
            updatedAt: Date.now(),
          };
          if (stored && sourceChanged(stored as LocalWorkspace, next))
            checkpoint(tx, stored as LocalWorkspace);
          let putReq: IDBRequest;
          try {
            putReq = store.put(next);
          } catch (e) {
            failure = e;
            try {
              tx.abort();
            } catch {
              /* ignore */
            }
            return;
          }
          putReq.onerror = () => {
            failure =
              putReq.error ??
              new LocalWorkspaceDataError("Workspace write failed");
          };
          putReq.onsuccess = () => {
            saved = next;
          };
        } catch (e) {
          failure = e;
          try {
            tx.abort();
          } catch {
            /* ignore */
          }
        }
      };
    });
  }

  async function list(): Promise<LocalWorkspaceSummary[]> {
    const db = await openDb(resolveFactory(), dbName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const summaries: LocalWorkspaceSummary[] = [];
      let failure: unknown;
      tx.oncomplete = () => {
        db.close();
        resolve(
          summaries.sort(
            (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
          ),
        );
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(
          failure ??
            tx.error ??
            new LocalWorkspaceDataError("Could not list projects"),
        );
      };
      const request = tx.objectStore(STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        try {
          checkStored(cursor.value);
          const row = cursor.value as LocalWorkspace;
          summaries.push({
            id: row.id,
            title: row.title,
            mainFile: row.mainFile,
            updatedAt: row.updatedAt,
            revision: row.revision,
            fileCount: Object.keys(row.files).length,
          });
          cursor.continue();
        } catch (error) {
          summaries.push({
            id: String(cursor.primaryKey),
            title: "Unavailable stored project",
            mainFile: null,
            updatedAt: 0,
            revision: 0,
            fileCount: 0,
            unavailableReason:
              error instanceof Error ? error.message : "Invalid project data",
          });
          cursor.continue();
        }
      };
    });
  }

  async function remove(id: string, expectedRevision: number): Promise<void> {
    if (!id || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      fail("Invalid delete request");
    const db = await openDb(resolveFactory(), dbName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE, HISTORY], "readwrite");
      let failure: unknown;
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(
          failure ??
            tx.error ??
            new LocalWorkspaceDataError("Could not delete project"),
        );
      };
      const store = tx.objectStore(STORE);
      const request = store.get(id);
      request.onsuccess = () => {
        try {
          if (request.result === undefined)
            throw new LocalWorkspaceConflictError(
              "Project was already removed. Refresh the list.",
            );
          checkStored(request.result, id);
          if (request.result.revision !== expectedRevision)
            throw new LocalWorkspaceConflictError(
              "Project changed in another tab. Refresh before deleting.",
            );
          checkpoint(tx, request.result as LocalWorkspace);
          store.delete(id);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    });
  }

  async function listHistory(id: string): Promise<LocalWorkspace[]> {
    const db = await openDb(resolveFactory(), dbName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY, "readonly");
      let rows: LocalWorkspace[] = [];
      let failure: unknown;
      tx.oncomplete = () => {
        db.close();
        if (failure) reject(failure);
        else resolve(rows);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(
          failure ??
            tx.error ??
            new LocalWorkspaceDataError("History unavailable"),
        );
      };
      const request = tx.objectStore(HISTORY).index("id").getAll(id);
      request.onsuccess = () => {
        try {
          rows = [];
          for (const row of request.result) {
            try {
              checkStored(row, id);
              rows.push(row);
            } catch {
              /* Keep unreadable checkpoint bytes intact, while offering valid rows. */
            }
          }
          rows.sort((a, b) => b.revision - a.revision);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    });
  }

  async function listDeleted(): Promise<LocalWorkspace[]> {
    const db = await openDb(resolveFactory(), dbName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE, HISTORY], "readonly");
      const current = tx.objectStore(STORE).getAllKeys();
      const history = tx.objectStore(HISTORY).getAll();
      tx.oncomplete = () => {
        db.close();
        try {
          const ids = new Set(current.result);
          const latest = new Map<string, LocalWorkspace>();
          for (const row of history.result) {
            try {
              checkStored(row);
            } catch {
              continue; /* Preserve unreadable rows without hiding other projects. */
            }
            if (
              !ids.has(row.id) &&
              (!latest.has(row.id) ||
                latest.get(row.id)!.revision < row.revision)
            )
              latest.set(row.id, row);
          }
          resolve(
            [...latest.values()].sort((a, b) => b.updatedAt - a.updatedAt),
          );
        } catch (error) {
          reject(error);
        }
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(
          tx.error ??
            new LocalWorkspaceDataError("Deleted history unavailable"),
        );
      };
    });
  }

  return { load, save, list, remove, listHistory, listDeleted };
}
