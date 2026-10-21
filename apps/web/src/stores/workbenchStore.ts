import { normalizeCompilePath, type Diagnostic, type SyncTexMapping } from "@alove/protocol";
import { findPdfForSource, findSourceForPdf, pdfPointToSyncTop } from "@/lib/synctex";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { preferenceStorage } from "@/lib/preferenceStorage";
import { useIdeSettingsStore } from "@/stores/ideSettingsStore";
import { pollCompileJob } from "@/lib/compilePoll";
import { normalizeDiagnosticFile } from "@/lib/editorDiagnostics";
import { BibliographyService } from "@/services/BibliographyService";
import { ProjectService } from "@/services/ProjectService";
import { OutlineService, type OutlineNode } from "@/services/OutlineService";
import { applyReplaceToFiles, searchProjectFiles } from "@/lib/projectSearch";

import { createBuildRecord, type BuildRecord } from "@/lib/buildRecord";
import { buildRecordRepository } from "@/lib/buildRecordRepository";

function projectTreeFromFiles(filesByPath: Record<string, string>) {
  return ProjectService.buildTree(
    Object.entries(filesByPath).map(([path, content]) => ({ path, content })),
  );
}

export type ProjectFile = {
  id: string;
  name: string;
  path: string;
  type: "tex" | "bib" | "sty" | "image" | "pdf" | "folder" | "markdown";
  content?: string;
  children?: ProjectFile[];
};

export type ProjectSearchResult = {
  path: string;
  line: number;
  column: number;
  /** 1-based end line (== line for single-line matches). */
  endLine: number;
  /** 1-based exclusive end column in UTF-16 code units. */
  endColumn: number;
  /** UTF-16 length of the exact matched substring. */
  length: number;
  preview: string;
  /** Full start-line text for exact highlight rendering. */
  lineText: string;
  /** Exact matched substring (may span lines for multiline). */
  matchText: string;
};

export type RemoteProjectFile = { path: string; content: string; version: number; incarnation?: string };

export type EditorCommandKind =
  | "undo"
  | "redo"
  | "selectAll"
  | "cut"
  | "copy"
  | "paste";

export interface WorkbenchState {
  sidebarOpen: boolean;
  bottomPanelOpen: boolean;
  activeRail: "explorer" | "search" | "source-control" | "ai";
  activeBottomTab: "problems" | "log" | "terminal" | "output" | "ai" | "citations";
  activeFileId: string | null;
  openFiles: string[];

  lastBuildRecord: BuildRecord | null;
  buildHistoryError: string | null;
  buildRecoveryOpen: boolean;
  setBuildRecoveryOpen: (open: boolean) => void;
  applyRecoveryFile: (args: { projectId: string; mainFile: string; expectedFiles: Record<string, string>; engine: BuildRecord["engine"]; cleanAux: boolean; path: string; content: string | null }) => boolean;
  projectId: string | null;
  cloudUserId: string | null;
  projectRole: "owner" | "editor" | "viewer" | null;
  projectTitle: string;
  mainFile: string | null;
  documentRevision: number;
  pdfSourceRevision: number | null;
  pdfMainFile: string | null;
  /** Bounded per-run SyncTeX mapping from the last successful compile.
   *  Provenance mirrors the PDF: revision + root captured at request time,
   *  preserved through failed rebuilds, cleared on project switch. */
  synctexMapping: SyncTexMapping | null;
  synctexRevision: number | null;
  synctexMainFile: string | null;
  /** Coordinate highlight for the interactive PDF viewer, in top-based PDF
   *  big points. Set by source->PDF navigation; cleared on project switch.
   *  The viewer hides it whenever the source moved past synctexRevision. */
  pdfHighlight: {
    page: number;
    xBp: number;
    yTopBp: number;
    wBp: number;
    hBp: number;
    nonce: number;
  } | null;
  saveStatus: "loading" | "unsaved" | "saving" | "saved" | "error" | "conflict";
  saveMessage: string | null;
  projectTree: ProjectFile[];
  filesByPath: Record<string, string>;
  versionsByPath: Record<string, number>;
  /** Row `_id` per path. Held as the delete+recreate incarnation token and
   *  forwarded as expectedIncarnation. Preserved across cloud-draft restore
   *  (which only rewrites files/versions/dirty) so the token baseline survives. */
  incarnationsByPath: Record<string, string>;
  remoteFiles: RemoteProjectFile[] | null;
  dirtyByPath: Record<string, boolean>;
  outline: OutlineNode[];
  focusedLine: number | null;
  activeSelection: { start: number; end: number } | null;
  nextSelection: { start: number; end: number } | null;
  editorCommand: { kind: EditorCommandKind; nonce: number } | null;
  /** Incremented so the editor can open the find bar from the menu bar. */
  findBarRequestId: number;
  /** When false, the source editor keeps long lines on one row (horizontal scroll). */
  editorWordWrap: boolean;
  settingsModalOpen: boolean;
  keyboardShortcutsModalOpen: boolean;
  projectSearchQuery: string;
  projectSearchResults: ProjectSearchResult[];
  diagnostics: Diagnostic[];
  diagnosticRevision: number | null;
  buildLog: string;
  buildStatus: "idle" | "queued" | "running" | "ready" | "failed";
  buildMessage: string | null;
  pdfDataUrl: string | null;
  pdfZoom: number;
  pdfPage: number;
  pdfPageCount: number;
  stats: {
    words: number;
    chars: number;
    equations: number;
    figures: number;
    tables: number;
    pages: number | null;
  };
  cursor: {
    line: number;
    column: number;
  };
  persistence: {
    saveWorkspace?: () => Promise<void>;
    checkpointSource?: (expectedRevision: number) => Promise<void>;
    prepareSourceReplacement?: (args: { query: string; replaceText: string; affectedPaths: string[]; expectedDocumentRevision: number }) => Promise<{ proceed: boolean; message?: string } | boolean | void>;
    listHistory?: () => Promise<import("@/lib/localWorkspace").LocalWorkspace[]>;
    restoreHistory?: (revision: number) => Promise<void>;
    save?: (path: string, content: string, expectedVersion?: number, expectedIncarnation?: string) => Promise<{ version: number; incarnation?: string; conflict?: boolean; deleted?: boolean; recreated?: boolean; tokenRequired?: boolean } | void>;
    delete?: (path: string, expectedVersion?: number, expectedIncarnation?: string) => Promise<{ deleted: boolean; conflict?: boolean; alreadyMissing?: boolean; version?: number; content?: string; incarnation?: string; recreated?: boolean; tokenRequired?: boolean } | void>;
    rename?: (oldPath: string, newPath: string, expectedVersion?: number, expectedIncarnation?: string) => Promise<{ renamed?: boolean; conflict?: boolean; version?: number; content?: string; incarnation?: string; recreated?: boolean; tokenRequired?: boolean } | void>;
    renameProject?: (title: string) => Promise<void>;
    setMainFile?: (path: string) => Promise<void>;
  };

