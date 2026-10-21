import { webcrypto } from "node:crypto";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import type { CloudDraft } from "@/lib/cloudDraft";

const g = globalThis as unknown as { crypto?: Crypto };
if (!g.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

const repoMocks = vi.hoisted(() => ({
  save: vi.fn(),
  load: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/cloudDraft", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/cloudDraft")>();
  return {
    ...actual,
    cloudDraftRepository: {
      save: repoMocks.save,
      load: repoMocks.load,
      remove: repoMocks.remove,
    },
  };
});

import { CloudDraftRecovery } from "@/components/CloudDraftRecovery";

// App source uses the automatic JSX runtime. Vitest compiles this file as
// classic runtime, so expose React globally for the component under test.
(globalThis as unknown as { React: typeof React }).React = React;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    value,
    configurable: true,
  });
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function seedStore(overrides: Partial<ReturnType<typeof useWorkbenchStore.getState>> = {}) {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useWorkbenchStore.setState({
    cloudUserId: "user-a",
    projectId: "proj-1",
    projectTitle: "Test project",
    mainFile: "main.tex",
    activeFileId: "main.tex",
    openFiles: ["main.tex"],
    filesByPath: { "main.tex": "server v1" },
    versionsByPath: { "main.tex": 2 },
    incarnationsByPath: { "main.tex": "file-1" },
    dirtyByPath: { "main.tex": false },
    saveStatus: "saved",
    saveMessage: null,
    persistence: {},
    ...overrides,
  });
}

function makeDraft(overrides: Partial<CloudDraft> = {}): CloudDraft {
  return {
    userId: "user-a",
    projectId: "proj-1",
    tabId: "tab-1",
    files: { "main.tex": "draft content" },
    versions: { "main.tex": 1 },
    incarnations: { "main.tex": "file-1" },
    dirtyPaths: ["main.tex"],
    title: "Test project",
    mainFile: "main.tex",
    updatedAt: 1,
    ...overrides,
  };
}

const roots: Root[] = [];
const containers: HTMLElement[] = [];

function renderRecovery(userId: string, projectId: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(
      <CloudDraftRecovery userId={userId} projectId={projectId}>
        <div data-testid="editor-child">editor body</div>
      </CloudDraftRecovery>,
    );
  });
  return { container, root };
}

function queryChild(container: HTMLElement) {
  return container.querySelector('[data-testid="editor-child"]');
}

function getButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (el) => el.textContent?.trim() === label,
  );
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

