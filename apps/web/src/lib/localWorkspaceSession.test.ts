import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { useWorkbenchStore as store } from "@/stores/workbenchStore";
import {
  createLocalWorkspaceRepository,
  type LocalWorkspaceInput,
} from "./localWorkspace";
import { createLocalWorkspaceSession } from "./localWorkspaceSession";

const seed: LocalWorkspaceInput = {
  id: "local",
  title: "My project",
  mainFile: "main.tex",
  files: { "main.tex": "seed" },
  activeFile: "main.tex",
  openFiles: ["main.tex"],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  store.setState(store.getInitialState(), true);
});

afterEach(() => vi.unstubAllGlobals());

describe("local workspace session", () => {
  it("restores saved source before enabling autosave or seeding defaults", async () => {
    const repository = createLocalWorkspaceRepository(new IDBFactory());
    await repository.save(
      {
        ...seed,
        files: { "main.tex": "real work", "empty.tex": "" },
        activeFile: "empty.tex",
      },
      0,
    );
    const save = vi.spyOn(repository, "save");
    const session = createLocalWorkspaceSession({ store, repository, seed });
    await session.ready;
    expect(store.getState().filesByPath).toEqual({
      "main.tex": "real work",
      "empty.tex": "",
    });
    expect(store.getState().activeFileId).toBe("empty.tex");
    expect(save).not.toHaveBeenCalled();
    session.dispose();
  });

  it("acknowledges only committed content, then saves edits made during a write", async () => {
    const actual = createLocalWorkspaceRepository(new IDBFactory());
    await actual.save(seed, 0);
    const gate = deferred<void>();
    let hold = true;
    const repository = {
      ...actual,
      save: vi.fn(async (...args: Parameters<typeof actual.save>) => {
        if (hold) {
          hold = false;
          await gate.promise;
        }
        return actual.save(...args);
      }),
    };
    const session = createLocalWorkspaceSession({ store, repository, seed });
    await session.ready;
    store.getState().updateActiveFileContent("first edit");
    const writing = session.save();
    await Promise.resolve();
    expect(store.getState().saveStatus).toBe("saving");
    expect(store.getState().dirtyByPath["main.tex"]).toBe(true);
    store.getState().updateActiveFileContent("newer edit");
    gate.resolve();
    await writing;
    expect((await actual.load("local"))?.files["main.tex"]).toBe("newer edit");
    expect(store.getState().dirtyByPath["main.tex"]).toBe(false);
    expect(store.getState().saveStatus).toBe("saved");
    session.dispose();
  });

  it("retains edits on quota failure and allows a manual retry", async () => {
    const actual = createLocalWorkspaceRepository(new IDBFactory());
    await actual.save(seed, 0);
    let fail = true;
    const repository = {
      ...actual,
      save: vi.fn(async (...args: Parameters<typeof actual.save>) => {
        if (fail) throw new DOMException("Full", "QuotaExceededError");
        return actual.save(...args);
      }),
    };
    const session = createLocalWorkspaceSession({ store, repository, seed });
    await session.ready;
    store.getState().updateActiveFileContent("keep me");
    await session.save();
    expect(store.getState().saveStatus).toBe("error");
    expect(store.getState().dirtyByPath["main.tex"]).toBe(true);
    expect(store.getState().filesByPath["main.tex"]).toBe("keep me");
    expect((await actual.load("local"))?.files["main.tex"]).toBe("seed");
    fail = false;
    await store.getState().saveActiveFile();
    expect(store.getState().saveStatus).toBe("saved");
    session.dispose();
  });

  it("keeps a stale tab's draft without overwriting another tab", async () => {
    const repository = createLocalWorkspaceRepository(new IDBFactory());
    await repository.save(seed, 0);
    const session = createLocalWorkspaceSession({ store, repository, seed });
    await session.ready;
    await repository.save({ ...seed, files: { "main.tex": "other tab" } }, 1);
    store.getState().updateActiveFileContent("my draft");
    await session.save();
    expect(store.getState().saveStatus).toBe("conflict");
    expect(store.getState().filesByPath["main.tex"]).toBe("my draft");
    expect((await repository.load("local"))?.files["main.tex"]).toBe(
      "other tab",
    );
    session.dispose();
  });

  it("keeps saving source when preference localStorage rejects writes", async () => {
    const repository = createLocalWorkspaceRepository(new IDBFactory());
    const session = createLocalWorkspaceSession({ store, repository, seed });
    await session.ready;
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new DOMException("Denied", "SecurityError");
      },
      setItem() {
        throw new DOMException("Full", "QuotaExceededError");
      },
      removeItem() {
        throw new DOMException("Denied", "SecurityError");
      },
    });
    store.getState().updateActiveFileContent("source still saves");
    await session.save();
    expect(store.getState().saveStatus).toBe("saved");
    expect((await repository.load("local"))?.files["main.tex"]).toBe(
      "source still saves",
    );
    session.dispose();
  });

  it("persists renames across TeX and non-TeX extensions without invalid roots", async () => {
    const repository = createLocalWorkspaceRepository(new IDBFactory());
    const session = createLocalWorkspaceSession({ store, repository, seed });
    await session.ready;
    store.getState().renameFile("main.tex", "notes.txt");
    await session.save();
    expect((await repository.load("local"))?.mainFile).toBeNull();
    store.getState().renameFile("notes.txt", "paper.tex");
    await session.save();
    expect((await repository.load("local"))?.mainFile).toBe("paper.tex");
    expect(store.getState().saveStatus).toBe("saved");
    session.dispose();
  });

  it("does not initialize or subscribe after unmount during hydration", async () => {
    const actual = createLocalWorkspaceRepository(new IDBFactory());
    const gate = deferred<null>();
    vi.spyOn(actual, "save");
    const repository = { ...actual, load: () => gate.promise };
    const session = createLocalWorkspaceSession({ store, repository, seed });
    session.dispose();
    gate.resolve(null);
    await session.ready;
    expect(store.getState().filesByPath).toEqual({});
    expect(repository.save).not.toHaveBeenCalled();
  });

  it("never writes defaults after an unreadable workspace", async () => {
    const actual = createLocalWorkspaceRepository(new IDBFactory());
    vi.spyOn(actual, "save");
    const repository = {
      ...actual,
      load: vi.fn().mockRejectedValue(new Error("Corrupt")),
    };
    const session = createLocalWorkspaceSession({ store, repository, seed });
    await session.ready;
    expect(store.getState().saveStatus).toBe("error");
    expect(store.getState().filesByPath).toEqual({});
    expect(repository.save).not.toHaveBeenCalled();
    session.dispose();
  });
});