  setSettingsModalOpen: (open: boolean) => void;
  setKeyboardShortcutsModalOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  toggleBottomPanel: () => void;
  setSidebarOpen: (open: boolean) => void;
  setBottomPanelOpen: (open: boolean) => void;
  setActiveRail: (rail: WorkbenchState["activeRail"]) => void;
  setActiveBottomTab: (tab: WorkbenchState["activeBottomTab"]) => void;
  setActiveFile: (id: string | null) => void;
  setProjectTree: (tree: ProjectFile[]) => void;
  setProjectTitle: (title: string) => Promise<boolean>;
  setMainFile: (path: string) => void;
  stopCompilePolling: () => void;
  activeCompileJobId: string | null;
  cancelCompile: () => Promise<void>;
  mergeRemoteProject: (args: { projectId: string; title?: string; files: RemoteProjectFile[] }) => void;
  initializeProject: (args: {
    projectId: string | null;
    title?: string;
    mainFile?: string | null;
    activeFile?: string | null;
    openFiles?: string[];
    files: { path: string; content: string; version?: number; incarnation?: string }[];
  }) => void;
  updateActiveFileContent: (content: string) => void;
  saveActiveFile: () => Promise<void>;
  saveAllDirtyFiles: () => Promise<void>;
  setPersistenceHandlers: (handlers: WorkbenchState["persistence"]) => void;
  createFile: (path: string, content?: string, options?: { open?: boolean }) => void;
  deleteFile: (path: string) => void;
  renameFile: (oldPath: string, newPath: string) => void;
  appendToActiveFile: (text: string) => void;
  transformActiveFile: (transformer: (current: string) => string) => void;
  /**
   * Replace across files in one atomic source update (single set(), so local
   * autosave sees exactly one revision for undo/checkpoint recovery).
   * Stale compare contract: when `expectedDocumentRevision` is provided and
   * differs from the current documentRevision, or when `target` no longer
   * matches current content, the call is refused with 0 and no mutation.
   * Viewers (`projectRole === "viewer"`) are always refused with 0.
   * Returns the replaced match count (0 = none/stale/denied).
   */
  replaceAcrossFiles: (findText: string, replaceText: string, options?: { texOnly?: boolean; caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean; include?: string; exclude?: string; expectedDocumentRevision?: number; target?: { path: string; line: number; column: number } }) => number;
  setActiveSelection: (selection: { start: number; end: number } | null) => void;
  wrapSelectionOrInsert: (before: string, after?: string, fallback?: string) => void;
  requestEditorCommand: (kind: EditorCommandKind) => void;
  requestEditorFindBar: () => void;
  toggleEditorWordWrap: () => void;
  runProjectSearch: (query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean; include?: string; exclude?: string; texOnly?: boolean; maxResults?: number }) => number;
  clearProjectSearch: () => void;
  updateOutlineForActiveFile: () => void;
  setFocusedLine: (line: number | null) => void;
  jumpToDiagnostic: (diagnostic: Diagnostic) => void;
  setPdfZoom: (zoom: number) => void;
  setPdfPage: (page: number) => void;
  setPdfPageCount: (count: number) => void;
  /** Source->PDF: jump the preview to the page for the current cursor.
   *  Sets the coordinate highlight for the interactive viewer.
   *  Returns the target page, or null when stale/unmapped. */
  goToPdfForCursor: () => number | null;
  /** PDF->source: open the mapped source for a PDF page (1-based).
   *  Returns the target, or null when stale/unmapped. */
  goToSourceForPdfPage: (page?: number) => { file: string; line: number } | null;
  /** PDF->source from a canvas point: pdf.js PDF big points plus the
   *  rendered page height for the top-left SyncTeX orientation.
   *  Returns the target, or null when stale/unmapped. */
  goToSourceForPdfPoint: (args: {
    page: number;
    xPdf: number;
    yPdf: number;
    pageHeightBp: number;
  }) => { file: string; line: number } | null;
  runCompile: (engine?: "pdflatex" | "xelatex" | "lualatex") => Promise<void>;
  openFile: (id: string) => void;
  closeFile: (id: string) => void;
  closeActiveEditorTab: () => void;
}

function calculateStats(content: string) {
  const words = content.trim().split(/\s+/).filter((w) => w.length > 0).length;
  const chars = content.length;
  const equations =
    (content.match(/\\begin\{equation\}/g) || []).length +
    (content.match(/\$/g) || []).length / 2;
  const figures = (content.match(/\\begin\{figure\}/g) || []).length;
  const tables = (content.match(/\\begin\{table\}/g) || []).length;
  return { words, chars, equations, figures, tables, pages: null };
}

let compileSequence = 0;
let activeCompile: AbortController | null = null;

