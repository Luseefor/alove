import type { BuildRecord } from "./buildRecord";

export class BuildRecordDataError extends Error {
  constructor(message = "Invalid build record data") {
    super(message);
    this.name = "BuildRecordDataError";
  }
}

export class BuildRecordConflictError extends Error {
  constructor(message = "Build record conflict") {
    super(message);
    this.name = "BuildRecordConflictError";
  }
}

const DEFAULT_DB = "alove-build-records-v1";
const STORE = "records";
const PROJECT_INDEX = "projectId";
const MAX_RECORDS_PER_PROJECT = 20;
const MAX_BYTES_PER_PROJECT = 50 * 1024 * 1024;

const ALLOWED_ENGINES = new Set(["pdflatex", "lualatex", "xelatex"]);
const ALLOWED_ERROR_CODES = new Set([
  "VALIDATION_ERROR",
  "TIMEOUT",
  "DOCKER_ERROR",
  "LATEX_ERROR",
  "OUTPUT_TOO_LARGE",
  "INTERNAL_ERROR",
]);
const ALLOWED_SEVERITIES = new Set(["error", "warning", "info"]);
const FORBIDDEN_KEYS = new Set([
  "pdfBase64",
  "pdf",
  "pdfBytes",
  "pdfData",
  "payload",
  "pdfUrl",
  "dataUrl",
]);

function fail(message: string): never {
  throw new BuildRecordDataError(message);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  return true;
}

function checkStringFiles(value: unknown): asserts value is Record<string, string> {
  if (!isPlainRecord(value)) fail("Invalid files");
  for (const [k, v] of Object.entries(value)) {
    if (!k || typeof v !== "string") fail("Invalid files");
  }
}

function checkDiagnostics(value: unknown): void {
  if (!Array.isArray(value)) fail("Invalid diagnostics");
  for (const entry of value as unknown[]) {
    if (!isPlainRecord(entry)) fail("Invalid diagnostics");
    if (!ALLOWED_SEVERITIES.has(entry["severity"] as string))
      fail("Invalid diagnostic severity");
    if (typeof entry["message"] !== "string") fail("Invalid diagnostic message");
    if (entry["file"] !== undefined && typeof entry["file"] !== "string")
      fail("Invalid diagnostic file");
    if (
      entry["line"] !== undefined &&
      (!Number.isSafeInteger(entry["line"]) ||
        (entry["line"] as number) < 0)
    )
      fail("Invalid diagnostic line");
    if (
      entry["column"] !== undefined &&
      (!Number.isSafeInteger(entry["column"]) ||
        (entry["column"] as number) < 0)
    )
      fail("Invalid diagnostic column");
  }
}

function checkEnvironment(value: unknown): void {
  if (value === undefined) return;
  if (!isPlainRecord(value)) fail("Invalid environment");
  if (value["mode"] !== "docker" && value["mode"] !== "host")
    fail("Invalid environment mode");
  if (typeof value["runtimeId"] !== "string" || !value["runtimeId"])
    fail("Invalid environment runtimeId");
  if (value["policyId"] !== undefined && (typeof value["policyId"] !== "string" || !value["policyId"]))
    fail("Invalid environment policyId");
  if (typeof value["platform"] !== "string" || !value["platform"])
    fail("Invalid environment platform");
}

function checkForbiddenKeys(holder: Record<string, unknown>, where: string): void {
  for (const key of Object.keys(holder)) {
    if (FORBIDDEN_KEYS.has(key)) fail(`Forbidden PDF field: ${where}.${key}`);
  }
}

