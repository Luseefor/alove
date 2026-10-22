"use client";

import { useWorkbenchStore } from "@/stores/workbenchStore";
import { useIdeSettingsStore } from "@/stores/ideSettingsStore";
import { X, Plus, Search } from "lucide-react";
import Image from "next/image";
import React, { useMemo } from "react";
import type { EditorState } from "@codemirror/state";
import type { VisualFormat } from "@alove/editor";
import { useVisualObjects } from "./VisualObjectDialog";
import { VisualWritingToolbar } from "./VisualWritingToolbar";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { getEditorMode } from "@/lib/editorMode";
import { buildProjectLanguageIndex } from "@/lib/projectLanguage";
import { useSpellcheckStatus } from "@/lib/spellcheckService";
import { LatexCodeEditor, type LatexCodeEditorHandle } from "./LatexCodeEditor";

export function EditorPane({
  presentation = "source",
  onRequestSource,
}: {
  presentation?: "source" | "visual";
  onRequestSource?: () => void;
} = {}) {
  const [visualMessage, setVisualMessage] = useState("");
  const {
    activeFileId,
    projectId,
    mainFile,
    diagnostics,
    diagnosticRevision,
    documentRevision,
    openFiles,
    filesByPath,
    dirtyByPath,
    focusedLine,
    nextSelection,
    editorCommand,
    findBarRequestId,
    editorWordWrap,
    openFile,
    closeFile,
    createFile,
    updateActiveFileContent,
    setActiveSelection,
    saveActiveFile,
    setFocusedLine,
    cursor,
  } = useWorkbenchStore();

  const spellcheckEnabled = useIdeSettingsStore((s) => s.spellcheckEnabled);
  const spellcheckCustomWords = useIdeSettingsStore(
    (s) => s.spellcheckCustomWords,
  );
  const addSpellcheckWord = useIdeSettingsStore((s) => s.addSpellcheckWord);
  const editorCodeCheck = useIdeSettingsStore((s) => s.editorCodeCheck);
  const setSpellcheckEnabled = useIdeSettingsStore(
    (s) => s.setSpellcheckEnabled,
  );
  const editorAutocomplete = useIdeSettingsStore((s) => s.editorAutocomplete);
  const editorAutoCloseBrackets = useIdeSettingsStore(
    (s) => s.editorAutoCloseBrackets,
  );
  const editorNonBlinkingCursor = useIdeSettingsStore(
    (s) => s.editorNonBlinkingCursor,
  );
  const editorKeybindings = useIdeSettingsStore((s) => s.editorKeybindings);
  // Optional role from primary (`owner` local default). Viewers get a
  // non-editable source surface; the store still guards mutations.
  const projectRole = useWorkbenchStore(
    (s) =>
      (s as unknown as { projectRole?: "owner" | "editor" | "viewer" | null })
        .projectRole ?? "owner",
  );
  const isViewer = projectRole === "viewer";

  const projectLanguageIndex = useMemo(
    () => buildProjectLanguageIndex(filesByPath),
    [filesByPath],
  );

  const history = useMemo(
    () => ({
      projectId,
      states: new Map<string, EditorState>(),
      generations: new Map<string, number>(),
    }),
    [projectId],
  );
  const historyCache = history.states;
  useEffect(
    () =>
      useWorkbenchStore.subscribe((state, previous) => {
        if (state.projectId !== projectId || previous.projectId !== projectId)
          return;
        // Observe intermediate deletes even when React batches deletion and recreation.
        for (const path of Object.keys(previous.filesByPath)) {
          if (!Object.hasOwn(state.filesByPath, path)) {
            const generation = history.generations.get(path) ?? 0;
            history.states.delete(`${path}#${generation}`);
            history.generations.set(path, generation + 1);
          }
        }
      }),
    [history, projectId],
  );
  const historyKey = activeFileId
    ? `${activeFileId}#${history.generations.get(activeFileId) ?? 0}`
    : "";
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const codeEditorRef = useRef<LatexCodeEditorHandle | null>(null);

  const visualObjects = useVisualObjects(
    codeEditorRef,
    onRequestSource,
    setVisualMessage,
  );

  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");

  const content = activeFileId ? (filesByPath[activeFileId] ?? "") : "";

  const codeMirrorEnabled = getEditorMode() === "codemirror";

  const focusEditor = useCallback(() => {
    if (codeMirrorEnabled) {
      codeEditorRef.current?.focus();
      return;
    }
    textareaRef.current?.focus();
  }, [codeMirrorEnabled]);

  const setEditorSelection = useCallback(
    (start: number, end: number) => {
      if (codeMirrorEnabled) {
        codeEditorRef.current?.setSelection(start, end);
        return;
      }
      textareaRef.current?.setSelectionRange(start, end);
    },
    [codeMirrorEnabled],
  );

  const isBinaryPreview =
    /^data:(?:image\/[a-zA-Z0-9.+-]+|application\/pdf);base64,/.test(content);
  const visualActive =
    presentation === "visual" &&
    codeMirrorEnabled &&
    !!activeFileId?.toLowerCase().endsWith(".tex") &&
    !isBinaryPreview;
  const lineAtCursor = content.split("\n")[Math.max(0, cursor.line - 1)] ?? "";
  const headingStyle = /^\\(section|subsection|subsubsection)\*?\{/.exec(
    lineAtCursor,
  )?.[1];
  const paragraphStyle = (headingStyle ?? "paragraph") as VisualFormat;
  useEffect(() => {
    setVisualMessage("");
  }, [presentation, content]);
  const createNewFile = useCallback(() => {
    const base = "untitled";
    const ext = ".tex";
    let index = 0;
    let path = `${base}${ext}`;
    while (path in filesByPath) {
      index += 1;
      path = `${base}-${index}${ext}`;
    }
    createFile(path, "", { open: true });
  }, [createFile, filesByPath]);

  useEffect(() => {
    if (!nextSelection) return;
    focusEditor();
    setEditorSelection(nextSelection.start, nextSelection.end);
    useWorkbenchStore.setState({
      nextSelection: null,
      activeSelection: nextSelection,
    });
  }, [focusEditor, nextSelection, setEditorSelection]);

  useEffect(() => {
    if (focusedLine === null || !activeFileId) return;
    const rows = content.split("\n");
    const line = Math.max(1, Math.min(focusedLine, rows.length));
    const start = rows
      .slice(0, line - 1)
      .reduce((n, row) => n + row.length + 1, 0);
    setEditorSelection(start, start);
    if (codeMirrorEnabled) codeEditorRef.current?.scrollToLine(line);
    focusEditor();
    setFocusedLine(null);
  }, [
    focusedLine,
    activeFileId,
    content,
    codeMirrorEnabled,
    focusEditor,
    setEditorSelection,
    setFocusedLine,
  ]);

  useEffect(() => {
    if (findBarRequestId > 0) setFindOpen(true);
  }, [findBarRequestId]);

  const findNext = (backwards = false) => {
    if (!findQuery) return;
    const selection = codeMirrorEnabled
      ? codeEditorRef.current?.getSelection()
      : textareaRef.current
        ? {
            start: textareaRef.current.selectionStart,
            end: textareaRef.current.selectionEnd,
          }
        : null;
    const index = backwards
      ? content.lastIndexOf(
          findQuery,
          Math.max(-1, (selection?.start ?? content.length) - 1),
        )
      : content.indexOf(findQuery, selection?.end ?? 0);
    const wrapped =
      index >= 0
        ? index
        : backwards
          ? content.lastIndexOf(findQuery)
          : content.indexOf(findQuery);
    if (wrapped >= 0) {
      setEditorSelection(wrapped, wrapped + findQuery.length);
      setActiveSelection({ start: wrapped, end: wrapped + findQuery.length });
    }
  };

  useEffect(() => {
    if (!editorCommand) return;
    focusEditor();
    const clear = () => useWorkbenchStore.setState({ editorCommand: null });
    const kind = editorCommand.kind;

    if (kind === "undo") {
      if (codeMirrorEnabled) {
        codeEditorRef.current?.runCommand("undo");
      } else {
        document.execCommand("undo");
      }
      clear();
      return;
    }
    if (kind === "redo") {
      if (codeMirrorEnabled) {
        codeEditorRef.current?.runCommand("redo");
      } else {
        document.execCommand("redo");
      }
      clear();
      return;
    }
    if (kind === "selectAll") {
      if (codeMirrorEnabled) {
        codeEditorRef.current?.runCommand("selectAll");
        const nextSelection = codeEditorRef.current?.getSelection() ?? {
          start: 0,
          end: 0,
        };
        setActiveSelection(nextSelection);
      } else if (textareaRef.current) {
        textareaRef.current.setSelectionRange(
          0,
          textareaRef.current.value.length,
        );
        setActiveSelection({
          start: 0,
          end: textareaRef.current.value.length,
        });
      }
      clear();
      return;
    }
    clear();
  }, [codeMirrorEnabled, editorCommand, focusEditor, setActiveSelection]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;
      if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        saveActiveFile();
      }
      if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveActiveFile]);

  if (!activeFileId) {
    return (
      <div
        className="h-full bg-background flex flex-col items-center justify-center text-center p-8 space-y-4"
        data-testid="latex-editor"
      >
        <div className="w-16 h-16 rounded-[24px] bg-muted flex items-center justify-center text-zinc-300 border border-border shadow-sm">
          <FileTextIcon className="w-8 h-8" />
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-foreground">No file active</h3>
          <p className="text-[12px] text-muted-foreground max-w-[200px] leading-relaxed">
            Select a file from the sidebar to begin writing your research.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-full flex flex-col bg-background overflow-hidden shadow-[inset_1px_1px_3px_rgba(0,0,0,0.02)]"
      data-testid="latex-editor"
      onKeyDownCapture={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "f"
        ) {
          event.preventDefault();
          event.stopPropagation();
          setFindOpen(true);
        }
      }}
    >
      {/* Tabs Bar */}
      <div className="h-10 border-b flex items-center bg-muted/30 shrink-0 overflow-x-auto scrollbar-hide pr-12 relative group/tabs">
        {openFiles.map((path) => {
          const isActive = path === activeFileId;
          const name = path.split("/").pop() ?? path;
          const isDirty = dirtyByPath[path];
          return (
            <div
              key={path}
              onClick={() => openFile(path)}
              className={cn(
                "group h-10 px-4 flex items-center gap-2 border-r border-border cursor-pointer transition-all relative min-w-[120px] max-w-[200px]",
                isActive
                  ? "bg-background text-foreground font-bold shadow-[0_1px_2px_rgba(0,0,0,0.05)] z-10"
                  : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
              )}
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full transition-all shrink-0",
                  isActive
                    ? "bg-primary shadow-[0_0_5px_rgba(124,58,237,0.5)]"
                    : "bg-transparent group-hover:bg-zinc-300",
                )}
              />
              <span className="text-[12px] truncate flex-1 tracking-tight">
                {name}
              </span>
              {isDirty && (
                <span className="text-[10px] font-black text-primary opacity-60">
                  *
                </span>
              )}
              <button
                aria-label={`Close ${name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(path);
                }}
                className={cn(
                  "p-0.5 rounded-md hover:bg-muted transition-all ml-1",
                  isActive
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100",
                )}
              >
                <X size={10} strokeWidth={3} />
              </button>
              {isActive && (
                <div className="absolute top-0 inset-x-0 h-[2px] bg-primary rounded-full shadow-[0_1px_5px_rgba(124,58,237,0.3)]" />
              )}
            </div>
          );
        })}
        <button
          type="button"
          title="New file"
          onClick={createNewFile}
          className="h-10 w-10 flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-muted transition-all border-r border-border"
        >
          <Plus size={16} />
        </button>
      </div>

      {visualActive && (
        <VisualWritingToolbar
          readOnly={isViewer}
          style={paragraphStyle}
          onRequestSource={onRequestSource}
          onInsertObject={visualObjects.insert}
          onFormat={(kind) => codeEditorRef.current?.format(kind)}
        />
      )}
      {visualActive && (
        <div
          role="status"
          aria-live="polite"
          className="shrink-0 border-b border-border bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground"
        >
          {visualMessage ||
            "Visual writing · custom LaTeX stays available in Source."}
        </div>
      )}
      {visualObjects.dialog}
      {/* Editor Content Area */}
      <div className="flex-1 overflow-hidden relative flex flex-col bg-background">
        {findOpen && (
          <div className="absolute top-0 right-4 z-50 p-2">
            <div className="bg-background border border-border shadow-2xl rounded-xl p-1.5 flex items-center gap-2 ring-4 ring-zinc-50/50">
              <div className="flex items-center bg-muted rounded-lg px-2.5 py-1 gap-2 border border-transparent focus-within:border-primary/20 focus-within:bg-background transition-all w-48">
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
                <input
                  autoFocus
                  data-testid="find-input"
                  value={findQuery}
                  onChange={(e) => setFindQuery(e.target.value)}
                  aria-label="Find in file"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      findNext(event.shiftKey);
                    }
                    if (event.key === "Escape") {
                      setFindOpen(false);
                      focusEditor();
                    }
                  }}
                  placeholder="Find in file..."
                  className="bg-transparent border-none text-[11px] text-foreground placeholder:text-muted-foreground focus:ring-0 w-full p-0 font-medium"
                />
              </div>
              <button
                type="button"
                onClick={() => findNext(true)}
                aria-label="Previous match"
                className="px-1 text-xs"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => findNext()}
                aria-label="Next match"
                className="px-1 text-xs"
              >
                ↓
              </button>
              <button
                className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Close find"
                onClick={() => setFindOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden min-h-0">
          {isBinaryPreview ? (
            <div className="flex h-full w-full flex-col gap-3 overflow-auto p-4">
              <p className="text-xs text-muted-foreground">
                Binary asset · source is preserved
              </p>
              {activeFileId.toLowerCase().endsWith(".pdf") ? (
                <iframe
                  title={activeFileId}
                  src={content}
                  className="min-h-80 w-full flex-1 border-0"
                />
              ) : (
                <Image
                  unoptimized
                  width={1200}
                  height={1200}
                  src={content}
                  alt={activeFileId}
                  className="max-h-full max-w-full object-contain"
                />
              )}
            </div>
          ) : codeMirrorEnabled ? (
            <LatexCodeEditor
              key={`${projectId}:${historyKey}`}
              ref={codeEditorRef}
              historyCache={historyCache}
              historyKey={historyKey}
              recordExternalChanges={
                Boolean(dirtyByPath[activeFileId]) || Boolean(nextSelection)
              }
              value={content}
              presentation={visualActive ? "visual" : "source"}
              onRequestSource={onRequestSource}
              onVisualBlocked={setVisualMessage}
              objectAssets={filesByPath}
              onOpenVisualObject={visualObjects.open}
              filePath={activeFileId ?? undefined}
              mainFile={mainFile}
              diagnostics={
                editorCodeCheck && diagnosticRevision === documentRevision
                  ? diagnostics
                  : undefined
              }
              onChange={updateActiveFileContent}
              readOnly={isViewer}
              spellCheck={spellcheckEnabled}
              spellcheckCustomWords={spellcheckCustomWords}
              onAddSpellcheckWord={addSpellcheckWord}
              citationEntries={projectLanguageIndex.citations}
              labelEntries={projectLanguageIndex.labels}
              wordWrap={editorWordWrap}
              autoCloseBrackets={editorAutoCloseBrackets}
              autocompleteEnabled={editorAutocomplete}
              nonBlinkingCursor={editorNonBlinkingCursor}
              keybindings={editorKeybindings}
              onSelectionChange={setActiveSelection}
              onFocus={() => {
                setActiveSelection(
                  codeEditorRef.current?.getSelection() ?? null,
                );
                if (focusedLine) setFocusedLine(null);
              }}
              aria-label={
                visualActive
                  ? "Visual manuscript editor"
                  : "LaTeX source editor"
              }
              className={cn(
                "h-full w-full bg-background leading-[22px] text-foreground",
                editorNonBlinkingCursor && "ide-caret-noblink",
              )}
            />
          ) : (
            <textarea
              aria-label="LaTeX source editor"
              data-testid="latex-editor-textarea"
              ref={textareaRef}
              value={content}
              onChange={(e) => updateActiveFileContent(e.target.value)}
              spellCheck={spellcheckEnabled}
              readOnly={isViewer}
              wrap={editorWordWrap ? "soft" : "off"}
              className={cn(
                "h-full w-full resize-none bg-background p-6 leading-[22px] outline-none text-foreground font-mono text-[13px]",
                !editorWordWrap && "whitespace-pre overflow-x-auto",
                editorNonBlinkingCursor && "ide-caret-noblink",
              )}
            />
          )}
        </div>
      </div>

      {/* Editor Status Bar */}
      <div className="h-7 overflow-hidden border-t border-border bg-muted/50 flex items-center justify-between gap-2 px-3 shrink-0 select-none whitespace-nowrap">
        <div className="flex min-w-0 items-center gap-3 text-[10px] text-muted-foreground">
          <span className="text-muted-foreground">
            Ln {cursor.line}, Col {cursor.column}
          </span>
          <span className="hidden sm:inline">Spaces: 2</span>
          <span className="hidden sm:inline">UTF-8</span>
          <span className="hidden xl:inline">LF</span>
          <span className="hidden xl:inline text-primary">LaTeX</span>
        </div>
        <div className="flex shrink-0 items-center text-[10px] text-muted-foreground">
          <SpellcheckToggle
            enabled={spellcheckEnabled}
            onToggle={() => setSpellcheckEnabled(!spellcheckEnabled)}
          />
        </div>
      </div>
    </div>
  );
}

function SpellcheckToggle({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  const { status, error } = useSpellcheckStatus();
  const label = !enabled
    ? "Off"
    : status === "loading"
      ? "Loading…"
      : status === "error"
        ? "Error"
        : "On";
  const title = !enabled
    ? "Spellcheck off"
    : status === "error"
      ? `Spellcheck dictionary failed to load: ${error ?? "network error"}`
      : status === "loading"
        ? "Spellcheck loading English dictionary…"
        : "Spellcheck on";
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-1.5 hover:text-muted-foreground transition-colors"
      title={title}
      aria-label={`Spell: ${label}`}
    >
      <span>Spell: {label}</span>
    </button>
  );
}

function FileTextIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  );
}