export const useWorkbenchStore = create<WorkbenchState>()(
  persist(
    (set, get) => ({
      sidebarOpen: true,
      bottomPanelOpen: true,
      activeRail: "explorer",
      activeBottomTab: "problems",
      activeFileId: null,
      openFiles: [],
      lastBuildRecord: null,
      buildHistoryError: null,
      buildRecoveryOpen: false,
      setBuildRecoveryOpen: (open) => set({ buildRecoveryOpen: open }),
      applyRecoveryFile: (args) => {
        if (get().projectRole === "viewer") return false;
        const state = get();
        if (normalizeCompilePath(args.path) !== args.path || state.projectId !== args.projectId || !args.projectId.startsWith("local") || state.mainFile !== args.mainFile ||
            useIdeSettingsStore.getState().defaultCompilerEngine !== args.engine ||
            useIdeSettingsStore.getState().compilerCleanAux !== args.cleanAux ||
            state.buildStatus === "queued" || state.buildStatus === "running" ||
            Object.keys(state.filesByPath).length !== Object.keys(args.expectedFiles).length ||
            Object.entries(args.expectedFiles).some(([path, content]) => !Object.hasOwn(state.filesByPath, path) || state.filesByPath[path] !== content)) return false;
        const files = { ...state.filesByPath };
        if (args.content === null) delete files[args.path];
        else files[args.path] = args.content;
        if (!Object.hasOwn(files, args.mainFile)) return false;
        const dirty = { ...state.dirtyByPath };
        if (args.content === null) delete dirty[args.path];
        else dirty[args.path] = true;
        const activeFileId = state.activeFileId && Object.hasOwn(files, state.activeFileId) ? state.activeFileId : args.mainFile;
        set({ filesByPath: files, dirtyByPath: dirty, projectTree: projectTreeFromFiles(files),
          activeFileId, openFiles: state.openFiles.filter((path) => Object.hasOwn(files, path)),
          saveStatus: "unsaved", saveMessage: null });
        return true;
      },
      cloudUserId: null,
      projectRole: "owner",
      projectId: null,
      projectTitle: "Deep Learning Survey",
      mainFile: null,
      documentRevision: 0,
      pdfSourceRevision: null,
      pdfMainFile: null,
      synctexMapping: null,
      synctexRevision: null,
      synctexMainFile: null,
      pdfHighlight: null,
      saveStatus: "unsaved",
      saveMessage: null,
      projectTree: [],
      filesByPath: {},
      versionsByPath: {},
      incarnationsByPath: {},
      remoteFiles: null,
      dirtyByPath: {},
      outline: [],
      focusedLine: null,
      activeSelection: null,
      nextSelection: null,
      editorCommand: null,
      findBarRequestId: 0,
      editorWordWrap: true,
      settingsModalOpen: false,
      keyboardShortcutsModalOpen: false,
      projectSearchQuery: "",
      projectSearchResults: [],
      diagnostics: [],
      diagnosticRevision: null,
      buildLog: "",
      buildStatus: "idle",
      activeCompileJobId: null,
      buildMessage: null,
      pdfDataUrl: null,
      pdfZoom: 100,
      pdfPage: 1,
      pdfPageCount: 1,
      stats: {
        words: 0,
        chars: 0,
        equations: 0,
        figures: 0,
        tables: 0,
        pages: null,
      },
      cursor: {
        line: 1,
        column: 1,
      },
      persistence: {},

      setSettingsModalOpen: (open) => set({ settingsModalOpen: open }),
      setKeyboardShortcutsModalOpen: (open) => set({ keyboardShortcutsModalOpen: open }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setBottomPanelOpen: (open) => set({ bottomPanelOpen: open }),
      setActiveRail: (rail) => set({ activeRail: rail, sidebarOpen: true }),
      setActiveBottomTab: (tab) => set({ activeBottomTab: tab, bottomPanelOpen: true }),
      setActiveFile: (id) => {
        set({ activeFileId: id });
        const content = id ? get().filesByPath[id] ?? "" : "";
        set({
          outline: OutlineService.parse(content),
          focusedLine: null,
          stats: calculateStats(content),
        });
      },
      setProjectTree: (tree) => set({ projectTree: tree }),
      setProjectTitle: async (title) => {
        if (get().projectRole === "viewer") return false;
        const name=title.trim();
        if(!name || name.length>200)return false;
        const {projectId,persistence}=get();
        try {
          await persistence.renameProject?.(name);
          if(get().projectId!==projectId)return false;
          set({projectTitle:name});
          return true;
        } catch {
          if(get().projectId===projectId)set({saveMessage:"Project rename failed. The original name was kept."});
          return false;
        }
      },
      setMainFile: (path) => {
        if (get().projectRole === "viewer") return;
        const {projectId,persistence}=get();
        if (!path.endsWith(".tex") || !Object.hasOwn(get().filesByPath,path))return;
        if(!persistence.setMainFile){set({mainFile:path});return;}
        void persistence.setMainFile(path).then(()=>{if(get().projectId===projectId && Object.hasOwn(get().filesByPath,path))set({mainFile:path});}).catch(()=>{if(get().projectId===projectId)set({saveMessage:"Could not change the main document. Try again."});});
      },
      stopCompilePolling: () => {
        compileSequence += 1;
        activeCompile?.abort();
        activeCompile = null;
        if (get().buildStatus === "queued" || get().buildStatus === "running") set({ buildStatus: "idle", buildMessage: null });
      },
      cancelCompile: async () => {
        const id = get().activeCompileJobId;
        if (!id) return;
        set({ buildMessage: "Requesting cancellation…" });
        try {
          const response = await fetch(`/api/compile/${encodeURIComponent(id)}`, { method: "DELETE" });
          if (!response.ok) throw new Error("Could not cancel. Retry to confirm the build stopped.");
          const result = await response.json() as { state?: string };
          if (get().activeCompileJobId !== id) return;
          if (result.state === "cancelled") {
            get().stopCompilePolling();
            set({ activeCompileJobId: null, buildStatus: "failed", buildMessage: "Build cancelled." });
          } else if (result.state === "completed" || result.state === "failed") {
            set({ buildMessage: "Build finished. Retrieving the result…" });
          } else set({ buildMessage: "Cancellation requested. Waiting for the worker to stop…" });
        } catch (error) {
          if (get().activeCompileJobId === id) set({ buildMessage: error instanceof Error ? error.message : "Cancellation unavailable" });
        }
      },
      setPersistenceHandlers: (handlers) => set({ persistence: handlers }),
      mergeRemoteProject: ({ projectId, title, files }) => {
        const state = get();
        if (state.projectId !== projectId) {
          get().initializeProject({ projectId, title, files });
          set({ saveStatus: "saved", saveMessage: null, remoteFiles: files });
          return;
        }
        const previous = new Map((state.remoteFiles ?? []).map((file) => [file.path, file]));
        const incoming = new Map(files.map((file) => [file.path, file]));
        const nextFiles = new Map(Object.entries(state.filesByPath));
        const nextVersions = new Map(Object.entries(state.versionsByPath));
        const nextIncarnations = new Map(Object.entries(state.incarnationsByPath));
        const nextDirty = new Map(Object.entries(state.dirtyByPath));
        const conflicts: string[] = [];
        let changed = false;
        for (const path of new Set([...previous.keys(), ...incoming.keys()])) {
          const before = previous.get(path);
          const remote = incoming.get(path);
          if (before?.content === remote?.content && before?.version === remote?.version && (before?.incarnation ?? undefined) === (remote?.incarnation ?? undefined)) continue;
          const local = nextFiles.get(path);
          const localVersion = nextVersions.get(path) ?? 0;
          // A mutation acknowledgement may arrive before its query echo.
          if (remote && remote.version < localVersion && remote.version > (before?.version ?? 0)) continue;
          // Delete+recreate allocates a new row id. A clean client adopts the
          // new incarnation; a dirty client holding the old token conflicts
          // so its draft is preserved instead of being silently rebased.
          const incarnationChanged = (before?.incarnation ?? undefined) !== (remote?.incarnation ?? undefined) &&
            (before !== undefined || remote !== undefined);
          if (incarnationChanged && remote) {
            if (!nextFiles.has(path)) {
              // Coalesced delete+recreate echo for a locally absent path:
              // adopt the new row unless our own delete is still in flight
              // (its acknowledgement reconciles the echo).
              if (!isOpInFlight(pendingCloudDeletes, projectId, path) && !isOpInFlight(pendingFileSaves, projectId, path)) {
                nextFiles.set(path, remote.content);
                nextVersions.set(path, remote.version);
                if (remote.incarnation !== undefined) nextIncarnations.set(path, remote.incarnation);
                else nextIncarnations.delete(path);
                nextDirty.set(path, false);
                changed = true;
              }
              continue;
            }
            const dirty = nextDirty.get(path) ?? false;
            const inFlight = isOpInFlight(pendingFileSaves, projectId, path) || isOpInFlight(pendingCloudDeletes, projectId, path) || isRenameInFlight(projectId, path);
            if (!dirty && !inFlight && local === before?.content) {
              nextFiles.set(path, remote.content);
              nextVersions.set(path, remote.version);
              if (remote.incarnation !== undefined) nextIncarnations.set(path, remote.incarnation);
              else nextIncarnations.delete(path);
              nextDirty.set(path, false);
              changed = true;
              continue;
            }
            if (local === remote.content) {
              nextVersions.set(path, remote.version);
              if (remote.incarnation !== undefined) nextIncarnations.set(path, remote.incarnation);
              if (!isOpInFlight(pendingFileSaves, projectId, path)) nextDirty.set(path, false);
              changed = true;
              continue;
            }
            if (!inFlight) conflicts.push(path);
            // Keep the local draft and its old token for the save CAS; adopt
            // the new token only once the content matches.
            continue;
          }
          if (remote && nextFiles.has(path) && local === remote.content) {
            nextVersions.set(path, remote.version);
            if (remote.incarnation !== undefined) nextIncarnations.set(path, remote.incarnation);
            if (!isOpInFlight(pendingFileSaves, projectId, path)) nextDirty.set(path, false);
            changed = true;
          } else if ((!nextFiles.has(path) && !before) ||
            (!before && !nextDirty.get(path) && remote && remote.version >= localVersion) ||
            (before && local === before.content && !nextDirty.get(path))) {
            if (remote) {
              nextFiles.set(path, remote.content);
              nextVersions.set(path, remote.version);
              if (remote.incarnation !== undefined) nextIncarnations.set(path, remote.incarnation);
              else nextIncarnations.delete(path);
              nextDirty.set(path, false);
            } else {
              nextFiles.delete(path);
              nextVersions.delete(path);
              nextIncarnations.delete(path);
              nextDirty.delete(path);
            }
            changed = true;
          } else if (nextFiles.has(path) || remote) {
            // Preserve local changes and their expected version for the save CAS.
            // Own in-flight save echoes are reconciled by the save acknowledgement.
            if (!isOpInFlight(pendingFileSaves, projectId, path)) conflicts.push(path);
          }
        }
        const fullySynced = !hasPending(pendingFileSaves, projectId) && !hasPending(pendingCloudDeletes, projectId) && !hasPending(pendingCloudRenames, projectId) && nextFiles.size === incoming.size &&
          [...incoming].every(([path, file]) => nextFiles.has(path) && nextFiles.get(path) === file.content);
        if (fullySynced && [...nextDirty.values()].some(Boolean)) {
          for (const path of nextDirty.keys()) nextDirty.set(path, false);
          changed = true;
        }
        const status = conflicts.length ? {
          saveStatus: "conflict" as const,
          saveMessage: `Remote changes to ${conflicts.join(", ")} arrived. Your local changes were kept; export source before reloading.`,
        } : fullySynced ? { saveStatus: "saved" as const, saveMessage: null } : {};
        if (!changed) {
          set({ remoteFiles: files, ...(title !== undefined ? { projectTitle: title } : {}), ...status });
          return;
        }
        const filesByPath = Object.fromEntries(nextFiles);
        const openFiles = state.openFiles.filter((path) => nextFiles.has(path));
        const activeFileId = state.activeFileId && nextFiles.has(state.activeFileId)
          ? state.activeFileId : openFiles.at(-1) ?? nextFiles.keys().next().value ?? null;
        if (activeFileId && !openFiles.includes(activeFileId)) openFiles.push(activeFileId);
        const mainFile = state.mainFile && nextFiles.has(state.mainFile) ? state.mainFile
          : nextFiles.has("main.tex") ? "main.tex" : [...nextFiles.keys()].find((path) => path.endsWith(".tex")) ?? null;
        const content = activeFileId ? filesByPath[activeFileId] : "";
        set({
          filesByPath, versionsByPath: Object.fromEntries(nextVersions), incarnationsByPath: Object.fromEntries(nextIncarnations), dirtyByPath: Object.fromEntries(nextDirty),
          remoteFiles: files,
          projectTree: projectTreeFromFiles(filesByPath), mainFile, activeFileId, openFiles,
          outline: OutlineService.parse(content), stats: calculateStats(content),
          ...(title !== undefined ? { projectTitle: title } : {}),
          ...status,
        });
      },
      initializeProject: ({ projectId, title, files, mainFile, activeFile, openFiles }) => {
        const filesByPath: Record<string, string> = {};
        const versionsByPath: Record<string, number> = {};
        const incarnationsByPath: Record<string, string> = {};
        const dirtyByPath: Record<string, boolean> = {};
        for (const file of files) {
          filesByPath[file.path] = file.content;
          versionsByPath[file.path] = file.version ?? 1;
          if (file.incarnation !== undefined) incarnationsByPath[file.path] = file.incarnation;
          dirtyByPath[file.path] = false;
        }
        const current = get();
        let nextActive = activeFile === undefined ? current.activeFileId : activeFile;
        if (!nextActive || !(nextActive in filesByPath)) {
          nextActive = files.find((f) => f.path === "main.tex")?.path ?? files.find((f) => f.path.endsWith(".tex"))?.path ?? files[0]?.path ?? null;
        }
        const nextOpen = (openFiles ?? current.openFiles).filter((f) => f in filesByPath);
        if (nextActive && !nextOpen.includes(nextActive)) nextOpen.push(nextActive);
        const activeContent = nextActive ? filesByPath[nextActive] ?? "" : "";
        set({
          projectId,
          mainFile: mainFile !== undefined && (mainFile === null || mainFile in filesByPath)
            ? mainFile
            : ("main.tex" in filesByPath ? "main.tex" : files.find((f) => f.path.endsWith(".tex"))?.path ?? null),
          projectTitle: title ?? current.projectTitle,
          filesByPath,
          projectTree: projectTreeFromFiles(filesByPath),
          versionsByPath,
          incarnationsByPath,
          remoteFiles: null,
          dirtyByPath,
          activeFileId: nextActive,
          openFiles: nextOpen,
          outline: OutlineService.parse(activeContent),
          stats: calculateStats(activeContent),
        });
      },
      updateActiveFileContent: (content) => {
        if (get().projectRole === "viewer") return;
        const { activeFileId } = get();
        if (!activeFileId) return;
        const nextFiles = { ...get().filesByPath, [activeFileId]: content };
        const nextDirty = { ...get().dirtyByPath, [activeFileId]: true };
        set({
          filesByPath: nextFiles,
          dirtyByPath: nextDirty,
          outline: OutlineService.parse(content),
          stats: calculateStats(content),
        });
      },
      saveActiveFile: async () => {
        const { persistence, activeFileId } = get();
        if (persistence.saveWorkspace) {
          await persistence.saveWorkspace();
        } else if (activeFileId) {
          await saveFileToPersistence(activeFileId);
        }
      },
      saveAllDirtyFiles: async () => {
        const { persistence, dirtyByPath } = get();
        if (persistence.saveWorkspace) {
          await persistence.saveWorkspace();
        } else {
          await Promise.all(Object.keys(dirtyByPath).filter((p) => dirtyByPath[p]).map((p) => saveFileToPersistence(p)));
        }
      },
      createFile: (path, content = "", options) => {
        if (get().projectRole === "viewer") return;
        if (!path.trim()) return;
        const shouldOpen = options?.open !== false;
        set((s) => {
          if (path in s.filesByPath) return {};
          const nextFiles = { ...s.filesByPath, [path]: content };
          // New path: no incarnation until the server acknowledges creation.
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [path]: _i, ...incarnationsRest } = s.incarnationsByPath;
          const base = {
            filesByPath: nextFiles,
            mainFile: s.mainFile ?? (path.endsWith(".tex") ? path : null),
            projectTree: projectTreeFromFiles(nextFiles),
            versionsByPath: { ...s.versionsByPath, [path]: 0 },
            incarnationsByPath: incarnationsRest,
            dirtyByPath: { ...s.dirtyByPath, [path]: true },
          };
          if (!shouldOpen) return base;
          return {
            ...base,
            openFiles: s.openFiles.includes(path) ? s.openFiles : [...s.openFiles, path],
            activeFileId: path,
            activeSelection:null,
            nextSelection:null,
            outline: OutlineService.parse(content),
          };
        });
        if (get().persistence.save) void saveFileToPersistence(path, 0);
      },
      deleteFile: (path) => {
        if (get().projectRole === "viewer") return;
        const state = get();
        if (!(path in state.filesByPath)) {
          // Still forward deletes of unknown paths so the server can confirm
          // idempotent already-missing; no local draft to protect.
          if (state.persistence.delete) {
            const version = state.versionsByPath[path];
            const incarnation = state.incarnationsByPath[path];
            void deleteFileFromPersistence(path, { content: "", version: version ?? 0, incarnation, dirty: false, openFiles: state.openFiles, activeFileId: state.activeFileId, mainFile: state.mainFile, hadLocal: false }).catch(() => {});
          }
          return;
        }
        const snapshot = {
          content: state.filesByPath[path] ?? "",
          version: state.versionsByPath[path] ?? 0,
          incarnation: state.incarnationsByPath[path],
          dirty: state.dirtyByPath[path] ?? false,
          openFiles: state.openFiles,
          activeFileId: state.activeFileId,
          mainFile: state.mainFile,
          hadLocal: true as const,
        };
        set((s) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [path]: _, ...filesByPath } = s.filesByPath;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [path]: __, ...versionsByPath } = s.versionsByPath;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [path]: _ii, ...incarnationsByPath } = s.incarnationsByPath;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [path]: ___, ...dirtyByPath } = s.dirtyByPath;
          const openFiles = s.openFiles.filter((p) => p !== path);
          const activeFileId =
            s.activeFileId === path ? openFiles[openFiles.length - 1] ?? null : s.activeFileId;
          return {
            filesByPath,
            mainFile: s.mainFile === path ? Object.keys(filesByPath).find((p) => p.endsWith(".tex")) ?? null : s.mainFile,
            projectTree: projectTreeFromFiles(filesByPath),
            versionsByPath,
            incarnationsByPath,
            dirtyByPath,
            openFiles,
            activeFileId,
            outline: OutlineService.parse(activeFileId ? filesByPath[activeFileId] ?? "" : ""),
          };
        });
        const { persistence } = get();
        if (persistence.delete) {
          void deleteFileFromPersistence(path, snapshot).catch(() => {});
        }
      },
      renameFile: (oldPath, newPath) => {
        if (get().projectRole === "viewer") return;
        const trimmed = newPath.trim().replace(/\\/g, "/");
        if (!trimmed || trimmed === oldPath) return;
        const state = get();
        if (!(oldPath in state.filesByPath)) return;
        if (trimmed in state.filesByPath) return;
        const content = state.filesByPath[oldPath] ?? "";
        const version = state.versionsByPath[oldPath] ?? 0;
        const incarnation = state.incarnationsByPath[oldPath];
        const dirty = state.dirtyByPath[oldPath] ?? false;
        const snapshot = { oldPath, trimmed, content, version, incarnation, dirty, destinationGeneration: fileGenerations.get(trimmed) ?? 0,
          openFiles: state.openFiles, activeFileId: state.activeFileId, mainFile: state.mainFile };
        set((s) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [oldPath]: _c, ...filesRest } = s.filesByPath;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [oldPath]: _v, ...verRest } = s.versionsByPath;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [oldPath]: _i, ...incRest } = s.incarnationsByPath;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [oldPath]: _d, ...dirtyRest } = s.dirtyByPath;
          const nextFiles = { ...filesRest, [trimmed]: content };
          const openFiles = s.openFiles.map((p) => (p === oldPath ? trimmed : p));
          const activeFileId = s.activeFileId === oldPath ? trimmed : s.activeFileId;
          return {
            filesByPath: nextFiles,
            mainFile: s.mainFile === oldPath
              ? (trimmed.endsWith(".tex") ? trimmed : Object.keys(filesRest).find((p) => p.endsWith(".tex")) ?? null)
              : s.mainFile ?? (trimmed.endsWith(".tex") ? trimmed : null),
            versionsByPath: { ...verRest, [trimmed]: version },
            incarnationsByPath: incarnation !== undefined ? { ...incRest, [trimmed]: incarnation } : incRest,
            dirtyByPath: { ...dirtyRest, [trimmed]: dirty },
            projectTree: projectTreeFromFiles(nextFiles),
            openFiles,
            activeFileId,
            outline: OutlineService.parse(activeFileId ? nextFiles[activeFileId] ?? "" : ""),
          };
        });
        const { persistence } = get();
        if (persistence.rename) {
          void renameFileViaPersistence(snapshot).catch(() => {});
        }
      },
      appendToActiveFile: (text) => {
        if (get().projectRole === "viewer") return;
        const {activeFileId,filesByPath,dirtyByPath,activeSelection}=get();
        if(!activeFileId)return;
        const current=filesByPath[activeFileId]??"";
        const documentEnd=current.indexOf("\\end{document}");
        const fallback=documentEnd<0?current.length:documentEnd;
        const start=Math.max(0,Math.min(activeSelection?.start??fallback,current.length));
        const end=Math.max(start,Math.min(activeSelection?.end??start,current.length));
        const next=current.slice(0,start)+text+current.slice(end);
        const selection={start:start+text.length,end:start+text.length};
        set({filesByPath:{...filesByPath,[activeFileId]:next},dirtyByPath:{...dirtyByPath,[activeFileId]:true},outline:OutlineService.parse(next),nextSelection:selection,activeSelection:selection});
      },
      transformActiveFile: (transformer) => {
        if (get().projectRole === "viewer") return;
        const { activeFileId, filesByPath, dirtyByPath } = get();
        if (!activeFileId) return;
        const current = filesByPath[activeFileId] ?? "";
        const next = transformer(current);
        set({
          filesByPath: { ...filesByPath, [activeFileId]: next },
          dirtyByPath: { ...dirtyByPath, [activeFileId]: true },
          outline: OutlineService.parse(next),
        });
      },
      replaceAcrossFiles: (findText, replaceText, options) => {
        if (!findText.trim()) return 0;
        // Viewers may search but never mutate source.
        if (get().projectRole === "viewer") return 0;
        // Explicit stale compare: caller passes the documentRevision captured
        // at search time; any intervening edit refuses the replacement so a
        // stale preview can never corrupt newer source.
        if (
          options?.expectedDocumentRevision !== undefined &&
          options.expectedDocumentRevision !== get().documentRevision
        ) {
          return 0;
        }
        const { filesByPath, dirtyByPath, activeFileId } = get();
        let outcome: { files: Record<string, string>; replacedMatches: number };
        try {
          outcome = applyReplaceToFiles(filesByPath, findText.trim(), replaceText, {
            texOnly: options?.texOnly,
            caseSensitive: options?.caseSensitive,
            wholeWord: options?.wholeWord,
            regex: options?.regex,
            include: options?.include,
            exclude: options?.exclude,
            target: options?.target,
          });
        } catch {
          // Over-broad replace (too many matches / unsafe pattern): refuse
          // rather than applying a partial rewrite.
          return 0;
        }
        if (outcome.replacedMatches === 0) return 0;
        const nextFiles = outcome.files;
        const nextDirty = { ...dirtyByPath };
        for (const path of Object.keys(nextFiles)) {
          if (nextFiles[path] !== filesByPath[path]) nextDirty[path] = true;
        }
        // One atomic source update: single set() preserves the pre-replace
        // snapshot for local autosave checkpoints and editor undo.
        set({
          filesByPath: nextFiles,
          projectTree: projectTreeFromFiles(nextFiles),
          dirtyByPath: nextDirty,
          outline: OutlineService.parse(activeFileId ? nextFiles[activeFileId] ?? "" : ""),
        });
        return outcome.replacedMatches;
      },
      setActiveSelection: (selection) => {
        const { activeFileId, filesByPath } = get();
        if (!activeFileId || !selection) {
          set({ activeSelection: selection });
          return;
        }
        const content = filesByPath[activeFileId] ?? "";
        const upToHead = content.slice(0, selection.end);
        const lines = upToHead.split("\n");
        const line = lines.length;
        const column = lines[lines.length - 1].length + 1;
        set({ activeSelection: selection, cursor: { line, column } });
      },
      wrapSelectionOrInsert: (before, after = "", fallback) => {
        if (get().projectRole === "viewer") return;
        const { activeFileId, filesByPath, dirtyByPath, activeSelection } = get();
        if (!activeFileId) return;
        const current = filesByPath[activeFileId] ?? "";
        const bodyEnd=current.indexOf("\\end{document}");
        const fallbackPosition=bodyEnd<0?current.length:bodyEnd;
        const start=Math.max(0,Math.min(activeSelection?.start??fallbackPosition,current.length));
        const end=Math.max(start,Math.min(activeSelection?.end??start,current.length));
        let next = current;
        let nextSelection = null as { start: number; end: number } | null;

        if (start !== end) {
          const selected = current.slice(start, end);
          const replaced = `${before}${selected}${after}`;
          next = `${current.slice(0, start)}${replaced}${current.slice(end)}`;
          nextSelection = {
            start,
            end: start + replaced.length,
          };
        } else {
          const insert = fallback ?? `${before}${after}`;
          next = `${current.slice(0, start)}${insert}${current.slice(end)}`;
          nextSelection = {
            start,
            end: start + insert.length,
          };
        }

        set({
          filesByPath: { ...filesByPath, [activeFileId]: next },
          dirtyByPath: { ...dirtyByPath, [activeFileId]: true },
          outline: OutlineService.parse(next),
          nextSelection,
        });
      },
      requestEditorCommand: (kind) =>
        set((s) => ({
          editorCommand: { kind, nonce: (s.editorCommand?.nonce ?? 0) + 1 },
        })),
      requestEditorFindBar: () => set((s) => ({ findBarRequestId: s.findBarRequestId + 1 })),
      toggleEditorWordWrap: () => set((s) => ({ editorWordWrap: !s.editorWordWrap })),
      runProjectSearch: (query, options) => {
        const q = query.trim();
        if (!q) {
          set({ projectSearchQuery: "", projectSearchResults: [] });
          return 0;
        }
        const { filesByPath } = get();
        // Delegates to the bounded lib scanner: binary exclusion, glob
        // filtering, whole-word, and static ReDoS rejection live there.
        // Invalid/unsafe patterns throw and are surfaced by the panel.
        const outcome = searchProjectFiles(filesByPath, q, {
          caseSensitive: options?.caseSensitive,
          wholeWord: options?.wholeWord,
          regex: options?.regex,
          include: options?.include,
          exclude: options?.exclude,
          texOnly: options?.texOnly,
          maxResults: options?.maxResults,
        });
        set({ projectSearchQuery: q, projectSearchResults: outcome.matches, activeRail: "search", sidebarOpen: true });
        return outcome.matches.length;
      },
      clearProjectSearch: () => set({ projectSearchQuery: "", projectSearchResults: [] }),
      updateOutlineForActiveFile: () => {
        const { activeFileId, filesByPath } = get();
        const content = activeFileId ? filesByPath[activeFileId] ?? "" : "";
        set({ outline: OutlineService.parse(content) });
      },
      setFocusedLine: (line) => set({ focusedLine: line }),
      jumpToDiagnostic: (diagnostic) => {
        const file = normalizeDiagnosticFile(diagnostic.file ?? get().mainFile);
        if (file && Object.hasOwn(get().filesByPath, file)) {
          get().openFile(file);
        }
        set({
          focusedLine: get().diagnostics.includes(diagnostic) && get().diagnosticRevision !== get().documentRevision ? null : diagnostic.line ?? null,
          activeBottomTab: "problems",
        });
      },
      setPdfZoom: (zoom) => set({ pdfZoom: Math.max(30, Math.min(250, zoom)) }),
      setPdfPage: (page) =>
        set((s) => ({ pdfPage: Math.max(1, Math.min(s.pdfPageCount || 1, page)) })),
      setPdfPageCount: (count) => set({ pdfPageCount: Math.max(1, count) }),
      goToPdfForCursor: () => {
        const s = get();
        if (!s.synctexMapping || s.synctexRevision === null) return null;
        if (s.documentRevision !== s.synctexRevision) return null;
        const file = s.activeFileId;
        if (!file) return null;
        const line = s.cursor?.line ?? 1;
        const target = findPdfForSource(s.synctexMapping, file, line);
        if (!target) return null;
        get().setPdfPage(target.page);
        set((prev) => ({
          pdfHighlight: {
            page: target.page,
            xBp: target.rect.xBp,
            yTopBp: target.rect.yTopBp,
            wBp: target.rect.wBp,
            hBp: target.rect.hBp,
            nonce: (prev.pdfHighlight?.nonce ?? 0) + 1,
          },
        }));
        return target.page;
      },
      goToSourceForPdfPage: (page) => {
        const s = get();
        if (!s.synctexMapping || s.synctexRevision === null) return null;
        if (s.documentRevision !== s.synctexRevision) return null;
        const target = findSourceForPdf(s.synctexMapping, page ?? s.pdfPage);
        if (!target || !Object.hasOwn(s.filesByPath, target.file)) return null;
        get().openFile(target.file);
        set({ focusedLine: target.line });
        return target;
      },
      goToSourceForPdfPoint: ({ page, xPdf, yPdf, pageHeightBp }) => {
        const s = get();
        if (!s.synctexMapping || s.synctexRevision === null) return null;
        if (s.documentRevision !== s.synctexRevision) return null;
        const point = pdfPointToSyncTop(pageHeightBp, xPdf, yPdf);
        if (!point) return null;
        const target = findSourceForPdf(s.synctexMapping, page, point.xBp, point.yTopBp);
        if (!target || !Object.hasOwn(s.filesByPath, target.file)) return null;
        get().openFile(target.file);
        set({ focusedLine: target.line });
        return target;
      },
      runCompile: async (engineArg) => {
        if (get().projectRole === "viewer") return;
        const state = get();
        const engine = engineArg ?? useIdeSettingsStore.getState().defaultCompilerEngine;
        const cleanAux = useIdeSettingsStore.getState().compilerCleanAux;
        const mainFile = state.mainFile ?? (Object.hasOwn(state.filesByPath, "main.tex") ? "main.tex" : Object.keys(state.filesByPath).find((path) => path.endsWith(".tex")));
        // Every requested run supersedes the previous one, including invalid requests.
        activeCompile?.abort();
        activeCompile = null;
        const sequence = ++compileSequence;
        if (!mainFile || !Object.hasOwn(state.filesByPath, mainFile)) {
          set({ buildStatus: "failed", buildMessage: "Choose a main .tex document before building." });
          return;
        }
        const startedAt = Date.now();
        const request = { projectId: state.projectId ?? "local", mainFile, files: { ...state.filesByPath }, engine, cleanAux, timeoutMs: 120_000 };
        const controller = new AbortController();
        activeCompile = controller;
        const isCurrent = () => !controller.signal.aborted && sequence === compileSequence && get().projectId === state.projectId;
        set({
          buildStatus: "queued",
          activeCompileJobId: null,
          buildMessage: null,
          diagnostics: [],
          buildLog: "",
          activeBottomTab: "log",
          bottomPanelOpen: true,
        });
        try {
          const res = await fetch("/api/compile", {
            signal: controller.signal,
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(request),
          });
          if (!isCurrent()) return;
          if (!res.ok) {
            let message = `Compile queue failed: ${res.status}`;
            try {
              const error = await res.json() as { error?: string };
              message = error.error ?? message;
            } catch { /* Keep HTTP error when response is not JSON. */ }
            throw new Error(message);
          }
          const { jobId } = (await res.json()) as { jobId: string };
          if (!isCurrent()) return;
          set({ buildStatus: "running", activeCompileJobId: jobId, buildMessage: `Job ${jobId}` });
          const result = await pollCompileJob(jobId, controller.signal);
          if (!isCurrent()) return;
          const ok = result.phase === "ready" && Boolean(result.pdfBase64);
          const texFiles = Object.entries(state.filesByPath).filter(([path]) => path.endsWith(".tex"));
          const bibFiles = Object.entries(state.filesByPath).filter(([path]) => path.endsWith(".bib"));
          const citationDiagnostics: Diagnostic[] = [];
          if (bibFiles.length > 0) {
            const allCited = new Set<string>();
            for (const [, texContent] of texFiles) {
              for (const key of BibliographyService.extractCitations(texContent)) allCited.add(key);
            }
            const allDefined = new Set<string>();
            for (const [, bibContent] of bibFiles) {
              for (const entry of BibliographyService.parse(bibContent)) allDefined.add(entry.id);
            }
            for (const [texPath, texContent] of texFiles) {
              for (const key of BibliographyService.extractCitations(texContent)) {
                if (!allDefined.has(key)) {
                  citationDiagnostics.push({
                    severity: "warning",
                    message: `Citation key "${key}" is referenced but missing in bibliography`,
                    file: texPath,
                  });
                }
              }
            }
            for (const [bibPath, bibContent] of bibFiles) {
              const unused = [...new Set(BibliographyService.parse(bibContent).map((entry) => entry.id))].filter((id) => !allCited.has(id));
              for (const key of unused.slice(0, 20)) {
                citationDiagnostics.push({
                  severity: "info",
                  message: `Bibliography entry "${key}" appears unused`,
                  file: bibPath,
                });
              }
            }
          }
          const mergedDiagnostics = [...(result.diagnostics ?? []), ...citationDiagnostics];
          set({
            buildStatus: ok ? "ready" : "failed",
            buildMessage: result.errorMessage ?? (ok ? "Compiled successfully" : "Compilation failed"),
            buildLog: result.log ?? "",
            diagnostics: mergedDiagnostics,
            diagnosticRevision: state.documentRevision,
            ...(ok && result.pdfBase64 ? {
              pdfDataUrl: `data:application/pdf;base64,${result.pdfBase64}`,
              pdfSourceRevision: state.documentRevision,
              pdfMainFile: mainFile,
              pdfPage: 1,
              // Per-run SyncTeX provenance follows the PDF: captured at
              // request time, preserved through failed rebuilds.
              ...(result.synctex ? {
                synctexMapping: result.synctex,
                synctexRevision: state.documentRevision,
                synctexMainFile: mainFile,
              } : {}),
            } : {}),
            activeBottomTab: mergedDiagnostics.length > 0 ? "problems" : "log",
          });
          try {
            const record = await createBuildRecord(request, result, state.documentRevision, startedAt);
            if (isCurrent()) set({ lastBuildRecord: record, buildHistoryError: null });
            await buildRecordRepository.save(record);
          } catch (historyError) {
            if (isCurrent()) set({ buildHistoryError: historyError instanceof Error ? historyError.message : "Build history could not be saved." });
          }
        } catch (error: unknown) {
          if (!isCurrent()) return;
          set({
            buildStatus: "failed",
            buildMessage: error instanceof Error ? error.message : String(error),
            buildLog: error instanceof Error ? error.message : String(error),
          });
        } finally {
          if (sequence === compileSequence) { activeCompile = null; set({ activeCompileJobId: null }); }
        }
      },
      openFile: (id) => {
        const content = get().filesByPath[id] ?? "";
        set((s) => ({
          openFiles: s.openFiles.includes(id) ? s.openFiles : [...s.openFiles, id],
          activeFileId: id,
          activeSelection:null,
          nextSelection:null,
          outline: OutlineService.parse(content),
          focusedLine: null,
          stats: calculateStats(content),
        }));
      },
      closeFile: (id) => set((s) => {
        const next = s.openFiles.filter(f => f !== id);
        const nextActive = s.activeFileId === id ? (next[next.length - 1] || null) : s.activeFileId;
        return {
          openFiles: next,
          activeFileId: nextActive,
          activeSelection:null,
          nextSelection:null,
          outline: OutlineService.parse(nextActive ? s.filesByPath[nextActive] ?? "" : ""),
        };
      }),
      closeActiveEditorTab: () => {
        const id = get().activeFileId;
        if (id) get().closeFile(id);
      },
    }),
    {
      name: "alove-workbench-v3",
      storage: createJSONStorage(() => preferenceStorage),
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        bottomPanelOpen: state.bottomPanelOpen,
        activeRail: state.activeRail,
        activeBottomTab: state.activeBottomTab,
        projectTitle: state.projectTitle,
        pdfZoom: state.pdfZoom,
      }),
    }
  )
);

