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

describe("history restoration", () => {
  it("restores durably and checkpoints the current source so restoration can be undone", async () => {
    const repository = createLocalWorkspaceRepository(new IDBFactory());
    await repository.save(seed, 0);
    const session = createLocalWorkspaceSession({ store, repository, seed });
    await session.ready;
    store.getState().updateActiveFileContent("new source");
    await session.save();
    await store.getState().persistence.restoreHistory!(1);
    expect(store.getState().filesByPath).toEqual(seed.files);
    expect((await repository.load(seed.id))?.files).toEqual(seed.files);
    const checkpoints = await repository.listHistory(seed.id);
    expect(checkpoints[0].files["main.tex"]).toBe("new source");
    await store.getState().persistence.restoreHistory!(checkpoints[0].revision);
    expect(store.getState().filesByPath["main.tex"]).toBe("new source");
    session.dispose();
  });

  it("does not restore over a stale tab or failed current save", async () => {
    const repository = createLocalWorkspaceRepository(new IDBFactory());
    await repository.save(seed, 0);
    const session = createLocalWorkspaceSession({ store, repository, seed });
    await session.ready;
    await repository.save({ ...seed, files: { "main.tex": "remote" } }, 1);
    store.getState().updateActiveFileContent("my unsaved draft");
    await expect(
      store.getState().persistence.restoreHistory!(1),
    ).rejects.toThrow("Save or export");
    expect(store.getState().filesByPath["main.tex"]).toBe("my unsaved draft");
    expect((await repository.load(seed.id))?.files["main.tex"]).toBe("remote");
    session.dispose();
  });

  it("keeps typing that arrives during the restore transaction", async () => {
    const actual = createLocalWorkspaceRepository(new IDBFactory());
    await actual.save(seed, 0);
    await actual.save({ ...seed, files: { "main.tex": "current" } }, 1);
    const gate = deferred<void>();
    const entered = deferred<void>();
    let hold = true;
    const repository = {
      ...actual,
      save: async (...args: Parameters<typeof actual.save>) => {
        if (hold) {
          hold = false;
          entered.resolve();
          await gate.promise;
        }
        return actual.save(...args);
      },
    };
    const session = createLocalWorkspaceSession({ store, repository, seed });
    await session.ready;
    const restoring = store.getState().persistence.restoreHistory!(1);
    await entered.promise;
    store.getState().updateActiveFileContent("typing during restore");
    gate.resolve();
    await expect(restoring).rejects.toThrow("newer edits were kept");
    expect(store.getState().filesByPath["main.tex"]).toBe(
      "typing during restore",
    );
    expect((await actual.load(seed.id))?.files["main.tex"]).toBe(
      "typing during restore",
    );
    session.dispose();
  });
});

it("persists typing that cancels restore while history is loading", async () => {
  const actual = createLocalWorkspaceRepository(new IDBFactory());
  await actual.save(seed, 0);
  await actual.save({ ...seed, files: { "main.tex": "current" } }, 1);
  const gate = deferred<Awaited<ReturnType<typeof actual.listHistory>>>();
  const entered = deferred<void>();
  const repository = {
    ...actual,
    listHistory: () => {
      entered.resolve();
      return gate.promise;
    },
  };
  const session = createLocalWorkspaceSession({ store, repository, seed });
  await session.ready;
  const restoring = store.getState().persistence.restoreHistory!(1);
  await entered.promise;
  store.getState().updateActiveFileContent("new typing while history loads");
  gate.resolve(await actual.listHistory(seed.id));
  await expect(restoring).rejects.toThrow("changed while loading");
  expect((await actual.load(seed.id))?.files["main.tex"]).toBe(
    "new typing while history loads",
  );
  expect(store.getState().saveStatus).toBe("saved");
  session.dispose();
});

it("checkpoints the latest draft before deletion during an older in-flight save", async () => {
  const actual = createLocalWorkspaceRepository(new IDBFactory());
  await actual.save(
    { ...seed, files: { ...seed.files, "notes.txt": "initial" } },
    0,
  );
  const gate = deferred<void>();
  const entered = deferred<void>();
  let hold = true;
  const repository = {
    ...actual,
    save: async (...args: Parameters<typeof actual.save>) => {
      if (hold) {
        hold = false;
        entered.resolve();
        await gate.promise;
      }
      return actual.save(...args);
    },
  };
  const session = createLocalWorkspaceSession({ store, repository, seed });
  await session.ready;
  store.getState().setActiveFile("notes.txt");
  store.getState().updateActiveFileContent("first edit");
  const saving = session.save();
  await entered.promise;
  store.getState().updateActiveFileContent("latest draft before delete");
  store.getState().deleteFile("notes.txt");
  gate.resolve();
  await saving;
  expect((await actual.load(seed.id))?.files["notes.txt"]).toBeUndefined();
  expect((await actual.listHistory(seed.id))[0].files["notes.txt"]).toBe(
    "latest draft before delete",
  );
  session.dispose();
});

it("returns removed unsaved source to the exportable workspace if its checkpoint fails", async () => {
  const actual = createLocalWorkspaceRepository(new IDBFactory());
  await actual.save(
    { ...seed, files: { ...seed.files, "notes.txt": "initial" } },
    0,
  );
  const repository = {
    ...actual,
    save: vi.fn().mockRejectedValue(new Error("quota")),
  };
  const session = createLocalWorkspaceSession({ store, repository, seed });
  await session.ready;
  store.getState().setActiveFile("notes.txt");
  store.getState().updateActiveFileContent("unsaved draft to keep");
  store.getState().deleteFile("notes.txt");
  await session.save();
  expect(store.getState().filesByPath["notes.txt"]).toBe(
    "unsaved draft to keep",
  );
  expect(store.getState().dirtyByPath["notes.txt"]).toBe(true);
  expect(store.getState().saveStatus).toBe("error");
  session.dispose();
});
