import type { Diagnostic } from "@alove/protocol";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { preferenceStorage } from "@/lib/preferenceStorage";
import { useIdeSettingsStore } from "@/stores/ideSettingsStore";
import { pollCompileJob } from "@/lib/compilePoll";
import { normalizeDiagnosticFile } from "@/lib/editorDiagnostics";
import { BibliographyService } from "@/services/BibliographyService";
import { ProjectService } from "@/services/ProjectService";
import { OutlineService, type OutlineNode } from "@/services/OutlineService";

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
  preview: string;
};

export type RemoteProjectFile = { path: string; content: string; version: number };

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

  projectId: string | null;
  projectTitle: string;
  mainFile: string | null;
  documentRevision: number;
  pdfSourceRevision: number | null;
  pdfMainFile: string | null;
  saveStatus: "loading" | "unsaved" | "saving" | "saved" | "error" | "conflict";
  saveMessage: string | null;
  projectTree: ProjectFile[];
  filesByPath: Record<string, string>;
  versionsByPath: Record<string, number>;
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
    save?: (path: string, content: string, expectedVersion?: number) => Promise<{ version: number; conflict?: boolean } | void>;
    delete?: (path: string) => Promise<void>;
    rename?: (oldPath: string, newPath: string) => Promise<void>;
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
  setProjectTitle: (title: string) => void;
  setMainFile: (path: string) => void;
  stopCompilePolling: () => void;
  mergeRemoteProject: (args: { projectId: string; title?: string; files: RemoteProjectFile[] }) => void;
  initializeProject: (args: {
    projectId: string | null;
    title?: string;
    mainFile?: string | null;
    activeFile?: string | null;
    openFiles?: string[];
    files: { path: string; content: string; version?: number }[];
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
  replaceAcrossFiles: (findText: string, replaceText: string, options?: { texOnly?: boolean }) => number;
  setActiveSelection: (selection: { start: number; end: number } | null) => void;
  wrapSelectionOrInsert: (before: string, after?: string, fallback?: string) => void;
  requestEditorCommand: (kind: EditorCommandKind) => void;
  requestEditorFindBar: () => void;
  toggleEditorWordWrap: () => void;
  runProjectSearch: (query: string, options?: { caseSensitive?: boolean; texOnly?: boolean; regex?: boolean }) => number;
  clearProjectSearch: () => void;
  updateOutlineForActiveFile: () => void;
  setFocusedLine: (line: number | null) => void;
  jumpToDiagnostic: (diagnostic: Diagnostic) => void;
  setPdfZoom: (zoom: number) => void;
  setPdfPage: (page: number) => void;
  setPdfPageCount: (count: number) => void;
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
      projectId: null,
      projectTitle: "Deep Learning Survey",
      mainFile: null,
      documentRevision: 0,
      pdfSourceRevision: null,
      pdfMainFile: null,
      saveStatus: "unsaved",
      saveMessage: null,
      projectTree: [],
      filesByPath: {},
      versionsByPath: {},
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
      setProjectTitle: (title) => set({ projectTitle: title }),
      setMainFile: (path) => {
        if (path.endsWith(".tex") && Object.hasOwn(get().filesByPath, path)) set({ mainFile: path });
      },
      stopCompilePolling: () => {
        compileSequence += 1;
        activeCompile?.abort();
        activeCompile = null;
        if (get().buildStatus === "queued" || get().buildStatus === "running") set({ buildStatus: "idle", buildMessage: null });
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
        const nextDirty = new Map(Object.entries(state.dirtyByPath));
        const conflicts: string[] = [];
        let changed = false;
        for (const path of new Set([...previous.keys(), ...incoming.keys()])) {
          const before = previous.get(path);
          const remote = incoming.get(path);
          if (before?.content === remote?.content && before?.version === remote?.version) continue;
          const local = nextFiles.get(path);
          const localVersion = nextVersions.get(path) ?? 0;
          // A mutation acknowledgement may arrive before its query echo.
          if (remote && remote.version < localVersion && remote.version > (before?.version ?? 0)) continue;
          if (remote && nextFiles.has(path) && local === remote.content) {
            nextVersions.set(path, remote.version);
            if (!pendingFileSaves.has(path)) nextDirty.set(path, false);
            changed = true;
          } else if ((!nextFiles.has(path) && !before) ||
            (!before && !nextDirty.get(path) && remote && remote.version >= localVersion) ||
            (before && local === before.content && !nextDirty.get(path))) {
            if (remote) {
              nextFiles.set(path, remote.content);
              nextVersions.set(path, remote.version);
              nextDirty.set(path, false);
            } else {
              nextFiles.delete(path);
              nextVersions.delete(path);
              nextDirty.delete(path);
            }
            changed = true;
          } else if (nextFiles.has(path) || remote) {
            // Preserve local changes and their expected version for the save CAS.
            // Own in-flight save echoes are reconciled by the save acknowledgement.
            if (!pendingFileSaves.has(path)) conflicts.push(path);
          }
        }
        const fullySynced = pendingFileSaves.size === 0 && nextFiles.size === incoming.size &&
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
          filesByPath, versionsByPath: Object.fromEntries(nextVersions), dirtyByPath: Object.fromEntries(nextDirty),
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
        const dirtyByPath: Record<string, boolean> = {};
        for (const file of files) {
          filesByPath[file.path] = file.content;
          versionsByPath[file.path] = file.version ?? 1;
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
          remoteFiles: null,
          dirtyByPath,
          activeFileId: nextActive,
          openFiles: nextOpen,
          outline: OutlineService.parse(activeContent),
          stats: calculateStats(activeContent),
        });
      },
      updateActiveFileContent: (content) => {
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
        if (!path.trim()) return;
        const shouldOpen = options?.open !== false;
        set((s) => {
          if (path in s.filesByPath) return {};
          const nextFiles = { ...s.filesByPath, [path]: content };
          const base = {
            filesByPath: nextFiles,
            mainFile: s.mainFile ?? (path.endsWith(".tex") ? path : null),
            projectTree: projectTreeFromFiles(nextFiles),
            versionsByPath: { ...s.versionsByPath, [path]: 1 },
            dirtyByPath: { ...s.dirtyByPath, [path]: true },
          };
          if (!shouldOpen) return base;
          return {
            ...base,
            openFiles: s.openFiles.includes(path) ? s.openFiles : [...s.openFiles, path],
            activeFileId: path,
            outline: OutlineService.parse(content),
          };
        });
        if (get().persistence.save) void saveFileToPersistence(path, 0);
      },
      deleteFile: (path) => {
        set((s) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [path]: _, ...filesByPath } = s.filesByPath;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [path]: __, ...versionsByPath } = s.versionsByPath;
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
            dirtyByPath,
            openFiles,
            activeFileId,
            outline: OutlineService.parse(activeFileId ? filesByPath[activeFileId] ?? "" : ""),
          };
        });
        const { persistence } = get();
        if (persistence.delete) {
          void persistence.delete(path);
        }
      },
      renameFile: (oldPath, newPath) => {
        const trimmed = newPath.trim().replace(/\\/g, "/");
        if (!trimmed || trimmed === oldPath) return;
        const state = get();
        if (!(oldPath in state.filesByPath)) return;
        if (trimmed in state.filesByPath) return;
        const content = state.filesByPath[oldPath] ?? "";
        const version = state.versionsByPath[oldPath] ?? 1;
        const dirty = state.dirtyByPath[oldPath] ?? false;
        set((s) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [oldPath]: _c, ...filesRest } = s.filesByPath;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { [oldPath]: _v, ...verRest } = s.versionsByPath;
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
            dirtyByPath: { ...dirtyRest, [trimmed]: dirty },
            projectTree: projectTreeFromFiles(nextFiles),
            openFiles,
            activeFileId,
            outline: OutlineService.parse(activeFileId ? nextFiles[activeFileId] ?? "" : ""),
          };
        });
        const { persistence } = get();
        if (persistence.rename) {
          void persistence.rename(oldPath, trimmed);
        }
      },
      appendToActiveFile: (text) => {
        const { activeFileId, filesByPath, dirtyByPath } = get();
        if (!activeFileId) return;
        const current = filesByPath[activeFileId] ?? "";
        const next = `${current}${current.endsWith("\n") || current.length === 0 ? "" : "\n"}${text}`;
        set({
          filesByPath: { ...filesByPath, [activeFileId]: next },
          dirtyByPath: { ...dirtyByPath, [activeFileId]: true },
          outline: OutlineService.parse(next),
        });
      },
      transformActiveFile: (transformer) => {
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
        if (!findText) return 0;
        const { filesByPath, dirtyByPath, activeFileId } = get();
        const nextFiles = { ...filesByPath };
        const nextDirty = { ...dirtyByPath };
        let changed = 0;
        for (const [path, content] of Object.entries(filesByPath)) {
          if (options?.texOnly && !path.endsWith(".tex")) continue;
          if (!content.includes(findText)) continue;
          const next = content.split(findText).join(replaceText);
          if (next !== content) {
            nextFiles[path] = next;
            nextDirty[path] = true;
            changed += 1;
          }
        }
        set({
          filesByPath: nextFiles,
          projectTree: projectTreeFromFiles(nextFiles),
          dirtyByPath: nextDirty,
          outline: OutlineService.parse(activeFileId ? nextFiles[activeFileId] ?? "" : ""),
        });
        return changed;
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
        const { activeFileId, filesByPath, dirtyByPath, activeSelection } = get();
        if (!activeFileId) return;
        const current = filesByPath[activeFileId] ?? "";
        const start = activeSelection?.start ?? 0;
        const end = activeSelection?.end ?? 0;
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
        const results: ProjectSearchResult[] = [];
        const needle = options?.caseSensitive ? q : q.toLowerCase();
        const regex = options?.regex
          ? new RegExp(q, options?.caseSensitive ? "g" : "gi")
          : null;
        for (const [path, content] of Object.entries(filesByPath)) {
          if (options?.texOnly && !path.endsWith(".tex")) continue;
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i += 1) {
            if (regex) {
              regex.lastIndex = 0;
              for (const m of lines[i].matchAll(regex)) {
                results.push({
                  path,
                  line: i + 1,
                  column: (m.index ?? 0) + 1,
                  preview: lines[i].trim(),
                });
              }
            } else {
              const haystack = options?.caseSensitive ? lines[i] : lines[i].toLowerCase();
              let from = 0;
              while (from < haystack.length) {
                const idx = haystack.indexOf(needle, from);
                if (idx === -1) break;
                results.push({
                  path,
                  line: i + 1,
                  column: idx + 1,
                  preview: lines[i].trim(),
                });
                from = idx + Math.max(needle.length, 1);
              }
            }
          }
        }
        set({ projectSearchQuery: q, projectSearchResults: results, activeRail: "search", sidebarOpen: true });
        return results.length;
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
      runCompile: async (engineArg) => {
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
        const controller = new AbortController();
        activeCompile = controller;
        const isCurrent = () => !controller.signal.aborted && sequence === compileSequence && get().projectId === state.projectId;
        set({
          buildStatus: "queued",
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
            body: JSON.stringify({
              projectId: state.projectId ?? "local",
              mainFile,
              files: state.filesByPath,
              engine,
              cleanAux,
              timeoutMs: 120_000,
            }),
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
          set({ buildStatus: "running", buildMessage: `Job ${jobId}` });
          const result = await pollCompileJob(jobId, controller.signal);
          if (!isCurrent()) return;
          const ok = result.phase === "ready" && Boolean(result.pdfBase64);
          const texFiles = Object.entries(state.filesByPath).filter(([path]) => path.endsWith(".tex"));
          const bibFiles = Object.entries(state.filesByPath).filter(([path]) => path.endsWith(".bib"));
          const citationDiagnostics: Diagnostic[] = [];
          for (const [texPath, texContent] of texFiles) {
            for (const [bibPath, bibContent] of bibFiles) {
              const missing = BibliographyService.findUndefinedCitations(texContent, bibContent);
              const unused = BibliographyService.findUnusedCitations(texContent, bibContent);
              for (const key of missing) {
                citationDiagnostics.push({
                  severity: "warning",
                  message: `Citation key "${key}" is referenced but missing in bibliography`,
                  file: texPath,
                });
              }
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
            } : {}),
            activeBottomTab: mergedDiagnostics.length > 0 ? "problems" : "log",
          });
        } catch (error: unknown) {
          if (!isCurrent()) return;
          set({
            buildStatus: "failed",
            buildMessage: error instanceof Error ? error.message : String(error),
            buildLog: error instanceof Error ? error.message : String(error),
          });
        } finally {
          if (sequence === compileSequence) activeCompile = null;
        }
      },
      openFile: (id) => {
        const content = get().filesByPath[id] ?? "";
        set((s) => ({
          openFiles: s.openFiles.includes(id) ? s.openFiles : [...s.openFiles, id],
          activeFileId: id,
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
const pendingFileSaves = new Map<string, Promise<void>>();
function saveFileToPersistence(path: string, initialVersion?: number): Promise<void> {
  const state = useWorkbenchStore.getState();
  const content = state.filesByPath[path];
  const projectId = state.projectId;
  const save = state.persistence.save;
  if (!save || content === undefined) {
    useWorkbenchStore.setState({ saveStatus: "error", saveMessage: "Saving is unavailable. Export your source to keep a copy." });
    return Promise.resolve();
  }
  const previous = pendingFileSaves.get(path) ?? Promise.resolve();
  const pending = previous.then(async () => {
    if (useWorkbenchStore.getState().projectId !== projectId) return;
    useWorkbenchStore.setState({ saveStatus: "saving", saveMessage: null });
    try {
      const expected = initialVersion ?? useWorkbenchStore.getState().versionsByPath[path];
      const result = await save(path, content, expected);
      const current = useWorkbenchStore.getState();
      if (current.projectId !== projectId || current.persistence.save !== save) return;
      if (!Object.hasOwn(current.filesByPath, path)) {
        if (current.saveStatus === "saving") useWorkbenchStore.setState({ saveStatus: "unsaved" });
        return;
      }
      if (result?.conflict) {
        useWorkbenchStore.setState({ saveStatus: "conflict", saveMessage: "The server has a newer version. Your edits are still here; export them before reloading." });
        return;
      }
      const unchanged = current.filesByPath[path] === content;
      const dirtyByPath = { ...current.dirtyByPath, [path]: !unchanged };
      useWorkbenchStore.setState({
        dirtyByPath,
        versionsByPath: result?.version != null ? { ...current.versionsByPath, [path]: Math.max(current.versionsByPath[path] ?? 0, result.version) } : current.versionsByPath,
        saveStatus: Object.values(dirtyByPath).some(Boolean) ? "unsaved" : "saved",
      });
    } catch (error) {
      if (useWorkbenchStore.getState().projectId === projectId) {
        useWorkbenchStore.setState({ saveStatus: "error", saveMessage: error instanceof Error ? error.message : "Save failed. Your edits are still here." });
      }
    }
  });
  pendingFileSaves.set(path, pending);
  void pending.then(() => { if (pendingFileSaves.get(path) === pending) pendingFileSaves.delete(path); });
  return pending;
}

// Build provenance follows source, not tab/layout changes or save acknowledgements.
useWorkbenchStore.subscribe((state, previous) => {
  const projectChanged = state.projectId !== previous.projectId;
  const filesChanged = state.filesByPath !== previous.filesByPath && (
    Object.keys(state.filesByPath).length !== Object.keys(previous.filesByPath).length ||
    Object.entries(state.filesByPath).some(([path, content]) => previous.filesByPath[path] !== content)
  );
  if (projectChanged) {
    compileSequence += 1;
    activeCompile?.abort();
    activeCompile = null;
    useWorkbenchStore.setState({
      documentRevision: previous.documentRevision + 1,
      pdfDataUrl: null, pdfSourceRevision: null, pdfMainFile: null,
      buildStatus: "idle", buildMessage: null, buildLog: "", diagnostics: [], diagnosticRevision: null,
    });
  } else if (filesChanged || state.mainFile !== previous.mainFile) {
    useWorkbenchStore.setState({ documentRevision: previous.documentRevision + 1 });
  }
});