// Serialize writes per path. Acknowledgements only clean the content that was saved.
// chainPending never blocks a retry behind a rejected op and never leaves an
// unhandled rejected child: the runner executes on either settlement, and the
// cleanup observes both outcomes.
function chainPending(map: Map<string, Promise<void>>, key: string, run: () => Promise<void>): Promise<void> {
  const previous = map.get(key) ?? Promise.resolve();
  const pending = previous.then(run, run);
  map.set(key, pending);
  const cleanup = () => { if (map.get(key) === pending) map.delete(key); };
  pending.then(cleanup, cleanup);
  return pending;
}
function opKey(projectId: string | null, path: string): string {
  return `${projectId ?? "local"}:${path}`;
}
function renameOpKey(projectId: string | null, oldPath: string, newPath: string): string {
  return `${projectId ?? "local"}:${oldPath}→${newPath}`;
}
function isOpInFlight(map: Map<string, Promise<void>>, projectId: string | null, path: string): boolean {
  return map.has(opKey(projectId, path));
}
function isRenameInFlight(projectId: string | null, path: string): boolean {
  const prefix = `${projectId ?? "local"}:`;
  for (const key of pendingCloudRenames.keys()) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    const arrow = rest.indexOf("→");
    if (arrow < 0) continue;
    if (rest.slice(0, arrow) === path || rest.slice(arrow + 1) === path) return true;
  }
  return false;
}
function hasPending(map: Map<string, Promise<void>>, projectId: string | null): boolean {
  const prefix = `${projectId ?? "local"}:`;
  for (const key of map.keys()) if (key.startsWith(prefix)) return true;
  return false;
}
// A local deletion invalidates all queued/acknowledged work for that file instance,
// including creates whose version is still zero.
const fileGenerations = new Map<string, number>();
const pendingFileSaves = new Map<string, Promise<void>>();
const pendingCloudDeletes = new Map<string, Promise<void>>();
const pendingCloudRenames = new Map<string, Promise<void>>();
function saveFileToPersistence(path: string, initialVersion?: number): Promise<void> {
  const state = useWorkbenchStore.getState();
  const content = state.filesByPath[path];
  const projectId = state.projectId;
  const save = state.persistence.save;
  const generation = fileGenerations.get(path) ?? 0;
  if (!save || content === undefined) {
    useWorkbenchStore.setState({ saveStatus: "error", saveMessage: "Saving is unavailable. Export your source to keep a copy." });
    return Promise.resolve();
  }
  return chainPending(pendingFileSaves, opKey(projectId, path), async () => {
    if (useWorkbenchStore.getState().projectId !== projectId || useWorkbenchStore.getState().persistence.save !== save || (fileGenerations.get(path) ?? 0) !== generation) return;
    useWorkbenchStore.setState({ saveStatus: "saving", saveMessage: null });
    try {
      const latest = useWorkbenchStore.getState();
      const expected = initialVersion ?? latest.versionsByPath[path];
      // Creates (expectedVersion 0) carry no token; existing writes must
      // carry the row `_id` so a recreated row conflicts even on version match.
      const expectedIncarnation = expected === 0 ? undefined : latest.incarnationsByPath[path];
      const result = await save(path, content, expected, expectedIncarnation);
      const current = useWorkbenchStore.getState();
      if (current.projectId !== projectId || current.persistence.save !== save) return;
      if (!Object.hasOwn(current.filesByPath, path)) {
        if (current.saveStatus === "saving") useWorkbenchStore.setState({ saveStatus: "unsaved" });
        return;
      }
      if ((fileGenerations.get(path) ?? 0) !== generation) {
        // Stale-generation ack: the path was deleted and recreated locally
        // after this save started. The ack belongs to the dead generation,
        // so never adopt its version/token or clear the new generation's
        // dirty flag; the recreate's own create-ack reconciles it.
        useWorkbenchStore.setState({
          dirtyByPath: { ...current.dirtyByPath, [path]: true },
          saveStatus: "unsaved",
          saveMessage: null,
        });
        return;
      }
      if (result?.conflict) {
        const message = (result as { recreated?: boolean; deleted?: boolean }).recreated
          ? "This file was deleted and recreated on the server. Your edits were kept; export them before reloading."
          : (result as { deleted?: boolean }).deleted
            ? "This file was deleted on the server. Your edits were kept; export them before reloading."
            : "The server has a newer version. Your edits are still here; export them before reloading.";
        useWorkbenchStore.setState({ saveStatus: "conflict", saveMessage: message });
        return;
      }
      const unchanged = current.filesByPath[path] === content;
      const dirtyByPath = { ...current.dirtyByPath, [path]: !unchanged };
      const incarnation = (result as { incarnation?: string } | void)?.incarnation;
      useWorkbenchStore.setState({
        dirtyByPath,
        versionsByPath: result?.version != null ? { ...current.versionsByPath, [path]: Math.max(current.versionsByPath[path] ?? 0, result.version) } : current.versionsByPath,
        incarnationsByPath: incarnation !== undefined ? { ...current.incarnationsByPath, [path]: incarnation } : current.incarnationsByPath,
        saveStatus: Object.values(dirtyByPath).some(Boolean) ? "unsaved" : "saved",
      });
    } catch (error) {
      if (useWorkbenchStore.getState().projectId === projectId) {
        useWorkbenchStore.setState({ saveStatus: "error", saveMessage: error instanceof Error ? error.message : "Save failed. Your edits are still here." });
      }
    }
  });
}

