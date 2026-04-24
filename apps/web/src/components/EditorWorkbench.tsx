"use client";

import {
  createLatexEditorState,
  createLatexEditorView,
  parseInputRefs,
  parseLatexOutline,
  type OutlineHeading,
} from "@alove/editor";
import type { Diagnostic as ProtoDiagnostic } from "@alove/protocol";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { setDiagnostics as cmSetDiagnostics } from "@codemirror/lint";
import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CommandPalette,
  type CommandPaletteAction,
  EditorHeader,
  EditorLeftRail,
  EditorRightRail,
} from "@/components/editor";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Kbd } from "@/components/ui/primitives";
import { useCompileRun, useEditorWorkbenchShortcuts } from "@/hooks";
import { toCmDiagnostics } from "@/lib/editorDiagnostics";
import { listCompileSnapshots } from "@/lib/compileHistory";
import type { BuildUiState, Engine } from "@/types/editor-workbench";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from "react-resizable-panels";
import { TEMPLATES, type TemplateId } from "@/lib/templates";

const SEED = `\\documentclass{article}
\\begin{document}
\\section{Introduction}
Hello from \\textbf{alove}.

\\section{Related work}
Short paragraph.

\\subsection{Details}
Body.
\\end{document}
`;

function countWords(s: string) {
  return s
    .trim()
    .split(/\s+/u)
    .filter(Boolean).length;
}

function colorForId(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `hsl(${hue} 70% 42%)`;
}