function click(button: HTMLButtonElement) {
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("CloudDraftRecovery flow", () => {
  beforeEach(() => {
    repoMocks.save.mockReset();
    repoMocks.load.mockReset();
    repoMocks.remove.mockReset();
    repoMocks.save.mockResolvedValue(undefined);
    repoMocks.remove.mockResolvedValue(undefined);
    repoMocks.load.mockResolvedValue(null);
    setOnline(true);
    seedStore();
    vi.useRealTimers();
  });

  afterEach(() => {
    while (roots.length) {
      const root = roots.pop();
      act(() => {
        root?.unmount();
      });
    }
    while (containers.length) {
      containers.pop()?.remove();
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setOnline(true);
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  });

  it("hides the editor until draft load completes and does not autorestore a pending draft", async () => {
    const gate = deferred<CloudDraft | null>();
    repoMocks.load.mockReturnValueOnce(gate.promise);
    seedStore({
      filesByPath: { "main.tex": "server v1" },
      versionsByPath: { "main.tex": 2 },
      dirtyByPath: { "main.tex": false },
    });
    const { container } = renderRecovery("user-a", "proj-1");

    expect(repoMocks.load).toHaveBeenCalledTimes(1);
    expect(repoMocks.load).toHaveBeenCalledWith(
      "user-a",
      "proj-1",
      expect.any(String),
    );
    expect(container.textContent).toContain("Checking browser draft recovery");
    expect(queryChild(container)).toBeNull();

    const pending = makeDraft({
      files: { "main.tex": "drafted while away" },
      versions: { "main.tex": 1 },
    });
    gate.resolve(pending);
    await flushMicrotasks();

    expect(container.textContent).toContain("unsaved draft");
    expect(queryChild(container)).toBeNull();
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toBe(
      "server v1",
    );
  });

  it("explicit restore merges only dirtyPaths and keeps unrelated new server edits", async () => {
    seedStore({
      filesByPath: {
        "main.tex": "server-new-main",
        "other.tex": "server-new-other",
      },
      versionsByPath: { "main.tex": 5, "other.tex": 7 },
      dirtyByPath: { "main.tex": false, "other.tex": false },
    });
    repoMocks.load.mockResolvedValueOnce(
      makeDraft({
        files: {
          "main.tex": "draft-main",
          "other.tex": "draft-stale-other",
        },
        versions: { "main.tex": 5, "other.tex": 1 },
        dirtyPaths: ["main.tex"],
      }),
    );
    const { container } = renderRecovery("user-a", "proj-1");
    await flushMicrotasks();

    expect(queryChild(container)).toBeNull();
    expect(useWorkbenchStore.getState().filesByPath).toEqual({
      "main.tex": "server-new-main",
      "other.tex": "server-new-other",
    });

    click(getButton(container, "Restore browser draft"));

    const state = useWorkbenchStore.getState();
    expect(state.filesByPath).toEqual({
      "main.tex": "draft-main",
      "other.tex": "server-new-other",
    });
    expect(state.dirtyByPath).toEqual({
      "main.tex": true,
      "other.tex": false,
    });
    expect(state.versionsByPath["main.tex"]).toBe(5);
    expect(state.versionsByPath["other.tex"]).toBe(7);
    expect(state.saveStatus).toBe("unsaved");
    expect(queryChild(container)).not.toBeNull();
  });

  it("keeps a server-newer version as a conflict instead of a false saved state", async () => {
    seedStore({
      filesByPath: { "main.tex": "server-newer" },
      versionsByPath: { "main.tex": 9 },
      dirtyByPath: { "main.tex": false },
    });
    repoMocks.load.mockResolvedValueOnce(
      makeDraft({
        files: { "main.tex": "draft-old" },
        versions: { "main.tex": 3 },
        dirtyPaths: ["main.tex"],
      }),
    );
    const { container } = renderRecovery("user-a", "proj-1");
    await flushMicrotasks();
    expect(queryChild(container)).toBeNull();

    click(getButton(container, "Restore browser draft"));

    const state = useWorkbenchStore.getState();
    expect(state.filesByPath["main.tex"]).toBe("draft-old");
    expect(state.dirtyByPath["main.tex"]).toBe(true);
    expect(state.versionsByPath["main.tex"]).toBe(3);
    expect(state.saveStatus).toBe("conflict");
    expect(state.saveMessage).toContain("Cloud files changed");
    expect(queryChild(container)).not.toBeNull();
  });

  it("discard awaits repository remove before showing the editor", async () => {
    seedStore({
      filesByPath: { "main.tex": "server v1" },
      versionsByPath: { "main.tex": 2 },
      dirtyByPath: { "main.tex": false },
    });
    repoMocks.load.mockResolvedValueOnce(
      makeDraft({ files: { "main.tex": "drafted" }, versions: { "main.tex": 1 } }),
    );
    const remover = deferred<void>();
    repoMocks.remove.mockReturnValueOnce(remover.promise);
    const { container } = renderRecovery("user-a", "proj-1");
    await flushMicrotasks();
    expect(queryChild(container)).toBeNull();

    click(getButton(container, "Discard draft"));
    expect(repoMocks.remove).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(queryChild(container)).toBeNull();
    expect(container.textContent).toContain("unsaved draft");

    remover.resolve();
    await flushMicrotasks();

    expect(queryChild(container)).not.toBeNull();
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toBe(
      "server v1",
    );
  });

  it("draft load failure shows a notice but still allows editing", async () => {
    repoMocks.load.mockRejectedValueOnce(new Error("indexeddb down"));
    seedStore();
    const { container } = renderRecovery("user-a", "proj-1");
    await flushMicrotasks();

    expect(container.textContent).toContain(
      "Browser draft recovery is unavailable",
    );
    expect(queryChild(container)).not.toBeNull();
  });

  it("offline edits debounce a repository save without a cloud save", async () => {
    const cloudSave = vi.fn(async () => ({ version: 2 }));
    seedStore({
      filesByPath: { "main.tex": "v1" },
      versionsByPath: { "main.tex": 1 },
      dirtyByPath: { "main.tex": false },
      persistence: { save: cloudSave },
    });
    repoMocks.load.mockResolvedValueOnce(null);
    setOnline(false);
    const { container } = renderRecovery("user-a", "proj-1");
    await flushMicrotasks();
    expect(queryChild(container)).not.toBeNull();

    vi.useFakeTimers();
    try {
      act(() => {
        useWorkbenchStore.getState().updateActiveFileContent("v2 offline");
      });
      expect(repoMocks.save).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(750);
      });

      expect(repoMocks.save).toHaveBeenCalledTimes(1);
      const saved = repoMocks.save.mock.calls[0][0] as CloudDraft;
      expect(saved.userId).toBe("user-a");
      expect(saved.projectId).toBe("proj-1");
      expect(saved.files["main.tex"]).toBe("v2 offline");
      expect(saved.dirtyPaths).toEqual(["main.tex"]);
      expect(saved.incarnations).toEqual({ "main.tex": "file-1" });
      expect(cloudSave).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
    setOnline(true);
  });

  it("unmount flush cannot capture a different account's content", async () => {
    repoMocks.load.mockResolvedValueOnce(null);
    seedStore({
      cloudUserId: "user-A",
      projectId: "proj-shared",
      filesByPath: { "main.tex": "account-A-content" },
      versionsByPath: { "main.tex": 1 },
      dirtyByPath: { "main.tex": true },
    });
    const { container } = renderRecovery("user-A", "proj-shared");
    await flushMicrotasks();
    expect(queryChild(container)).not.toBeNull();
    repoMocks.save.mockClear();

    act(() => {
      useWorkbenchStore.setState({
        cloudUserId: "user-B",
        filesByPath: { "main.tex": "account-B-content" },
        versionsByPath: { "main.tex": 9 },
        dirtyByPath: { "main.tex": true },
      });
    });
    const leaked = repoMocks.save.mock.calls.some(
      (call) =>
        (call[0] as CloudDraft).userId === "user-A" &&
        (call[0] as CloudDraft).files["main.tex"] === "account-B-content",
    );
    expect(leaked).toBe(false);

    act(() => {
      const root = roots[roots.length - 1];
      root.unmount();
      roots.pop();
      container.remove();
      const index = containers.indexOf(container);
      if (index >= 0) containers.splice(index, 1);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const savesForA = repoMocks.save.mock.calls.filter(
      (call) => (call[0] as CloudDraft).userId === "user-A",
    );
    for (const call of savesForA) {
      expect((call[0] as CloudDraft).files["main.tex"]).not.toBe(
        "account-B-content",
      );
    }
  });

  it("a manual source change after the recovery pane keeps the editor hidden", async () => {
    seedStore({
      filesByPath: { "main.tex": "server v1" },
      versionsByPath: { "main.tex": 2 },
      dirtyByPath: { "main.tex": false },
    });
    repoMocks.load.mockResolvedValueOnce(
      makeDraft({ files: { "main.tex": "drafted" }, versions: { "main.tex": 1 } }),
    );
    const { container } = renderRecovery("user-a", "proj-1");
    await flushMicrotasks();
    expect(queryChild(container)).toBeNull();
    expect(container.textContent).toContain("unsaved draft");

    act(() => {
      useWorkbenchStore.setState({
        filesByPath: { "main.tex": "manual-server-update" },
        versionsByPath: { "main.tex": 4 },
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("unsaved draft");
    expect(queryChild(container)).toBeNull();
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toBe(
      "manual-server-update",
    );
  });
  it.each(["old-file-id", undefined])("restores the original draft identity (%s) and conflicts with a recreated same-version row", async (originalIdentity) => {
    const save = vi.fn(async () => ({ version: 1, conflict: true }));
    seedStore({ filesByPath: { "main.tex": "recreated server file" }, versionsByPath: { "main.tex": 1 },
      incarnationsByPath: { "main.tex": "new-file-id" }, persistence: { save } });
    repoMocks.load.mockResolvedValueOnce(makeDraft({ versions: { "main.tex": 1 },
      incarnations: originalIdentity ? { "main.tex": originalIdentity } : undefined }));
    const { container } = renderRecovery("user-a", "proj-1");
    await flushMicrotasks();
    click(getButton(container, "Restore browser draft"));
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toBe("draft content");
    expect(useWorkbenchStore.getState().saveStatus).toBe("conflict");
    expect(useWorkbenchStore.getState().incarnationsByPath["main.tex"]).toBe(originalIdentity);
    await act(async () => { await useWorkbenchStore.getState().saveActiveFile(); });
    expect(save).toHaveBeenCalledWith("main.tex", "draft content", 1, originalIdentity);
    expect(useWorkbenchStore.getState().dirtyByPath["main.tex"]).toBe(true);
  });

});
