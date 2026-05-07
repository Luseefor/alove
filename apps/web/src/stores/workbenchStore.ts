import type { Diagnostic } from "@alove/protocol";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useIdeSettingsStore } from "@/stores/ideSettingsStore";
import { pollCompileJob } from "@/lib/compilePoll";
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

export type EditorCommandKind =
  | "undo"
  | "redo"
  | "selectAll"
  | "cut"
  | "copy"
  | "paste";

interface WorkbenchState {
  sidebarOpen: boolean;
  bottomPanelOpen: boolean;
  activeRail: "explorer" | "search" | "source-control" | "ai";
  activeBottomTab: "problems" | "log" | "terminal" | "output" | "ai";
  activeFileId: string | null;
  openFiles: string[];

  projectId: string | null;
  projectTitle: string;
  projectTree: ProjectFile[];
  filesByPath: Record<string, string>;
  versionsByPath: Record<string, number>;
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
  buildLog: string;
  buildStatus: "idle" | "queued" | "running" | "ready" | "failed";
  buildMessage: string | null;
  pdfDataUrl: string | null;
  pdfZoom: number;
  pdfPage: number;
  pdfPageCount: number;
  persistence: {
    save?: (path: string, content: string, expectedVersion?: number) => Promise<{ version: number } | void>;
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
  initializeProject: (args: {
    projectId: string | null;
    title?: string;
    files: { path: string; content: string; version?: number }[];
  }) => void;
  updateActiveFileContent: (content: string) => void;
  saveActiveFile: () => void;
  saveAllDirtyFiles: () => void;
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
      projectTree: [],
      filesByPath: {},
      versionsByPath: {},
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
      buildLog: "",
      buildStatus: "idle",
      buildMessage: null,
      pdfDataUrl: null,
      pdfZoom: 100,
      pdfPage: 1,
      pdfPageCount: 1,
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
        set({ outline: OutlineService.parse(content), focusedLine: null });
      },
      setProjectTree: (tree) => set({ projectTree: tree }),
      setProjectTitle: (title) => set({ projectTitle: title }),
      setPersistenceHandlers: (handlers) => set({ persistence: handlers }),
      initializeProject: ({ projectId, title, files }) => {
        const filesByPath: Record<string, string> = {};
        const versionsByPath: Record<string, number> = {};
        const dirtyByPath: Record<string, boolean> = {};
        for (const file of files) {
          filesByPath[file.path] = file.content;
          versionsByPath[file.path] = file.version ?? 1;
          dirtyByPath[file.path] = false;
        }
        const current = get();
        let nextActive = current.activeFileId;
        if (!nextActive || !(nextActive in filesByPath)) {
          nextActive = files.find((f) => f.path === "main.tex")?.path ?? files.find((f) => f.path.endsWith(".tex"))?.path ?? files[0]?.path ?? null;
        }
        const nextOpen = current.openFiles.filter((f) => f in filesByPath);
        if (nextActive && !nextOpen.includes(nextActive)) nextOpen.push(nextActive);
        set({
          projectId,
          projectTitle: title ?? current.projectTitle,
          filesByPath,
          projectTree: projectTreeFromFiles(filesByPath),
          versionsByPath,
          dirtyByPath,
          activeFileId: nextActive,
          openFiles: nextOpen,
          outline: OutlineService.parse(nextActive ? filesByPath[nextActive] ?? "" : ""),
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
        });
      },
      saveActiveFile: () => {
        const { activeFileId, persistence, filesByPath, versionsByPath } = get();
        if (!activeFileId) return;
        set((s) => ({
          dirtyByPath: { ...s.dirtyByPath, [activeFileId]: false },
        }));
        if (persistence.save) {
          void persistence
            .save(activeFileId, filesByPath[activeFileId] ?? "", versionsByPath[activeFileId])
            .then((result) => {
              if (result?.version != null) {
                set((s) => ({
                  versionsByPath: { ...s.versionsByPath, [activeFileId]: result.version },
                }));
              }
            });
        }
      },
      saveAllDirtyFiles: () => {
        const { dirtyByPath, filesByPath, versionsByPath, persistence } = get();
        const dirtyPaths = Object.keys(dirtyByPath).filter((p) => dirtyByPath[p]);
        if (dirtyPaths.length === 0) return;
        set((s) => {
          const nextDirty = { ...s.dirtyByPath };
          for (const p of dirtyPaths) nextDirty[p] = false;
          return { dirtyByPath: nextDirty };
        });
        if (!persistence.save) return;
        for (const path of dirtyPaths) {
          void persistence.save(path, filesByPath[path] ?? "", versionsByPath[path]).then((result) => {
            if (result?.version != null) {
              set((s) => ({ versionsByPath: { ...s.versionsByPath, [path]: result.version } }));
            }
          });
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
        const { persistence } = get();
        if (persistence.save) {
          void persistence.save(path, content, 0).then((result) => {
            if (result?.version != null) {
              set((s) => ({
                versionsByPath: { ...s.versionsByPath, [path]: result.version },
                dirtyByPath: { ...s.dirtyByPath, [path]: false },
              }));
            }
          });
        }
      },
      deleteFile: (path) => {
        set((s) => {
          const { [path]: _, ...filesByPath } = s.filesByPath;
          const { [path]: __, ...versionsByPath } = s.versionsByPath;
          const { [path]: ___, ...dirtyByPath } = s.dirtyByPath;
          const openFiles = s.openFiles.filter((p) => p !== path);
          const activeFileId =
            s.activeFileId === path ? openFiles[openFiles.length - 1] ?? null : s.activeFileId;
          return {
            filesByPath,
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
          const { [oldPath]: _c, ...filesRest } = s.filesByPath;
          const { [oldPath]: _v, ...verRest } = s.versionsByPath;
          const { [oldPath]: _d, ...dirtyRest } = s.dirtyByPath;
          const nextFiles = { ...filesRest, [trimmed]: content };
          const openFiles = s.openFiles.map((p) => (p === oldPath ? trimmed : p));
          const activeFileId = s.activeFileId === oldPath ? trimmed : s.activeFileId;
          return {
            filesByPath: nextFiles,
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
      setActiveSelection: (selection) => set({ activeSelection: selection }),
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
        const file = diagnostic.file;
        if (file && file in get().filesByPath) {
          get().openFile(file);
        }
        set({
          focusedLine: diagnostic.line ?? null,
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
        const mainFile =
          state.activeFileId && state.activeFileId.endsWith(".tex")
            ? state.activeFileId
            : Object.keys(state.filesByPath).find((path) => path === "main.tex") ??
              Object.keys(state.filesByPath).find((path) => path.endsWith(".tex")) ??
              "main.tex";
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
          if (!res.ok) {
            throw new Error(`Compile queue failed: ${res.status}`);
          }
          const { jobId } = (await res.json()) as { jobId: string };
          set({ buildStatus: "running", buildMessage: `Job ${jobId}` });
          const result = await pollCompileJob(jobId);
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
            pdfDataUrl: result.pdfBase64 ? `data:application/pdf;base64,${result.pdfBase64}` : null,
            pdfPage: 1,
            activeBottomTab: mergedDiagnostics.length > 0 ? "problems" : "log",
          });
        } catch (error: unknown) {
          set({
            buildStatus: "failed",
            buildMessage: error instanceof Error ? error.message : String(error),
            buildLog: error instanceof Error ? error.message : String(error),
          });
        }
      },
      openFile: (id) => set((s) => ({
        openFiles: s.openFiles.includes(id) ? s.openFiles : [...s.openFiles, id],
        activeFileId: id,
        outline: OutlineService.parse(s.filesByPath[id] ?? ""),
        focusedLine: null,
      })),
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