function validMainFile(filesByPath: Record<string, string>, candidate: string | null): string | null {
  if (candidate && candidate.endsWith(".tex") && Object.hasOwn(filesByPath, candidate)) return candidate;
  if (Object.hasOwn(filesByPath, "main.tex")) return "main.tex";
  return Object.keys(filesByPath).find((p) => p.endsWith(".tex")) ?? null;
}

function restoreDeletedDraft(snapshot: { content: string; version: number; incarnation?: string; dirty: boolean; openFiles: string[]; activeFileId: string | null; mainFile: string | null }, path: string) {
  const current = useWorkbenchStore.getState();
  if (Object.hasOwn(current.filesByPath, path)) return;
  const filesByPath = { ...current.filesByPath, [path]: snapshot.content };
  useWorkbenchStore.setState({
    filesByPath,
    versionsByPath: { ...current.versionsByPath, [path]: snapshot.version },
    incarnationsByPath: snapshot.incarnation !== undefined ? { ...current.incarnationsByPath, [path]: snapshot.incarnation } : current.incarnationsByPath,
    dirtyByPath: { ...current.dirtyByPath, [path]: true },
    projectTree: projectTreeFromFiles(filesByPath),
    mainFile: validMainFile(filesByPath, snapshot.mainFile ?? current.mainFile),
    openFiles: current.openFiles.includes(path) ? current.openFiles : [...current.openFiles, path],
    activeFileId: current.activeFileId ?? path,
    saveStatus: "error",
  });
}

