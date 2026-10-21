import type { StoreApi } from "zustand";
import { prepareSourceReplacement } from "./prepareSourceReplacement";
import type { WorkbenchState } from "@/stores/workbenchStore";
import {
  LocalWorkspaceConflictError,
  type LocalWorkspaceInput,
  type createLocalWorkspaceRepository,
} from "@/lib/localWorkspace";

type Repository = Pick<
  ReturnType<typeof createLocalWorkspaceRepository>,
  "load" | "save"
> &
  Partial<
    Pick<ReturnType<typeof createLocalWorkspaceRepository>, "listHistory">
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
  // Preserve the exact draft before a rename/delete even if a previous save is still in flight.
  const beforeRemoval: LocalWorkspaceInput[] = [];

  const snapshot = (state = store.getState()): LocalWorkspaceInput => {
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
      const queued = beforeRemoval[0];
      const input = queued ?? snapshot();
      const key = JSON.stringify(input);
      if (key === persisted) {
        if (queued) {
          beforeRemoval.shift();
          continue;
        }
        return;
      }
      store.setState({ saveStatus: "saving", saveMessage: null });
      try {
        const saved = await repository.save(input, revision);
        revision = saved.revision;
        persisted = key;
        if (queued) beforeRemoval.shift();
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
        if (beforeRemoval.length) {
          // A failed pre-delete checkpoint must leave its otherwise hidden draft exportable.
          const current = snapshot();
          const recovered = Object.assign(
            {},
            ...beforeRemoval.map((row) => row.files),
            current.files,
          ) as Record<string, string>;
          const mainFile =
            current.mainFile ??
            Object.keys(recovered).find((path) => path.endsWith(".tex")) ??
            null;
          store
            .getState()
            .initializeProject({
              projectId: seed.id,
              title: current.title,
              mainFile,
              activeFile: current.activeFile,
              openFiles: current.openFiles,
              files: Object.entries(recovered).map(([path, content]) => ({
                path,
                content,
              })),
            });
          store.setState({
            dirtyByPath: Object.fromEntries(
              Object.keys(recovered).map((path) => [path, true]),
            ),
          });
        }
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

  async function restoreHistory(checkpointRevision: number): Promise<void> {
    await save();
    if (
      disposed ||
      !hydrated ||
      conflicted ||
      store.getState().saveStatus !== "saved"
    )
      throw new Error(
        "Save or export your current work before restoring history.",
      );
    if (pending) throw new Error("A save is in progress. Try restoring again.");
    const before = JSON.stringify(snapshot());
    const operation = async () => {
      const rows = await repository.listHistory?.(seed.id);
      const target = rows?.find((row) => row.revision === checkpointRevision);
      if (!target)
        throw new Error(
          "This checkpoint is no longer available. Reopen history.",
        );
      if (disposed) return;
      if (before !== JSON.stringify(snapshot())) {
        await drain();
        throw new Error(
          "Your work changed while loading history. Review it before restoring.",
        );
      }
      const input: LocalWorkspaceInput = {
        id: seed.id,
        title: target.title,
        files: target.files,
        mainFile: target.mainFile,
        activeFile: target.activeFile,
        openFiles: target.openFiles,
      };
      store.setState({ saveStatus: "saving", saveMessage: null });
      // The repository checkpoints the current source and writes the restored source atomically.
      const saved = await repository.save(input, revision);
      revision = saved.revision;
      persisted = JSON.stringify(input);
      if (disposed) return;
      if (before !== JSON.stringify(snapshot())) {
        // Preserve typing during the transaction and persist it at the new revision.
        await drain();
        throw new Error(
          "Your work changed while restoring. Your newer edits were kept.",
        );
      }
      observed = persisted;
      store.getState().stopCompilePolling();
      store.getState().initializeProject({
        projectId: seed.id,
        title: input.title,
        mainFile: input.mainFile,
        activeFile: input.activeFile,
        openFiles: input.openFiles,
        files: Object.entries(input.files).map(([path, content]) => ({
          path,
          content,
        })),
      });
      store.setState({ saveStatus: "saved", saveMessage: null });
    };
    pending = operation()
      .catch((error) => {
        if (!disposed && store.getState().saveStatus === "saving") {
          conflicted = error instanceof LocalWorkspaceConflictError;
          store.setState({
            saveStatus: conflicted ? "conflict" : "error",
            saveMessage:
              "History restore failed. Your current source is still available; retry or export it.",
          });
        }
        throw error;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }

  store.setState({ projectRole: "owner", cloudUserId: null, saveStatus: "loading", saveMessage: null, persistence: {} });
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
        persistence: {
          saveWorkspace: save,
          prepareSourceReplacement: args => prepareSourceReplacement(args, store),
          ...(repository.listHistory
            ? {
                listHistory: () => repository.listHistory!(seed.id),
                restoreHistory,
              }
            : {}),
        },
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
        if (
          Object.keys(previous.filesByPath).some(
            (path) => !Object.hasOwn(state.filesByPath, path),
          )
        )
          beforeRemoval.push(snapshot(previous));
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
