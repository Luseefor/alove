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

function fail(message: string): never {
  throw new LocalWorkspaceDataError(message);
}

function checkFiles(value: unknown): asserts value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail("Invalid files");
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!k || typeof v !== "string") fail("Invalid files");
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
  if (typeof r.id !== "string" || !r.id) fail("Invalid id");
  if (typeof r.title !== "string") fail("Invalid title");
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
  if (typeof r.id !== "string" || !r.id) fail("Invalid id");
  if (expectedId !== undefined && r.id !== expectedId) fail("Mismatched id");
  if (typeof r.title !== "string") fail("Invalid title");
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
      req = factory.open(name, 1);
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
        tx = db.transaction(STORE, "readwrite");
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

  return { load, save };
}
