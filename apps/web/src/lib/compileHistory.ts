const DB = "alove-history";
const STORE = "snapshots";

export type HistoryEntry = {
  id: string;
  ts: number;
  projectId: string;
  mainFile: string;
  ok: boolean;
  files: Record<string, string>;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

export async function saveCompileSnapshot(entry: Omit<HistoryEntry, "id">) {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    const id = `${entry.projectId}-${entry.ts}`;
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ ...entry, id });
    await new Promise<void>((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {
    /* ignore quota / private mode */
  }
}

export async function listCompileSnapshots(
  projectId: string,
  limit = 20,
): Promise<HistoryEntry[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const all = await new Promise<HistoryEntry[]>((res, rej) => {
      const rq = tx.objectStore(STORE).getAll();
      rq.onerror = () => rej(rq.error);
      rq.onsuccess = () => res((rq.result as HistoryEntry[]) ?? []);
    });
    db.close();
    return all
      .filter((h) => h.projectId === projectId)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);
  } catch {
    return [];
  }
}