type RenameSnapshot = { destinationGeneration: number; oldPath: string; trimmed: string; content: string; version: number; incarnation?: string; dirty: boolean; openFiles: string[]; activeFileId: string | null; mainFile: string | null };

function rollbackRenameToOldPath(snapshot: RenameSnapshot, status: "conflict" | "error", message: string) {
  const now = useWorkbenchStore.getState();
  const oldExists = Object.hasOwn(now.filesByPath, snapshot.oldPath);
  const movedExists = Object.hasOwn(now.filesByPath, snapshot.trimmed);
  if ((fileGenerations.get(snapshot.trimmed) ?? 0) !== snapshot.destinationGeneration) {
    // The destination was deleted, moved again, or independently recreated.
    // Retain that work and recover the original draft without removing it.
    if (!oldExists) restoreDeletedDraft(snapshot, snapshot.oldPath);
    useWorkbenchStore.setState({ saveStatus: status, saveMessage: message });
    return;
  }
  if (oldExists && movedExists) {
    // Destination recreated independently while the rename was in flight:
    // keep both drafts and report truthfully instead of deleting either.
    useWorkbenchStore.setState({ saveStatus: status, saveMessage: message });
    return;
  }
  if (oldExists && !movedExists) {
    useWorkbenchStore.setState({ saveStatus: status, saveMessage: message });
    return;
  }
  // Preserve the latest moved content (typing may have landed at the new
  // path while the rename was in flight) instead of the rename-time snapshot.
  const latestContent = movedExists ? (now.filesByPath[snapshot.trimmed] ?? snapshot.content) : snapshot.content;
  const { [snapshot.trimmed]: _moved, ...filesRest } = now.filesByPath;
  const { [snapshot.trimmed]: _v, ...verRest } = now.versionsByPath;
  const { [snapshot.trimmed]: _i, ...incRest } = now.incarnationsByPath;
  const { [snapshot.trimmed]: _d, ...dirtyRest } = now.dirtyByPath;
  void _moved; void _v; void _i; void _d;
  const filesByPath = movedExists || !oldExists ? { ...filesRest, [snapshot.oldPath]: latestContent } : { ...now.filesByPath };
  useWorkbenchStore.setState({
    filesByPath,
    versionsByPath: { ...verRest, [snapshot.oldPath]: snapshot.version },
    incarnationsByPath: snapshot.incarnation !== undefined ? { ...incRest, [snapshot.oldPath]: snapshot.incarnation } : incRest,
    dirtyByPath: { ...dirtyRest, [snapshot.oldPath]: true },
    projectTree: projectTreeFromFiles(filesByPath),
    mainFile: validMainFile(filesByPath, snapshot.mainFile ?? now.mainFile),
    openFiles: now.openFiles.map((p) => (p === snapshot.trimmed ? snapshot.oldPath : p)),
    activeFileId: now.activeFileId === snapshot.trimmed ? snapshot.oldPath : now.activeFileId,
    saveStatus: status,
    saveMessage: message,
  });
}