function checkRecord(value: unknown): asserts value is BuildRecord {
  if (!isPlainRecord(value)) fail("Invalid build record");
  const r = value;
  checkForbiddenKeys(r, "record");
  if (r["schema"] !== 1) fail("Unsupported build record schema");
  if (typeof r["id"] !== "string" || !r["id"]) fail("Invalid id");
  if (typeof r["projectId"] !== "string" || !r["projectId"])
    fail("Invalid projectId");
  if (!Number.isSafeInteger(r["revision"]) || (r["revision"] as number) < 0)
    fail("Invalid revision");
  if (typeof r["startedAt"] !== "number" || !Number.isFinite(r["startedAt"]))
    fail("Invalid startedAt");
  if (typeof r["completedAt"] !== "number" || !Number.isFinite(r["completedAt"]))
    fail("Invalid completedAt");
  if (typeof r["sourceHash"] !== "string" || !r["sourceHash"])
    fail("Invalid sourceHash");
  if (typeof r["mainFile"] !== "string" || !r["mainFile"])
    fail("Invalid mainFile");
  if (typeof r["engine"] !== "string" || !ALLOWED_ENGINES.has(r["engine"] as string))
    fail("Invalid engine");
  if (typeof r["cleanAux"] !== "boolean") fail("Invalid cleanAux");
  checkStringFiles(r["files"]);
  if (!isPlainRecord(r["result"])) fail("Invalid result");
  const result = r["result"] as Record<string, unknown>;
  checkForbiddenKeys(result, "result");
  if (typeof result["ok"] !== "boolean") fail("Invalid result.ok");
  if (typeof result["log"] !== "string") fail("Invalid result.log");
  checkDiagnostics(result["diagnostics"]);
  if (
    result["errorCode"] !== undefined &&
    (typeof result["errorCode"] !== "string" ||
      !ALLOWED_ERROR_CODES.has(result["errorCode"]))
  )
    fail("Invalid errorCode");
  if (result["message"] !== undefined && typeof result["message"] !== "string")
    fail("Invalid message");
  checkEnvironment(result["environment"]);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const ka = Object.keys(ra).filter(key=>ra[key]!==undefined).sort();
    const kb = Object.keys(rb).filter(key=>rb[key]!==undefined).sort();
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return false;
      if (!deepEqual(ra[ka[i]], rb[ka[i]])) return false;
    }
    return true;
  }
  return false;
}

function snapshotRecord(record: BuildRecord): BuildRecord {
  return structuredClone(record);
}

const utf8Encoder = new TextEncoder();

function recordBytes(record: BuildRecord): number {
  return utf8Encoder.encode(JSON.stringify(record)).length;
}

function compareAsc(a: BuildRecord, b: BuildRecord): number {
  if (a.completedAt !== b.completedAt) return a.completedAt - b.completedAt;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
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
          : new BuildRecordDataError("IndexedDB open failed"),
      );
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      let store: IDBObjectStore;
      if (db.objectStoreNames.contains(STORE)) {
        const tx = req.transaction;
        if (tx) {
          store = tx.objectStore(STORE);
        } else {
          return;
        }
      } else {
        store = db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!store.indexNames.contains(PROJECT_INDEX)) {
        store.createIndex(PROJECT_INDEX, "projectId", { unique: false });
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
      reject(req.error ?? new BuildRecordDataError("IndexedDB open failed"));
    };
    req.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new BuildRecordDataError("IndexedDB open blocked"));
    };
  });
}