export function EditorWorkbench() {
  const { user } = useUser();
  const { resolved: themeResolved, cyclePreference, cyclePaletteId } =
    useTheme();
  const theme = themeResolved;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const filesRef = useRef<Record<string, string>>({ "main.tex": SEED });
  const [files, setFiles] = useState<Record<string, string>>(() => ({
    "main.tex": SEED,
  }));
  const [activeFile, setActiveFile] = useState("main.tex");
  const [outline, setOutline] = useState<OutlineHeading[]>([]);
  const [inputRefs, setInputRefs] = useState(parseInputRefs(SEED));
  const [build, setBuild] = useState<BuildUiState>({ kind: "idle" });
  const [logTail, setLogTail] = useState("");
  const [diagnostics, setDiagnosticRows] = useState<ProtoDiagnostic[]>([]);
  const [engine, setEngine] = useState<Engine>("pdflatex");
  const [cleanAux, setCleanAux] = useState(false);
  const [vim, setVim] = useState(false);
  const [zen, setZen] = useState(false);
  const [autoCompile, setAutoCompile] = useState(false);
  const [palette, setPalette] = useState(false);
  const [wordCount, setWordCount] = useState(countWords(SEED));
  const [pdfZoom, setPdfZoom] = useState(100);
  const [history, setHistory] = useState<
    Awaited<ReturnType<typeof listCompileSnapshots>>
  >([]);
  const [remoteTick, setRemoteTick] = useState(0);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const ensureDefault = useMutation(api.projects.ensureDefault);
  const saveFile = useMutation(api.files.save);
  const heartbeat = useMutation(api.presence.heartbeat);
  const setDesignModeMutation = useMutation(api.projects.setDesignMode);

  const [projectId, setProjectId] = useState<Id<"projects"> | null>(null);

  useEffect(() => {
    void ensureDefault().then(setProjectId);
  }, [ensureDefault]);

  const rows = useQuery(
    api.files.list,
    projectId ? { projectId } : "skip",
  );
  const project = useQuery(
    api.projects.get,
    projectId ? { projectId } : "skip",
  );
  const peers = useQuery(
    api.presence.list,
    projectId ? { projectId } : "skip",
  );

  const rowsRef = useRef<typeof rows>(undefined);
  rowsRef.current = rows;

  useEffect(() => {
    if (!rows) return;
    const next: Record<string, string> = {};
    for (const r of rows) {
      next[r.path] = r.content;
    }
    filesRef.current = next;
    setFiles(next);
    const mine = user?.id;
    const row = rows.find((r) => r.path === activeFile);
    if (row && mine && row.updatedBy !== mine) {
      setRemoteTick((t) => t + 1);
    }
  }, [rows, activeFile, user?.id]);

  useEffect(() => {
    if (!projectId || !user?.id) return;
    const name =
      user.firstName ??
      user.username ??
      user.primaryEmailAddress?.emailAddress ??
      "You";
    const color = colorForId(user.id);
    const tick = () => {
      const v = viewRef.current;
      const line = v
        ? v.state.doc.lineAt(v.state.selection.main.head).number
        : undefined;
      void heartbeat({ projectId, name, color, cursorLine: line });
    };
    tick();
    const id = window.setInterval(tick, 4000);
    return () => window.clearInterval(id);
  }, [heartbeat, projectId, user]);

  const flushActiveToFiles = useCallback(() => {
    const v = viewRef.current;
    if (!v) return;
    const text = v.state.doc.toString();
    filesRef.current = { ...filesRef.current, [activeFile]: text };
    setFiles({ ...filesRef.current });
  }, [activeFile]);

  const openFile = useCallback(
    (path: string) => {
      if (project && !project.designMode && path !== "main.tex") return;
      flushActiveToFiles();
      setActiveFile(path);
    },
    [flushActiveToFiles, project],
  );

  const jumpToOutline = useCallback((from: number) => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch({
      selection: { anchor: from },
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    });
    v.focus();
  }, []);

  const { runCompile, runCompileRef } = useCompileRun({
    projectId,
    activeFile,
    engine,
    cleanAux,
    viewRef,
    flushActiveToFiles,
    filesRef,
    setBuild,
    setLogTail,
    setDiagnosticRows,
    setHistory,
  });

  useEffect(() => {
    if (!projectId) return;
    void listCompileSnapshots(String(projectId)).then(setHistory);
  }, [projectId]);

  useEditorWorkbenchShortcuts({
    onToggleCommandPalette: () => setPalette((p) => !p),
    cyclePreference,
    cyclePaletteId,
  });

  const queueSave = useCallback(
    (path: string, content: string) => {
      if (!projectId) return;
      const prev = saveTimers.current[path];
      if (prev) clearTimeout(prev);
      saveTimers.current[path] = setTimeout(() => {
        const expected = rowsRef.current?.find((r) => r.path === path)?.version;
        void saveFile({
          projectId,
          path,
          content,
          expectedVersion: expected,
        }).then((res) => {
          if (res.conflict) {
            setDiagnosticRows([
              {
                severity: "warning",
                message:
                  "File changed on server — refresh or pick the server copy from history.",
              },
            ]);
          }
        });
      }, 550);
    },
    [projectId, saveFile],
  );

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    let compileDebounce: ReturnType<typeof setTimeout> | undefined;

    const listener = EditorView.updateListener.of((u: ViewUpdate) => {
      if (u.docChanged) {
        const t = u.state.doc.toString();
        filesRef.current = { ...filesRef.current, [activeFile]: t };
        setFiles({ ...filesRef.current });
        setOutline(parseLatexOutline(t));
        setInputRefs(parseInputRefs(t));
        setWordCount(countWords(t));
        queueSave(activeFile, t);
        if (autoCompile) {
          if (compileDebounce) clearTimeout(compileDebounce);
          compileDebounce = setTimeout(() => runCompileRef.current(), 900);
        }
      }
    });

    const initialDoc = filesRef.current[activeFile] ?? "";

    const state = createLatexEditorState(initialDoc, theme, [listener], {
      vim,
    });
    const view = createLatexEditorView(el, state);
    viewRef.current = view;
    setOutline(parseLatexOutline(view.state.doc.toString()));
    setInputRefs(parseInputRefs(view.state.doc.toString()));
    setWordCount(countWords(view.state.doc.toString()));

    return () => {
      if (compileDebounce) clearTimeout(compileDebounce);
      flushActiveToFiles();
      view.destroy();
      viewRef.current = null;
    };
  }, [
    activeFile,
    autoCompile,
    flushActiveToFiles,
    queueSave,
    remoteTick,
    theme,
    vim,
    runCompileRef,
  ]);

  useEffect(() => {
    const v = viewRef.current;
    if (!v || !diagnostics.length) return;
    v.dispatch(
      cmSetDiagnostics(v.state, toCmDiagnostics(v.state.doc, diagnostics)),
    );
  }, [diagnostics]);

  const statusText = useMemo(() => {
    if (build.kind === "idle") return "Idle";
    if (build.kind === "queued") return "Queued…";
    if (build.kind === "running") return "Compiling…";
    if (build.kind === "ready") return "Ready";
    return `Failed — ${build.message}`;
  }, [build]);

  const applyTemplate = useCallback(
    async (id: TemplateId) => {
      if (!projectId) return;
      const t = TEMPLATES[id];
      for (const [path, content] of Object.entries(t.files)) {
        await saveFile({ projectId, path, content });
      }
      setActiveFile(t.mainFile);
    },
    [projectId, saveFile],
  );

  const addTextFile = useCallback(async () => {
    if (!projectId) return;
    if (project && !project.designMode) return;
    flushActiveToFiles();
    let i = 2;
    let name = `extra-${i}.tex`;
    while (filesRef.current[name]) {
      i += 1;
      name = `extra-${i}.tex`;
    }
    await saveFile({ projectId, path: name, content: "% new file\n" });
    setActiveFile(name);
  }, [projectId, project, flushActiveToFiles, saveFile]);

  const paletteActions = useMemo((): CommandPaletteAction[] => {
    const canNewFile = Boolean(projectId && project?.designMode);
    return [
      {
        id: "compile",
        group: "Build",
        label: "Compile project",
        hint: "Run LaTeX and refresh the PDF preview",
        run: () => void runCompile(),
      },
      {
        id: "toggle-auto",
        group: "Build",
        label: autoCompile ? "Disable auto-compile" : "Enable auto-compile",
        run: () => setAutoCompile((a) => !a),
      },
      {
        id: "toggle-clean",
        group: "Build",
        label: cleanAux ? "Disable clean aux" : "Enable clean aux",
        run: () => setCleanAux((c) => !c),
      },
      {
        id: "toggle-vim",
        group: "Editor",
        label: vim ? "Disable Vim bindings" : "Enable Vim bindings",
        run: () => setVim((v) => !v),
      },
      {
        id: "focus-editor",
        group: "Editor",
        label: "Focus code editor",
        run: () => {
          viewRef.current?.focus();
        },
      },
      {
        id: "toggle-zen",
        group: "View",
        label: zen ? "Show side panels" : "Zen mode (hide side panels)",
        run: () => setZen((z) => !z),
      },
      {
        id: "toggle-design",
        group: "Project",
        label: project?.designMode ? "Exit design mode" : "Enter design mode",
        hint: "Unlock multi-file editing",
        disabled: !projectId,
        run: () => {
          if (!projectId) return;
          void setDesignModeMutation({
            projectId,
            designMode: !(project?.designMode ?? false),
          });
        },
      },
      {
        id: "new-tex",
        group: "Project",
        label: "New .tex file",
        disabled: !canNewFile,
        run: () => void addTextFile(),
      },
    ];
  }, [
    runCompile,
    autoCompile,
    cleanAux,
    vim,
    zen,
    project?.designMode,
    projectId,
    setDesignModeMutation,
    addTextFile,
  ]);

  return (
    <div className="flex h-[100dvh] flex-col bg-gradient-to-b from-zinc-50 to-zinc-100 text-zinc-900 dark:from-zinc-950 dark:to-zinc-900 dark:text-zinc-50">
      <EditorHeader
        activeFile={activeFile}
        wordCount={wordCount}
        peers={peers}
        currentUserId={user?.id}
        engine={engine}
        onEngineChange={setEngine}
        cleanAux={cleanAux}
        onCleanAux={setCleanAux}
        vim={vim}
        onVim={setVim}
        autoCompile={autoCompile}
        onAutoCompile={setAutoCompile}
        designMode={project?.designMode ?? false}
        designModeDisabled={!projectId}
        onDesignMode={(v) => {
          if (!projectId) return;
          void setDesignModeMutation({ projectId, designMode: v });
        }}
        zen={zen}
        onZen={() => setZen((z) => !z)}
        onOpenPalette={() => setPalette(true)}
        onCompile={() => void runCompile()}
        statusText={statusText}
        buildKind={build.kind}
      />

      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        actions={paletteActions}
      />

      <PanelGroup direction="horizontal" className="min-h-0 flex-1">
        <Panel
          defaultSize={zen ? 0 : 20}
          minSize={zen ? 0 : 14}
          className={`left-rail min-w-0 ${zen ? "hidden" : ""}`}
        >
          <EditorLeftRail
            zen={zen}
            designMode={Boolean(project?.designMode)}
            files={files}
            activeFile={activeFile}
            onOpenFile={openFile}
            onApplyTemplate={applyTemplate}
            onNewTexFile={addTextFile}
            outline={outline}
            onOutlineJump={jumpToOutline}
            inputRefs={inputRefs}
            history={history}
          />
        </Panel>
        <PanelResizeHandle
          className={`group relative w-2 shrink-0 bg-transparent ${zen ? "hidden" : ""}`}
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zinc-200 group-hover:bg-alove-resize-hover/90 dark:bg-zinc-700 dark:group-hover:bg-alove-resize-hover/80" />
        </PanelResizeHandle>
        <Panel defaultSize={zen ? 100 : 45} minSize={24} className="min-w-0">
          <div className="flex h-full min-h-0 flex-col bg-white/40 dark:bg-zinc-950/40">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-200/90 px-3 py-1.5 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <span className="font-medium text-zinc-600 dark:text-zinc-300">
                Editor
              </span>
              <span className="hidden sm:inline">·</span>
              <span className="flex flex-wrap items-center gap-1">
                <Kbd>⌘F</Kbd> search
              </span>
              <span className="flex flex-wrap items-center gap-1">
                <Kbd>⌘G</Kbd> line
              </span>
              <span className="flex flex-wrap items-center gap-1">
                <Kbd>⌘K</Kbd> commands
              </span>
              <span className="flex flex-wrap items-center gap-1">
                <Kbd>⇧T</Kbd> theme
              </span>
              <span className="flex flex-wrap items-center gap-1">
                <Kbd>⇧P</Kbd> accent
              </span>
              <span className="text-zinc-400">· Alt-drag multi-cursor</span>
            </div>
            <div
              key={`${activeFile}-${vim}-${theme}-${remoteTick}-${rows ? 1 : 0}`}
              ref={hostRef}
              className="min-h-0 flex-1 overflow-hidden"
            />
          </div>
        </Panel>
        <PanelResizeHandle
          className={`group relative w-2 shrink-0 bg-transparent ${zen ? "hidden" : ""}`}
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zinc-200 group-hover:bg-alove-resize-hover/90 dark:bg-zinc-700 dark:group-hover:bg-alove-resize-hover/80" />
        </PanelResizeHandle>
        <Panel
          defaultSize={zen ? 0 : 35}
          minSize={zen ? 0 : 22}
          className={`right-rail min-w-0 ${zen ? "hidden" : ""}`}
        >
          <EditorRightRail
            zen={zen}
            build={build}
            pdfZoom={pdfZoom}
            onPdfZoom={setPdfZoom}
            diagnostics={diagnostics}
            logTail={logTail}
          />
        </Panel>
      </PanelGroup>
    </div>
  );
}