function deleteFileFromPersistence(path: string, snapshot: { content: string; version: number; incarnation?: string; dirty: boolean; openFiles: string[]; activeFileId: string | null; mainFile: string | null; hadLocal?: boolean }): Promise<void> {
  const state = useWorkbenchStore.getState();
  const projectId = state.projectId;
  const remove = state.persistence.delete;
  const hadLocal = snapshot.hadLocal ?? true;
  if (!remove) {
    // No cloud adapter (local standalone uses saveWorkspace instead): the
    // optimistic delete above already applied, keep it and report saved.
    return Promise.resolve();
  }
  return chainPending(pendingCloudDeletes, opKey(projectId, path), async () => {
    if (useWorkbenchStore.getState().projectId !== projectId) return;
    try {
      useWorkbenchStore.setState({ saveStatus: "saving", saveMessage: null });
      const result = await remove(path, snapshot.version, snapshot.incarnation);
      const current = useWorkbenchStore.getState();
      if (current.projectId !== projectId) return;
      if (result?.conflict) {
        // Stale delete refused: the server holds a newer or recreated row.
        // Restore the optimistic deletion target when it is still missing so
        // no draft is lost, then report truthfully for retry.
        if (!Object.hasOwn(current.filesByPath, path) && hadLocal) restoreDeletedDraft(snapshot, path);
        useWorkbenchStore.setState({
          saveStatus: "conflict",
          saveMessage: (result as { recreated?: boolean }).recreated
            ? `Delete refused: "${path}" was recreated on the server. Your draft was restored; export it before retrying.`
            : `Delete refused: "${path}" changed on the server. Your draft was restored; export it before retrying.`,
        });
        return;
      }
      // Success (or idempotent already-missing): keep the optimistic delete.
      if (current.saveStatus === "saving") {
        const stillDirty = Object.values(current.dirtyByPath).some(Boolean);
        useWorkbenchStore.setState({ saveStatus: stillDirty ? "unsaved" : "saved", saveMessage: null });
      }
    } catch (error) {
      if (useWorkbenchStore.getState().projectId !== projectId) return;
      const current = useWorkbenchStore.getState();
      if (!Object.hasOwn(current.filesByPath, path) && hadLocal) restoreDeletedDraft(snapshot, path);
      useWorkbenchStore.setState({
        saveStatus: "error",
        saveMessage: error instanceof Error ? `Delete failed: ${error.message} Your draft was restored; retry the delete.` : `Delete failed for "${path}". Your draft was restored; retry the delete.`,
      });
      throw error;
    }
  });
}