export function createBuildRecordRepository(
  factory?: IDBFactory,
  databaseName?: string,
) {
  const dbName = databaseName ?? DEFAULT_DB;
  const resolveFactory = (): IDBFactory => {
    const effective =
      factory ??
      (globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB;
    if (!effective || typeof effective.open !== "function")
      throw new BuildRecordDataError("IndexedDB unavailable");
    return effective;
  };

  async function save(record: BuildRecord): Promise<void> {
    checkRecord(record);
    const snapshot = snapshotRecord(record);
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
          /* ignore */
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
          failure ?? tx.error ?? new BuildRecordDataError("Build record save failed"),
        );
      };
      tx.onabort = () => {
        close();
        bad(
          failure ?? tx.error ?? new BuildRecordDataError("Build record save aborted"),
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
        getReq = store.get(snapshot.id);
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
        failure = getReq.error ?? new BuildRecordDataError("Build record read failed");
        try {
          tx.abort();
        } catch {
          /* ignore */
        }
      };
      getReq.onsuccess = () => {
        try {
          const existing: unknown = getReq.result;
          if (existing !== undefined && existing !== null) {
            try {
              checkRecord(existing);
            } catch (e) {
              failure = e;
              try {
                tx.abort();
              } catch {
                /* ignore */
              }
              return;
            }
            if (!deepEqual(existing, snapshot)) {
              failure = new BuildRecordConflictError(
                `Immutable build record conflict: ${snapshot.id}`,
              );
              try {
                tx.abort();
              } catch {
                /* ignore */
              }
              return;
            }
            return;
          }
          let putReq: IDBRequest;
          try {
            putReq = store.put(snapshot);
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
            if (!failure) {
              failure =
                putReq.error ?? new BuildRecordDataError("Build record write failed");
            }
          };
          putReq.onsuccess = () => {
            let allReq: IDBRequest;
            try {
              allReq = store.index(PROJECT_INDEX).getAll(snapshot.projectId);
            } catch (e) {
              failure = e;
              try {
                tx.abort();
              } catch {
                /* ignore */
              }
              return;
            }
            allReq.onerror = () => {
              if (!failure) {
                failure =
                  allReq.error ??
                  new BuildRecordDataError("Build record retention read failed");
              }
              try {
                tx.abort();
              } catch {
                /* ignore */
              }
            };
            allReq.onsuccess = () => {
              try {
                const rows = (allReq.result ?? []) as unknown[];
                const all: BuildRecord[] = [];
                for (const row of rows) {
                  try {
                    checkRecord(row);
                  } catch (e) {
                    failure = e;
                    try {
                      tx.abort();
                    } catch {
                      /* ignore */
                    }
                    return;
                  }
                  all.push(row as BuildRecord);
                }
                if (all.length === 0) return;
                const sortedAsc = [...all].sort(compareAsc);
                const newest = sortedAsc[sortedAsc.length - 1];
                let newestOk: BuildRecord | null = null;
                for (let i = sortedAsc.length - 1; i >= 0; i--) {
                  if (sortedAsc[i].result.ok) {
                    newestOk = sortedAsc[i];
                    break;
                  }
                }
                const pinned = new Set<string>();
                if (newest) pinned.add(newest.id);
                if (newestOk) pinned.add(newestOk.id);
                let count = all.length;
                const sizes = new Map<string, number>();
                let bytes = 0;
                for (const row of all) {
                  const size = recordBytes(row);
                  sizes.set(row.id, size);
                  bytes += size;
                }
                const candidates = sortedAsc.filter((r) => !pinned.has(r.id));
                for (const victim of candidates) {
                  if (count <= MAX_RECORDS_PER_PROJECT && bytes <= MAX_BYTES_PER_PROJECT)
                    break;
                  try {
                    const delReq = store.delete(victim.id);
                    delReq.onerror = () => {
                      if (!failure) {
                        failure =
                          delReq.error ??
                          new BuildRecordDataError("Build record eviction failed");
                      }
                    };
                  } catch (e) {
                    failure = e;
                    try {
                      tx.abort();
                    } catch {
                      /* ignore */
                    }
                    return;
                  }
                  count -= 1;
                  bytes -= sizes.get(victim.id) ?? 0;
                }
              } catch (e) {
                failure = e;
                try {
                  tx.abort();
                } catch {
                  /* ignore */
                }
              }
            };
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

  async function list(projectId: string): Promise<BuildRecord[]> {
    if (typeof projectId !== "string" || !projectId)
      throw new BuildRecordDataError("Invalid projectId");
    const db = await openDb(resolveFactory(), dbName);
    return new Promise<BuildRecord[]>((resolve, reject) => {
      let done = false;
      const ok = (v: BuildRecord[]) => {
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
          /* ignore */
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
      let rows: BuildRecord[] | null = null;
      tx.oncomplete = () => {
        close();
        if (failure) bad(failure);
        else if (rows) ok(rows);
        else bad(new BuildRecordDataError("Build record list failed"));
      };
      tx.onerror = () => {
        close();
        bad(
          failure ?? tx.error ?? new BuildRecordDataError("Build record list failed"),
        );
      };
      tx.onabort = () => {
        close();
        bad(
          failure ?? tx.error ?? new BuildRecordDataError("Build record list aborted"),
        );
      };
      let allReq: IDBRequest;
      try {
        allReq = tx.objectStore(STORE).index(PROJECT_INDEX).getAll(projectId);
      } catch (e) {
        failure = e;
        try {
          tx.abort();
        } catch {
          /* ignore */
        }
        return;
      }
      allReq.onerror = () => {
        failure =
          allReq.error ?? new BuildRecordDataError("Build record list failed");
        try {
          tx.abort();
        } catch {
          /* ignore */
        }
      };
      allReq.onsuccess = () => {
        try {
          const raw = (allReq.result ?? []) as unknown[];
          const checked: BuildRecord[] = [];
          for (const row of raw) {
            checkRecord(row);
            // getAll already returns fresh structured clones detached from IDB,
            // so validated rows are returned directly without another copy.
            checked.push(row as BuildRecord);
          }
          checked.sort((a, b) => -compareAsc(a, b));
          rows = checked;
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

  return { save, list };
}

export const buildRecordRepository = createBuildRecordRepository();
