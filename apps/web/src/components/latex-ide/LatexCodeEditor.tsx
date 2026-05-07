"use client";

import {
  runLatexEditorCommand,
  type EditorTheme,
  createLatexEditorState,
  createLatexEditorView,
} from "@alove/editor";
import type { EditorKeybindings } from "@/stores/ideSettingsStore";
import { EditorView } from "@codemirror/view";
import React from "react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { cn } from "@/lib/utils";

export type LatexCodeEditorProps = {
  value: string;
  onChange: (nextValue: string) => void;
  className?: string;
  readOnly?: boolean;
  spellCheck?: boolean;
  wordWrap?: boolean;
  autoCloseBrackets?: boolean;
  keybindings?: EditorKeybindings;
  onSelectionChange?: (selection: { start: number; end: number }) => void;
  onFocus?: () => void;
  "aria-label"?: string;
};

export type LatexCodeEditorHandle = {
  focus: () => void;
  getValue: () => string;
  getSelection: () => { start: number; end: number };
  setSelection: (start: number, end: number) => void;
  replaceRange: (start: number, end: number, insert: string) => void;
  runCommand: (command: "undo" | "redo" | "selectAll") => void;
  scrollToLine: (line: number) => void;
};

function detectTheme(): EditorTheme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export const LatexCodeEditor = forwardRef<LatexCodeEditorHandle, LatexCodeEditorProps>(
  function LatexCodeEditor(
    {
      value,
      onChange,
      className,
      readOnly = false,
      spellCheck = false,
      wordWrap = true,
      autoCloseBrackets = true,
      keybindings = "none",
      onSelectionChange,
      onFocus,
      "aria-label": ariaLabel = "LaTeX source editor",
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const onSelectionChangeRef = useRef(onSelectionChange);
    const onFocusRef = useRef(onFocus);
    const initialValueRef = useRef(value);

    onChangeRef.current = onChange;
    onSelectionChangeRef.current = onSelectionChange;
    onFocusRef.current = onFocus;

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;

      const nextDoc = viewRef.current?.state.doc.toString() ?? initialValueRef.current;
      viewRef.current?.destroy();
      host.innerHTML = "";

      const state = createLatexEditorState(
        nextDoc,
        detectTheme(),
        [
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
            if (update.selectionSet) {
              const range = update.state.selection.main;
              onSelectionChangeRef.current?.({
                start: range.from,
                end: range.to,
              });
            }
          }),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({
            "aria-label": ariaLabel,
            spellcheck: String(spellCheck),
          }),
          EditorView.domEventHandlers({
            focus() {
              onFocusRef.current?.();
              return false;
            },
          }),
        ],
        {
          vim: keybindings === "vim",
          lineNumbers: false,
          closeBrackets: autoCloseBrackets,
          wordWrap,
        },
      );

      viewRef.current = createLatexEditorView(host, state);
      return () => {
        viewRef.current?.destroy();
        viewRef.current = null;
      };
    }, [
      ariaLabel,
      autoCloseBrackets,
      keybindings,
      readOnly,
      spellCheck,
      wordWrap,
    ]);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current === value) return;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }, [value]);

    useImperativeHandle(ref, (): LatexCodeEditorHandle => ({
      focus: () => {
        viewRef.current?.focus();
      },
      getValue: () => viewRef.current?.state.doc.toString() ?? "",
      getSelection: () => {
        const range = viewRef.current?.state.selection.main;
        if (!range) return { start: 0, end: 0 };
        return { start: range.from, end: range.to };
      },
      setSelection: (start: number, end: number) => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({
          selection: { anchor: start, head: end },
          scrollIntoView: true,
        });
      },
      replaceRange: (start: number, end: number, insert: string) => {
        const view = viewRef.current;
        if (!view) return;
        const docLength = view.state.doc.length;
        const from = Math.max(0, Math.min(start, docLength));
        const to = Math.max(from, Math.min(end, docLength));
        const caret = from + insert.length;
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: caret, head: caret },
          scrollIntoView: true,
        });
      },
      runCommand: (command) => {
        const view = viewRef.current;
        if (!view) return;
        runLatexEditorCommand(view, command);
      },
      scrollToLine: (line) => {
        const view = viewRef.current;
        if (!view) return;
        const targetLine = Math.max(1, Math.min(line, view.state.doc.lines));
        const linePos = view.state.doc.line(targetLine).from;
        view.dispatch({
          effects: EditorView.scrollIntoView(linePos, { y: "center" }),
        });
      },
    }), []);

    return (
      <div
        ref={hostRef}
        className={cn("h-full w-full overflow-hidden", className)}
      />
    );
  },
);
