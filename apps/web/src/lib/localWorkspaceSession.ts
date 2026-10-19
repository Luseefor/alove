import type { StoreApi } from "zustand";
import type { WorkbenchState } from "@/stores/workbenchStore";
import {
  LocalWorkspaceConflictError,
  type LocalWorkspaceInput,
  type createLocalWorkspaceRepository,
} from "@/lib/localWorkspace";

type Repository = Pick<
  ReturnType<typeof createLocalWorkspaceRepository>,
  "load" | "save"
>;

/** One serialized save stream per mounted local project, after hydration. */
export function createLocalWorkspaceSession({
  store,
  repository,
  seed,
  createIfMissing = true,
}: {
  store: StoreApi<WorkbenchState>;
  repository: Repository;
  seed: LocalWorkspaceInput;
  createIfMissing?: boolean;
}) {
  let disposed = false;
  let hydrated = false;
  let conflicted = false;
  let revision = 0;
  let persisted = "";
  let observed = "";
  let pending: Promise<void> | null = null;
  let unsubscribe: (() => void) | undefined;

  const snapshot = (): LocalWorkspaceInput => {
    const state = store.getState();
    return {
      id: seed.id,
      title: state.projectTitle,
      files: { ...state.filesByPath },
      mainFile: state.mainFile,
      activeFile: state.activeFileId,
      openFiles: [...state.openFiles],
    };
  };

  async function drain() {
    while (!disposed && !conflicted) {
      const input = snapshot();
      const key = JSON.stringify(input);
      if (key === persisted) return;
      store.setState({ saveStatus: "saving", saveMessage: null });
      try {
        const saved = await repository.save(input, revision);
        revision = saved.revision;
        persisted = key;
        if (disposed) return;
        const current = store.getState();
        const dirtyByPath = { ...current.dirtyByPath };
        for (const [path, content] of Object.entries(input.files)) {
          if (current.filesByPath[path] === content) dirtyByPath[path] = false;
        }
        store.setState({
          dirtyByPath,
          saveStatus:
            JSON.stringify(snapshot()) === persisted ? "saved" : "unsaved",
        });
      } catch (error) {
        if (disposed) return;
        conflicted = error instanceof LocalWorkspaceConflictError;
        store.setState({
          saveStatus: conflicted ? "conflict" : "error",
          saveMessage: conflicted
            ? "A different tab saved a newer version. Export your edits before reloading."
            : "Could not save to this browser. Your edits are still here. Retry or export your source.",
        });
        return;
      }
    }
  }

  function save(): Promise<void> {
    if (!hydrated || disposed || conflicted) return Promise.resolve();
    if (pending) return pending;
    // Enter through a microtask so subscription callbacks see the pending write.
    pending = Promise.resolve()
      .then(drain)
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  store.setState({ saveStatus: "loading", saveMessage: null, persistence: {} });
  const ready = (async () => {
    try {
      const loaded = await repository.load(seed.id);
      if (!loaded && !createIfMissing)
        throw new Error("Project does not exist");
      if (disposed) return;
      const initial = loaded ?? seed;
      revision = loaded?.revision ?? 0;
      store.getState().initializeProject({
        projectId: seed.id,
        title: initial.title,
        mainFile: initial.mainFile,
        activeFile: initial.activeFile,
        openFiles: initial.openFiles,
        files: Object.entries(initial.files).map(([path, content]) => ({
          path,
          content,
        })),
      });
      hydrated = true;
      observed = JSON.stringify(snapshot());
      persisted = loaded ? observed : "";
      store.setState({
        dirtyByPath: loaded
          ? store.getState().dirtyByPath
          : Object.fromEntries(
              Object.keys(initial.files).map((path) => [path, true]),
            ),
        saveStatus: loaded ? "saved" : "unsaved",
        persistence: { saveWorkspace: save },
      });
      unsubscribe = store.subscribe((state, previous) => {
        if (
          state.filesByPath === previous.filesByPath &&
          state.projectTitle === previous.projectTitle &&
          state.mainFile === previous.mainFile &&
          state.activeFileId === previous.activeFileId &&
          state.openFiles === previous.openFiles
        )
          return;
        const next = JSON.stringify(snapshot());
        if (next === observed) return;
        observed = next;
        if (!conflicted)
          store.setState({ saveStatus: "unsaved", saveMessage: null });
        void save();
      });
      await save();
    } catch {
      if (disposed) return;
      // Failed reads must never seed over a workspace we could not inspect.
      store.getState().initializeProject({
        projectId: seed.id,
        title: "Workspace unavailable",
        files: [],
      });
      store.setState({
        saveStatus: "error",
        saveMessage:
          "Could not open this workspace. Stored data has been left intact. Reload to try again.",
      });
    }
  })();

  return {
    ready,
    save,
    dispose() {
      disposed = true;
      unsubscribe?.();
      if (store.getState().persistence.saveWorkspace === save) {
        store.setState({ persistence: {} });
      }
    },
  };
}
