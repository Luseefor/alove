import type { StateStorage } from "zustand/middleware";

/** Presentation preferences are optional; storage denial must not interrupt editing. */
export const preferenceStorage: StateStorage = {
  getItem(name) {
    try {
      return globalThis.localStorage?.getItem(name) ?? null;
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    try {
      globalThis.localStorage?.setItem(name, value);
    } catch {
      /* Source uses IndexedDB, with explicit failure status. */
    }
  },
  removeItem(name) {
    try {
      globalThis.localStorage?.removeItem(name);
    } catch {
      /* Preferences are optional. */
    }
  },
};
