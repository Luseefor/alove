"use client";

import { useWorkbenchStore } from "@/stores/workbenchStore";
import { useIdeSettingsStore } from "@/stores/ideSettingsStore";
import {
  X,
  Plus,
  Check,
  Search
} from "lucide-react";
import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { getEditorMode } from "@/lib/editorMode";
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
    createFile,
    updateActiveFileContent,
    setActiveSelection,
    saveActiveFile,
    setFocusedLine,
    cursor,
  } = useWorkbenchStore();
  
  const spellcheckEnabled = useIdeSettingsStore((s) => s.spellcheckEnabled);
  const setSpellcheckEnabled = useIdeSettingsStore((s) => s.setSpellcheckEnabled);
  const editorAutoCloseBrackets = useIdeSettingsStore((s) => s.editorAutoCloseBrackets);
  const editorNonBlinkingCursor = useIdeSettingsStore((s) => s.editorNonBlinkingCursor);
  const editorKeybindings = useIdeSettingsStore((s) => s.editorKeybindings);
  
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const codeEditorRef = useRef<LatexCodeEditorHandle | null>(null);
  
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  
  const content = activeFileId ? filesByPath[activeFileId] ?? "" : "";
  
  const codeMirrorEnabled = getEditorMode() === "codemirror";

  const focusEditor = useCallback(() => {
    if (codeMirrorEnabled) {
      codeEditorRef.current?.focus();
      return;
    }
    textareaRef.current?.focus();
  }, [codeMirrorEnabled]);

  const setEditorSelection = useCallback((start: number, end: number) => {
    if (codeMirrorEnabled) {
      codeEditorRef.current?.setSelection(start, end);
      return;
    }
    textareaRef.current?.setSelectionRange(start, end);
  }, [codeMirrorEnabled]);
  
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
    useWorkbenchStore.setState({ nextSelection: null, activeSelection: nextSelection });
  }, [focusEditor, nextSelection, setEditorSelection]);

  useEffect(() => {
    if (findBarRequestId > 0) setFindOpen(true);
  }, [findBarRequestId]);
  
  useEffect(() => {
    if (!findOpen) return;
    const query = findQuery.trim();
    if (!query) return;
    const index = content.indexOf(query);
    if (index === -1) return;
    focusEditor();
    setEditorSelection(index, index + query.length);
    setActiveSelection({ start: index, end: index + query.length });
  }, [content, findOpen, findQuery, focusEditor, setActiveSelection, setEditorSelection]);

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
        const nextSelection = codeEditorRef.current?.getSelection() ?? { start: 0, end: 0 };
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
      <div className="h-full bg-white flex flex-col items-center justify-center text-center p-8 space-y-4" data-testid="latex-editor">
        <div className="w-16 h-16 rounded-[24px] bg-zinc-50 flex items-center justify-center text-zinc-300 border border-zinc-100 shadow-sm">
           <FileTextIcon className="w-8 h-8" />
        </div>
        <div className="space-y-1">
           <h3 className="text-sm font-bold text-zinc-900">No file active</h3>
           <p className="text-[12px] text-zinc-500 max-w-[200px] leading-relaxed">
             Select a file from the sidebar to begin writing your research.
           </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden shadow-[inset_1px_1px_3px_rgba(0,0,0,0.02)]" data-testid="latex-editor">
      {/* Tabs Bar */}
      <div className="h-10 border-b flex items-center bg-zinc-50/30 shrink-0 overflow-x-auto scrollbar-hide pr-12 relative group/tabs">
        {openFiles.map((path) => {
          const isActive = path === activeFileId;
          const name = path.split("/").pop() ?? path;
          const isDirty = dirtyByPath[path];
          return (
            <div
              key={path}
              onClick={() => openFile(path)}
              className={cn(
                "group h-10 px-4 flex items-center gap-2 border-r border-zinc-100 cursor-pointer transition-all relative min-w-[120px] max-w-[200px]",
                isActive
                  ? "bg-white text-zinc-900 font-bold shadow-[0_1px_2px_rgba(0,0,0,0.05)] z-10"
                  : "text-zinc-500 hover:bg-zinc-50/80 hover:text-zinc-700"
              )}
            >
              <span className={cn(
                 "w-1.5 h-1.5 rounded-full transition-all shrink-0",
                 isActive ? "bg-primary shadow-[0_0_5px_rgba(124,58,237,0.5)]" : "bg-transparent group-hover:bg-zinc-300"
              )} />
              <span className="text-[12px] truncate flex-1 tracking-tight">{name}</span>
              {isDirty && <span className="text-[10px] font-black text-primary opacity-60">*</span>}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(path);
                }}
                className={cn(
                  "p-0.5 rounded-md hover:bg-zinc-100 transition-all ml-1",
                  isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                )}
              >
                <X size={10} strokeWidth={3} />
              </button>
              {isActive && <div className="absolute top-0 inset-x-0 h-[2px] bg-primary rounded-full shadow-[0_1px_5px_rgba(124,58,237,0.3)]" />}
            </div>
          );
        })}
        <button
          type="button"
          title="New file"
          onClick={createNewFile}
          className="h-10 w-10 flex items-center justify-center text-zinc-400 hover:text-primary hover:bg-zinc-50 transition-all border-r border-zinc-100"
        >
           <Plus size={16} />
        </button>
      </div>

      {/* Editor Content Area */}
      <div className="flex-1 overflow-hidden relative flex flex-col bg-white">
        {findOpen && (
          <div className="absolute top-0 right-4 z-50 p-2">
             <div className="bg-white border border-zinc-200 shadow-2xl rounded-xl p-1.5 flex items-center gap-2 ring-4 ring-zinc-50/50">
               <div className="flex items-center bg-zinc-50 rounded-lg px-2.5 py-1 gap-2 border border-transparent focus-within:border-primary/20 focus-within:bg-white transition-all w-48">
                  <Search className="w-3.5 h-3.5 text-zinc-400" />
                  <input
                    autoFocus
                    data-testid="find-input"
                    value={findQuery}
                    onChange={(e) => setFindQuery(e.target.value)}
                    placeholder="Find in file..."
                    className="bg-transparent border-none text-[11px] text-zinc-900 placeholder:text-zinc-400 focus:ring-0 w-full p-0 font-medium"
                  />
               </div>
               <button className="p-1.5 text-zinc-400 hover:text-zinc-900 transition-colors" onClick={() => setFindOpen(false)}>
                  <X size={14} />
               </button>
             </div>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden min-h-0">
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
                "h-full w-full bg-white leading-[22px] text-zinc-900",
                editorNonBlinkingCursor && "ide-caret-noblink",
              )}
            />
          ) : (
            <textarea
              data-testid="latex-editor-textarea"
              ref={textareaRef}
              value={content}
              onChange={(e) => updateActiveFileContent(e.target.value)}
              spellCheck={spellcheckEnabled}
              wrap={editorWordWrap ? "soft" : "off"}
              className={cn(
                "h-full w-full resize-none bg-white p-6 leading-[22px] outline-none text-zinc-900 font-mono text-[13px]",
                !editorWordWrap && "whitespace-pre overflow-x-auto",
                editorNonBlinkingCursor && "ide-caret-noblink",
              )}
            />
          )}
        </div>
      </div>

      {/* Editor Status Bar */}
      <div className="h-8 border-t bg-zinc-50/50 flex items-center justify-between px-4 shrink-0 select-none">
        <div className="flex items-center gap-6 text-[10px] font-black uppercase tracking-widest text-zinc-400">
           <span className="text-zinc-600">Ln {cursor.line}, Col {cursor.column}</span>
           <span>Spaces: 2</span>
           <span>UTF-8</span>
           <span>LF</span>
           <span className="text-primary font-black">LaTeX</span>
        </div>
        <div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-widest text-zinc-400">
           <div className="flex items-center gap-1.5 text-success bg-success-bg px-1.5 py-0.5 rounded-sm border border-success-border">
              <Check size={10} strokeWidth={3} />
              <span>Synced</span>
           </div>
            <button
              type="button"
              onClick={() => setSpellcheckEnabled(!spellcheckEnabled)}
              className="flex items-center gap-1.5 hover:text-zinc-600 transition-colors"
              title={`Spellcheck ${spellcheckEnabled ? "on" : "off"}`}
            >
               <span>Spell: {spellcheckEnabled ? "On" : "Off"}</span>
            </button>
         </div>
       </div>
    </div>
  );
}

function FileTextIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  );
}
