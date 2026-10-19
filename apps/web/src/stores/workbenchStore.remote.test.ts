import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkbenchStore as store, type RemoteProjectFile } from "./workbenchStore";

const original: RemoteProjectFile[] = [
  { path: "main.tex", content: "root", version: 1 },
  { path: "chapter.tex", content: "chapter", version: 1 },
];

function sync(files: RemoteProjectFile[]) {
  store.getState().mergeRemoteProject({ projectId: "cloud-1", files });
}

beforeEach(() => {
  store.setState(store.getInitialState(), true);
  sync(original);
});

describe("remote project reconciliation", () => {
  it("preserves a dirty buffer, active tab and root through unrelated refetches", () => {
    store.getState().openFile("chapter.tex");
    store.getState().setMainFile("chapter.tex");
    store.getState().updateActiveFileContent("my unsaved chapter");
    sync([{ path: "main.tex", content: "remote root", version: 2 }, original[1]]);
    const state = store.getState();
    expect(state.filesByPath).toEqual({ "main.tex": "remote root", "chapter.tex": "my unsaved chapter" });
    expect(state.dirtyByPath["chapter.tex"]).toBe(true);
    expect(state.activeFileId).toBe("chapter.tex");
    expect(state.mainFile).toBe("chapter.tex");
    expect(state.saveStatus).not.toBe("conflict");
  });

  it("keeps the local draft and expected version when its remote file changes", () => {
    store.getState().updateActiveFileContent("my draft");
    sync([{ path: "main.tex", content: "their draft", version: 2 }, original[1]]);
    expect(store.getState().filesByPath["main.tex"]).toBe("my draft");
    expect(store.getState().versionsByPath["main.tex"]).toBe(1);
    expect(store.getState().saveStatus).toBe("conflict");
  });

  it("acknowledges identical committed source without moving the active tab", () => {
    store.getState().updateActiveFileContent("committed draft");
    sync([{ path: "main.tex", content: "committed draft", version: 2 }, original[1]]);
    expect(store.getState().dirtyByPath["main.tex"]).toBe(false);
    expect(store.getState().versionsByPath["main.tex"]).toBe(2);
    expect(store.getState().activeFileId).toBe("main.tex");
  });

  it("does not resurrect a local deletion or rename on an unchanged query echo", () => {
    store.getState().renameFile("main.tex", "paper.tex");
    store.getState().deleteFile("chapter.tex");
    sync(original);
    expect(store.getState().filesByPath).toEqual({ "paper.tex": "root" });
    expect(store.getState().activeFileId).toBe("paper.tex");
    expect(store.getState().mainFile).toBe("paper.tex");
  });

  it("removes clean remote deletions but retains dirty deleted documents", () => {
    store.getState().updateActiveFileContent("keep deleted draft");
    sync([]);
    expect(store.getState().filesByPath).toEqual({ "main.tex": "keep deleted draft" });
    expect(store.getState().openFiles).toEqual(["main.tex"]);
    expect(store.getState().saveStatus).toBe("conflict");
  });

  it("never rolls a mutation acknowledgement back to an older query version", () => {
    store.setState({ filesByPath: { "main.tex": "new committed root", "chapter.tex": "chapter" }, versionsByPath: { "main.tex": 3, "chapter.tex": 1 } });
    sync([{ path: "main.tex", content: "older root", version: 2 }, original[1]]);
    expect(store.getState().filesByPath["main.tex"]).toBe("new committed root");
    expect(store.getState().versionsByPath["main.tex"]).toBe(3);
  });

  it("preserves edits made after a save starts while accepting its query echo", async () => {
    let resolve!: (result: { version: number; conflict: false }) => void;
    const gate = new Promise<{ version: number; conflict: false }>((res) => { resolve = res; });
    const save = vi.fn(() => gate);
    store.getState().setPersistenceHandlers({ save });
    store.getState().updateActiveFileContent("submitted draft");
    const writing = store.getState().saveActiveFile();
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    store.getState().updateActiveFileContent("newer draft");
    sync([{ path: "main.tex", content: "submitted draft", version: 2 }, original[1]]);
    expect(store.getState().saveStatus).not.toBe("conflict");
    resolve({ version: 2, conflict: false });
    await writing;
    expect(store.getState().filesByPath["main.tex"]).toBe("newer draft");
    expect(store.getState().dirtyByPath["main.tex"]).toBe(true);
    expect(store.getState().versionsByPath["main.tex"]).toBe(2);
  });

  it("initializes a different project and clears old preview state", () => {
    store.setState({ pdfDataUrl: "data:application/pdf;base64,b2xk" });
    store.getState().mergeRemoteProject({ projectId: "cloud-2", files: [{ path: "paper.tex", content: "new project", version: 1 }] });
    expect(store.getState().filesByPath).toEqual({ "paper.tex": "new project" });
    expect(store.getState().pdfDataUrl).toBeNull();
    expect(store.getState().saveStatus).toBe("saved");
  });

  it("resolves a conflict when a later committed snapshot matches the local source", () => {
    store.getState().updateActiveFileContent("my draft");
    const remote = [{ path: "main.tex", content: "their draft", version: 2 }, original[1]];
    sync(remote);
    expect(store.getState().saveStatus).toBe("conflict");
    sync([{ path: "main.tex", content: "my draft", version: 3 }, original[1]]);
    expect(store.getState().saveStatus).toBe("saved");
    expect(store.getState().saveMessage).toBeNull();
  });

  it("ignores old acknowledgements for a file removed during saving", async () => {
    let resolve!: (result: { version: number; conflict: false }) => void;
    const gate = new Promise<{ version: number; conflict: false }>((res) => { resolve = res; });
    const save = vi.fn(() => gate);
    store.getState().setPersistenceHandlers({ save });
    store.getState().updateActiveFileContent("submitted draft");
    const writing = store.getState().saveActiveFile();
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    store.getState().deleteFile("main.tex");
    resolve({ version: 2, conflict: false });
    await writing;
    expect(store.getState().filesByPath).not.toHaveProperty("main.tex");
    expect(store.getState().dirtyByPath).not.toHaveProperty("main.tex");
    expect(store.getState().versionsByPath).not.toHaveProperty("main.tex");
    sync([original[1]]);
    expect(store.getState().saveStatus).toBe("saved");
  });

  it("does not roll back a newer matching query version when save acknowledgement arrives", async () => {
    let resolve!: (result: { version: number; conflict: false }) => void;
    const gate = new Promise<{ version: number; conflict: false }>((res) => { resolve = res; });
    const save = vi.fn(() => gate);
    store.getState().setPersistenceHandlers({ save });
    store.getState().updateActiveFileContent("committed draft");
    const writing = store.getState().saveActiveFile();
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    sync([{ path: "main.tex", content: "committed draft", version: 3 }, original[1]]);
    resolve({ version: 2, conflict: false });
    await writing;
    expect(store.getState().versionsByPath["main.tex"]).toBe(3);
    expect(store.getState().dirtyByPath["main.tex"]).toBe(false);
  });

  it("retains its baseline across a component remount", () => {
    store.getState().updateActiveFileContent("my draft");
    store.getState().deleteFile("chapter.tex");
    // A newly mounted subscriber has no component-local snapshot to pass.
    store.getState().mergeRemoteProject({ projectId: "cloud-1", files: original });
    expect(store.getState().filesByPath).toEqual({ "main.tex": "my draft" });
    expect(store.getState().saveStatus).not.toBe("conflict");
    expect(store.getState().dirtyByPath["main.tex"]).toBe(true);
  });

  it("adopts a clean remote file recreated with a reset version", () => {
    const old = [{ path: "main.tex", content: "old file", version: 5 }, original[1]];
    sync(old);
    sync([{ path: "main.tex", content: "recreated file", version: 1 }, original[1]]);
    expect(store.getState().filesByPath["main.tex"]).toBe("recreated file");
    expect(store.getState().versionsByPath["main.tex"]).toBe(1);
  });

  it("retains dirty retry state when a matching query echo precedes a failed save", async () => {
    let reject!: (reason: Error) => void;
    const gate = new Promise<never>((_, rej) => { reject = rej; });
    const save = vi.fn(() => gate);
    store.getState().setPersistenceHandlers({ save });
    store.getState().updateActiveFileContent("submitted draft");
    const writing = store.getState().saveActiveFile();
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    sync([{ path: "main.tex", content: "submitted draft", version: 2 }, original[1]]);
    reject(new Error("connection lost"));
    await writing;
    expect(store.getState().saveStatus).toBe("error");
    expect(store.getState().dirtyByPath["main.tex"]).toBe(true);
  });
});