function renameFileViaPersistence(snapshot: RenameSnapshot): Promise<void> {
  const state = useWorkbenchStore.getState();
  const projectId = state.projectId;
  const rename = state.persistence.rename;
  if (!rename) return Promise.resolve();
  const key = renameOpKey(projectId, snapshot.oldPath, snapshot.trimmed);
  return chainPending(pendingCloudRenames, key, async () => {
    if (useWorkbenchStore.getState().projectId !== projectId) return;
    try {
      useWorkbenchStore.setState({ saveStatus: "saving", saveMessage: null });
      const result = await rename(snapshot.oldPath, snapshot.trimmed, snapshot.version, snapshot.incarnation);
      const current = useWorkbenchStore.getState();
      if (current.projectId !== projectId) return;
      if ((result as { conflict?: boolean } | void)?.conflict) {
        rollbackRenameToOldPath(snapshot, "conflict", (result as { recreated?: boolean }).recreated
          ? `Rename refused: "${snapshot.oldPath}" was recreated on the server. Your draft was restored; export it before retrying.`
          : `Rename refused: "${snapshot.oldPath}" changed on the server. Your draft was restored; export it before retrying.`);
        return;
      }
      const after = useWorkbenchStore.getState();
      if (after.projectId === projectId && (result as { incarnation?: string } | void)?.incarnation !== undefined) {
        const token = (result as { incarnation?: string }).incarnation!;
        if (Object.hasOwn(after.filesByPath, snapshot.trimmed) && (fileGenerations.get(snapshot.trimmed) ?? 0) === snapshot.destinationGeneration) {
          useWorkbenchStore.setState({ incarnationsByPath: { ...after.incarnationsByPath, [snapshot.trimmed]: token } });
        }
      }
      const latest = useWorkbenchStore.getState();
      useWorkbenchStore.setState({ saveStatus: Object.values(latest.dirtyByPath).some(Boolean) ? "unsaved" : "saved", saveMessage: null });
    } catch (error) {
      if (useWorkbenchStore.getState().projectId !== projectId) return;
      rollbackRenameToOldPath(snapshot, "error", error instanceof Error ? `Rename failed: ${error.message} Your draft was restored; retry the rename.` : `Rename failed for "${snapshot.oldPath}". Your draft was restored; retry the rename.`);
      throw error;
    }
  });
}

// Build provenance follows source, not tab/layout changes or save acknowledgements.
useWorkbenchStore.subscribe((state, previous) => {
  const projectChanged = state.projectId !== previous.projectId;
  const filesChanged = state.filesByPath !== previous.filesByPath && (
    Object.keys(state.filesByPath).length !== Object.keys(previous.filesByPath).length ||
    Object.entries(state.filesByPath).some(([path, content]) => previous.filesByPath[path] !== content)
  );
  if (projectChanged) fileGenerations.clear();
  else for (const path of Object.keys(previous.filesByPath)) {
    if (!Object.hasOwn(state.filesByPath, path)) fileGenerations.set(path, (fileGenerations.get(path) ?? 0) + 1);
  }
  if (projectChanged) {
    compileSequence += 1;
    activeCompile?.abort();
    activeCompile = null;
    useWorkbenchStore.setState({
      documentRevision: previous.documentRevision + 1,
      lastBuildRecord: null, buildHistoryError: null, buildRecoveryOpen: false,
      pdfDataUrl: null, pdfSourceRevision: null, pdfMainFile: null,
      synctexMapping: null, synctexRevision: null, synctexMainFile: null,
      pdfHighlight: null,
      activeCompileJobId: null, buildStatus: "idle", buildMessage: null, buildLog: "", diagnostics: [], diagnosticRevision: null,
    });
  } else if (filesChanged || state.mainFile !== previous.mainFile) {
    useWorkbenchStore.setState({ documentRevision: previous.documentRevision + 1 });
  }
});
