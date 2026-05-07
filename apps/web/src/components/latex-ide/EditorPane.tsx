"use client";

import { useWorkbenchStore } from "@/stores/workbenchStore";
import { useIdeSettingsStore } from "@/stores/ideSettingsStore";
import {
  FileCode,
  Search,
  Maximize2,
  Save,
  Play,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  LatexCodeEditor,
  type LatexCodeEditorHandle,
} from "./LatexCodeEditor";

export function EditorPane() {
  const {
    activeFileId,
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
    updateActiveFileContent,
    setActiveSelection,
    saveActiveFile,
    runCompile,
    setFocusedLine,
  } = useWorkbenchStore();
  const spellcheckEnabled = useIdeSettingsStore((s) => s.spellcheckEnabled);
  const editorAutoCloseBrackets = useIdeSettingsStore((s) => s.editorAutoCloseBrackets);
  const editorNonBlinkingCursor = useIdeSettingsStore((s) => s.editorNonBlinkingCursor);
  const editorKeybindings = useIdeSettingsStore((s) => s.editorKeybindings);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const codeEditorRef = useRef<LatexCodeEditorHandle | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findRegex, setFindRegex] = useState(false);
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findMatches, setFindMatches] = useState<number[]>([]);
  const [findIndex, setFindIndex] = useState(0);
  const content = activeFileId ? filesByPath[activeFileId] ?? "" : "";
  const selection = useWorkbenchStore((s) => s.activeSelection);
  const lineCount = useMemo(
    () => Math.max(1, content.split("\n").length),
    [content],
  );
  const wordCount = useMemo(() => {
    const words = content.trim().match(/\S+/g);
    return words ? words.length : 0;
  }, [content]);
  const codeMirrorEnabled =
    process.env.NEXT_PUBLIC_ENABLE_CODEMIRROR_EDITOR === "true";

  const focusEditor = useCallback(() => {
    if (codeMirrorEnabled) {
      codeEditorRef.current?.focus();
      return;
    }
    textareaRef.current?.focus();
  }, [codeMirrorEnabled]);

  const readSelection = useCallback((): { start: number; end: number } => {
    if (codeMirrorEnabled) {
      return codeEditorRef.current?.getSelection() ?? { start: 0, end: 0 };
    }
    const el = textareaRef.current;
    if (!el) return { start: 0, end: 0 };
    return { start: el.selectionStart ?? 0, end: el.selectionEnd ?? 0 };
  }, [codeMirrorEnabled]);

  const readEditorValue = useCallback((): string => {
    if (codeMirrorEnabled) {
      return codeEditorRef.current?.getValue() ?? content;
    }
    return textareaRef.current?.value ?? content;
  }, [codeMirrorEnabled, content]);

  const setEditorSelection = useCallback((start: number, end: number) => {
    if (codeMirrorEnabled) {
      codeEditorRef.current?.setSelection(start, end);
      return;
    }
    textareaRef.current?.setSelectionRange(start, end);
  }, [codeMirrorEnabled]);

  useEffect(() => {
    if (!focusedLine) return;
    if (codeMirrorEnabled) {
      codeEditorRef.current?.scrollToLine(focusedLine);
      codeEditorRef.current?.focus();
      return;
    }
    if (!textareaRef.current) return;
    const rowHeight = 22;
    textareaRef.current.scrollTop = Math.max(0, (focusedLine - 3) * rowHeight);
    textareaRef.current.focus();
  }, [activeFileId, codeMirrorEnabled, focusedLine]);

  useEffect(() => {
    if (!nextSelection) return;
    focusEditor();
    setEditorSelection(nextSelection.start, nextSelection.end);
    useWorkbenchStore.setState({ nextSelection: null, activeSelection: nextSelection });
  }, [focusEditor, nextSelection, setEditorSelection]);

  useEffect(() => {
    if (findBarRequestId > 0) setFindOpen(true);
  }, [findBarRequestId]);

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
        const nextSelection = readSelection();
        setActiveSelection(nextSelection);
      } else if (textareaRef.current) {
        textareaRef.current.setSelectionRange(0, textareaRef.current.value.length);
        setActiveSelection({
          start: 0,
          end: textareaRef.current.value.length,
        });
      }
      clear();
      return;
    }

    const { start, end } = readSelection();
    const value = readEditorValue();

    if (kind === "copy") {
      const slice = value.slice(start, end);
      void navigator.clipboard.writeText(slice).then(clear).catch(clear);
      return;
    }

    if (kind === "cut") {
      const slice = value.slice(start, end);
      void navigator.clipboard
        .writeText(slice)
        .then(() => {
          const next = `${value.slice(0, start)}${value.slice(end)}`;
          if (codeMirrorEnabled) {
            codeEditorRef.current?.replaceRange(start, end, "");
          } else {
            updateActiveFileContent(next);
          }
          useWorkbenchStore.setState({
            nextSelection: { start, end: start },
            activeSelection: { start, end: start },
            editorCommand: null,
          });
        })
        .catch(clear);
      return;
    }

    if (kind === "paste") {
      void navigator.clipboard
        .readText()
        .then((text) => {
          const next = `${value.slice(0, start)}${text}${value.slice(end)}`;
          const caret = start + text.length;
          if (codeMirrorEnabled) {
            codeEditorRef.current?.replaceRange(start, end, text);
          } else {
            updateActiveFileContent(next);
          }
          useWorkbenchStore.setState({
            nextSelection: { start: caret, end: caret },
            activeSelection: { start: caret, end: caret },
            editorCommand: null,
          });
        })
        .catch(clear);
      return;
    }

    clear();
  }, [
    codeMirrorEnabled,
    editorCommand,
    focusEditor,
    readEditorValue,
    readSelection,
    setActiveSelection,
    updateActiveFileContent,
  ]);

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
      if (e.key === "Enter") {
        e.preventDefault();
        void runCompile();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runCompile, saveActiveFile]);

  useEffect(() => {
    if (!findQuery) {
      setFindMatches([]);
      setFindIndex(0);
      return;
    }
    const indices: number[] = [];
    if (findRegex) {
      try {
        const regex = new RegExp(findQuery, findCaseSensitive ? "g" : "gi");
        for (const m of content.matchAll(regex)) {
          indices.push(m.index ?? 0);
        }
      } catch {
        setFindMatches([]);
        setFindIndex(0);
        return;
      }
    } else {
      const haystack = findCaseSensitive ? content : content.toLowerCase();
      const needle = findCaseSensitive ? findQuery : findQuery.toLowerCase();
      let from = 0;
      while (from < haystack.length) {
        const idx = haystack.indexOf(needle, from);
        if (idx === -1) break;
        indices.push(idx);
        from = idx + Math.max(needle.length, 1);
      }
    }
    setFindMatches(indices);
    setFindIndex(0);
  }, [findQuery, content, findRegex, findCaseSensitive]);

  const jumpToFind = (targetIndex: number) => {
    if (findMatches.length === 0 || !findQuery) return;
    const nextIdx = ((targetIndex % findMatches.length) + findMatches.length) % findMatches.length;
    const from = findMatches[nextIdx];
    let to = from + findQuery.length;
    if (findRegex) {
      try {
        const regex = new RegExp(findQuery, findCaseSensitive ? "g" : "gi");
        const all = [...content.matchAll(regex)];
        const target = all[nextIdx];
        if (target) {
          to = from + target[0].length;
        }
      } catch {
        // keep fallback length
      }
    }
    focusEditor();
    setEditorSelection(from, to);
    setActiveSelection({ start: from, end: to });
    setFindIndex(nextIdx);
  };

  if (!activeFileId) {
    return (
      <div className="h-full bg-background flex items-center justify-center text-sm text-muted-foreground">
        Open a `.tex` file from the project sidebar to start editing.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="h-9 border-b flex items-center gap-1 px-1 bg-background shrink-0 overflow-x-auto">
        {openFiles.map((path) => {
          const isActive = path === activeFileId;
          const name = path.split("/").pop() ?? path;
          const isDirty = dirtyByPath[path];
          return (
            <button
              key={path}
              onClick={() => openFile(path)}
              className={cn(
                "group h-8 px-2 rounded-md text-xs flex items-center gap-2 border",
                isActive
                  ? "bg-muted border-border text-foreground"
                  : "bg-background border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              <FileCode size={13} />
              <span>{name}</span>
              {isDirty && <span className="text-primary">*</span>}
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(path);
                }}
                className="opacity-0 group-hover:opacity-100"
              >
                <X size={12} />
              </span>
            </button>
          );
        })}
      </div>

      <div className="h-9 border-b flex items-center justify-between px-2 bg-background shrink-0 select-none">
        <div className="flex items-center gap-1 text-xs">
          <button className="px-2 py-1 rounded bg-muted text-foreground font-semibold">
            Code Editor
          </button>
          <button className="px-2 py-1 rounded text-muted-foreground hover:text-foreground">
            Visual Editor
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            className="px-2 h-7 rounded text-xs border hover:bg-muted"
            onClick={saveActiveFile}
          >
            <span className="inline-flex items-center gap-1">
              <Save size={13} />
              Save
            </span>
          </button>
          <button
            className="px-2 h-7 rounded text-xs border bg-primary text-primary-foreground hover:opacity-90"
            onClick={() => void runCompile()}
          >
            <span className="inline-flex items-center gap-1">
              <Play size={13} />
              Compile
            </span>
          </button>
          <ToolbarAction icon={Search} onClick={() => setFindOpen((v) => !v)} />
          <ToolbarAction icon={Maximize2} />
        </div>
      </div>
      {findOpen && (
        <div className="h-10 border-b px-2 flex items-center gap-2 bg-muted/20">
          <input
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            placeholder="Find in current file..."
            className="h-7 flex-1 rounded border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-primary"
          />
          <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={findRegex}
              onChange={(e) => setFindRegex(e.target.checked)}
            />
            Regex
          </label>
          <label className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={findCaseSensitive}
              onChange={(e) => setFindCaseSensitive(e.target.checked)}
            />
            Aa
          </label>
          <span className="text-[11px] text-muted-foreground min-w-16 text-center">
            {findMatches.length === 0 ? "0" : `${findIndex + 1}/${findMatches.length}`}
          </span>
          <button onClick={() => jumpToFind(findIndex - 1)} className="h-7 px-2 rounded border text-xs hover:bg-muted">
            Prev
          </button>
          <button onClick={() => jumpToFind(findIndex + 1)} className="h-7 px-2 rounded border text-xs hover:bg-muted">
            Next
          </button>
          <button onClick={() => setFindOpen(false)} className="h-7 px-2 rounded border text-xs hover:bg-muted">
            Close
          </button>
        </div>
      )}

      <div className="flex-1 overflow-hidden relative font-mono text-[13px]">
        <div className="h-full grid grid-cols-[56px_1fr]">
          <div className="border-r bg-muted/20 overflow-hidden pt-3">
            <div className="h-full overflow-auto no-scrollbar">
              {Array.from({ length: lineCount }).map((_, index) => {
                const line = index + 1;
                return (
                  <div
                    key={line}
                    className={cn(
                      "h-[22px] px-2 text-right text-xs select-none",
                      focusedLine === line
                        ? "bg-primary/10 text-primary font-semibold"
                        : "text-muted-foreground/60",
                    )}
                  >
                    {line}
                  </div>
                );
              })}
            </div>
          </div>
          {codeMirrorEnabled ? (
            <LatexCodeEditor
              ref={codeEditorRef}
              value={content}
              onChange={updateActiveFileContent}
              readOnly={false}
              spellCheck={spellcheckEnabled}
              wordWrap={editorWordWrap}
              autoCloseBrackets={editorAutoCloseBrackets}
              keybindings={editorKeybindings}
              onSelectionChange={setActiveSelection}
              onFocus={() => {
                if (focusedLine) setFocusedLine(null);
              }}
              aria-label="LaTeX source editor"
              className={cn(
                "h-full w-full bg-background p-3 leading-[22px] text-foreground",
                editorNonBlinkingCursor && "ide-caret-noblink",
              )}
            />
          ) : (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => updateActiveFileContent(e.target.value)}
              onKeyDown={(e) => {
                if (!activeFileId || !editorAutoCloseBrackets) return;
                if (e.metaKey || e.ctrlKey || e.altKey) return;
                const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
                const close = pairs[e.key];
                if (!close) return;
                const ta = e.currentTarget;
                const start = ta.selectionStart ?? 0;
                const end = ta.selectionEnd ?? 0;
                const v = ta.value;
                const next = `${v.slice(0, start)}${e.key}${close}${v.slice(end)}`;
                e.preventDefault();
                updateActiveFileContent(next);
                const caret = start + 1;
                queueMicrotask(() => {
                  useWorkbenchStore.setState({
                    nextSelection: { start: caret, end: caret },
                    activeSelection: { start: caret, end: caret },
                  });
                });
              }}
              onSelect={(e) => {
                const target = e.currentTarget;
                setActiveSelection({
                  start: target.selectionStart ?? 0,
                  end: target.selectionEnd ?? 0,
                });
              }}
              onClick={() => {
                if (focusedLine) setFocusedLine(null);
              }}
              spellCheck={spellcheckEnabled}
              wrap={editorWordWrap ? "soft" : "off"}
              className={cn(
                "h-full w-full resize-none bg-background p-3 leading-[22px] outline-none text-foreground",
                !editorWordWrap && "whitespace-pre overflow-x-auto",
                editorNonBlinkingCursor && "ide-caret-noblink",
              )}
            />
          )}
        </div>
      </div>
      <div className="h-7 border-t px-3 text-[11px] text-muted-foreground flex items-center justify-between">
        <span>
          {activeFileId} {dirtyByPath[activeFileId] ? "• unsaved" : "• saved"}
        </span>
        <span>
          {wordCount} words · {lineCount} lines
          {selection ? ` · sel ${Math.max(0, selection.end - selection.start)} chars` : ""}
        </span>
      </div>
    </div>
  );
}

function ToolbarAction({
  icon: Icon,
  onClick,
}: {
  icon: LucideIcon;
  onClick?: () => void;
}) {
  return (
    <button onClick={onClick} className="p-1.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors">
      <Icon size={14} />
    </button>
  );
}
