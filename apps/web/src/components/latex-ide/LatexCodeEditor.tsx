"use client";

import {
  historyField,
  runLatexEditorCommand,
  type EditorTheme,
  createLatexEditorExtensions,
  createLatexEditorView,
} from "@alove/editor";
import type { EditorKeybindings } from "@/stores/ideSettingsStore";
import { EditorView } from "@codemirror/view";
import {
  Compartment,
  EditorState,
  Annotation,
  Transaction,
  type Extension,
} from "@codemirror/state";
import type { Diagnostic } from "@alove/protocol";
import { setDiagnostics } from "@codemirror/lint";
import { toCmDiagnostics } from "@/lib/editorDiagnostics";
import React from "react";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";

export type LatexCodeEditorProps = {
  value: string;
  diagnostics?: Diagnostic[];
  filePath?: string;
  mainFile?: string | null;
  onChange: (nextValue: string) => void;
  className?: string;
  readOnly?: boolean;
  spellCheck?: boolean;
  wordWrap?: boolean;
  autoCloseBrackets?: boolean;
  autocompleteEnabled?: boolean;
  nonBlinkingCursor?: boolean;
  keybindings?: EditorKeybindings;
  recordExternalChanges?: boolean;
  historyCache?: Map<string, EditorState>;
  historyKey?: string;
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

type LatexSettings = {
  readOnly: boolean;
  spellCheck: boolean;
  wordWrap: boolean;
  autoCloseBrackets: boolean;
  autocompleteEnabled: boolean;
  nonBlinkingCursor: boolean;
  keybindings: EditorKeybindings;
  ariaLabel: string;
};

// Marks controlled-prop / server refetch syncs so updateListener can
// suppress the onChange echo without suppressing genuine user edits.
const externalValueSyncAnnotation = Annotation.define<boolean>();

function computeMinimalChange(
  current: string,
  next: string,
): { from: number; to: number; insert: string } | null {
  if (current === next) return null;
  let prefix = 0;
  const maxPrefix = Math.min(current.length, next.length);
  while (prefix < maxPrefix && current[prefix] === next[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  const maxSuffix = Math.min(current.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    from: prefix,
    to: current.length - suffix,
    insert: next.slice(prefix, next.length - suffix),
  };
}

function cacheEditorState(
  cache: Map<string, EditorState> | undefined,
  key: string | undefined,
  state: EditorState,
) {
  if (!cache || !key) return;
  cache.set(key, state);
  while (cache.size > 20) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    if (oldest === key) {
      const it = cache.keys();
      it.next();
      const second = it.next().value as string | undefined;
      if (second === undefined) break;
      cache.delete(second);
    } else {
      cache.delete(oldest);
    }
  }
}

function buildDynamicExtensions(
  theme: EditorTheme,
  settings: LatexSettings,
): Extension[] {
  return [
    ...createLatexEditorExtensions(theme, {
      vim: settings.keybindings === "vim",
      emacs: settings.keybindings === "emacs",
      lineNumbers: false,
      closeBrackets: settings.autoCloseBrackets,
      wordWrap: settings.wordWrap,
      autocomplete: settings.autocompleteEnabled,
      nonBlinkingCursor: settings.nonBlinkingCursor,
    }),
    EditorView.editable.of(!settings.readOnly),
    EditorView.contentAttributes.of({
      "aria-label": settings.ariaLabel,
      spellcheck: String(settings.spellCheck),
      "data-testid": "latex-editor-codemirror-content",
    }),
  ];
}

export const LatexCodeEditor = forwardRef<
  LatexCodeEditorHandle,
  LatexCodeEditorProps
>(function LatexCodeEditor(
  {
    value,
    diagnostics,
    filePath,
    mainFile,
    onChange,
    className,
    readOnly = false,
    spellCheck = false,
    wordWrap = true,
    autoCloseBrackets = true,
    autocompleteEnabled = true,
    nonBlinkingCursor = false,
    keybindings = "none",
    recordExternalChanges = false,
    historyCache,
    historyKey,
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
  const initialHistoryRef = useRef({ historyCache, historyKey });
  const diagnosticRef = useRef({ diagnostics, filePath, mainFile });
  diagnosticRef.current = { diagnostics, filePath, mainFile };

  onChangeRef.current = onChange;
  onSelectionChangeRef.current = onSelectionChange;
  onFocusRef.current = onFocus;

  const compartmentRef = useRef<Compartment | null>(null);
  if (!compartmentRef.current) {
    compartmentRef.current = new Compartment();
  }
  const settingsRef = useRef<LatexSettings>({
    readOnly,
    spellCheck,
    wordWrap,
    autoCloseBrackets,
    autocompleteEnabled,
    nonBlinkingCursor,
    keybindings,
    ariaLabel,
  });
  settingsRef.current = {
    readOnly,
    spellCheck,
    wordWrap,
    autoCloseBrackets,
    autocompleteEnabled,
    nonBlinkingCursor,
    keybindings,
    ariaLabel,
  };
  const themeRef = useRef<EditorTheme | null>(null);

  useEffect(() => {
    const { historyCache, historyKey } = initialHistoryRef.current;
    const host = hostRef.current;
    const compartment = compartmentRef.current;
    if (!host || !compartment) return;

    const initialTheme = detectTheme();
    themeRef.current = initialTheme;
    const settings = settingsRef.current;
    const initialDoc = initialValueRef.current;
    const mountCache = historyCache;
    const mountKey = historyKey;

    let restoredSelection: EditorState["selection"] | undefined;
    let restoredHistory: Extension[] = [];
    if (mountCache && mountKey) {
      const cached = mountCache.get(mountKey);
      if (cached && cached.doc.toString() === initialDoc) {
        restoredSelection = cached.selection;
        const hist = cached.field(historyField, false) as unknown | undefined;
        if (hist !== undefined) {
          const snapshot = hist;
          restoredHistory = [historyField.init(() => snapshot)];
        }
      }
    }

    const state = EditorState.create({
      doc: initialDoc,
      ...(restoredSelection ? { selection: restoredSelection } : {}),
      extensions: [
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const isExternalSync = update.transactions.some((tr) =>
              tr.annotation(externalValueSyncAnnotation),
            );
            if (!isExternalSync) {
              onChangeRef.current(update.state.doc.toString());
            }
          }
          if (update.selectionSet) {
            const range = update.state.selection.main;
            onSelectionChangeRef.current?.({
              start: range.from,
              end: range.to,
            });
          }
        }),
        EditorView.domEventHandlers({
          focus() {
            onFocusRef.current?.();
            return false;
          },
        }),
        compartment.of(buildDynamicExtensions(initialTheme, settings)),
        ...restoredHistory,
      ],
    });

    const view = createLatexEditorView(host, state);
    viewRef.current = view;
    const diagnostic = diagnosticRef.current;
    view.dispatch(
      setDiagnostics(
        view.state,
        toCmDiagnostics(
          view.state.doc,
          diagnostic.diagnostics ?? [],
          diagnostic.filePath,
          diagnostic.mainFile,
        ),
      ),
    );
    return () => {
      cacheEditorState(mountCache, mountKey, view.state);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    const compartment = compartmentRef.current;
    if (!view || !compartment) return;
    const theme = themeRef.current ?? detectTheme();
    themeRef.current = theme;
    view.dispatch({
      effects: compartment.reconfigure(
        buildDynamicExtensions(theme, {
          readOnly,
          spellCheck,
          wordWrap,
          autoCloseBrackets,
          autocompleteEnabled,
          nonBlinkingCursor,
          keybindings,
          ariaLabel,
        }),
      ),
    });
    const diagnostic = diagnosticRef.current;
    view.dispatch(
      setDiagnostics(
        view.state,
        toCmDiagnostics(
          view.state.doc,
          diagnostic.diagnostics ?? [],
          diagnostic.filePath,
          diagnostic.mainFile,
        ),
      ),
    );
  }, [
    ariaLabel,
    autoCloseBrackets,
    autocompleteEnabled,
    nonBlinkingCursor,
    keybindings,
    readOnly,
    spellCheck,
    wordWrap,
  ]);

  useEffect(() => {
    const compartment = compartmentRef.current;
    if (!compartment) return;
    const observer = new MutationObserver(() => {
      const next = detectTheme();
      if (next === themeRef.current) return;
      themeRef.current = next;
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: compartment.reconfigure(
          buildDynamicExtensions(next, settingsRef.current),
        ),
      });
      const diagnostic = diagnosticRef.current;
      view.dispatch(
        setDiagnostics(
          view.state,
          toCmDiagnostics(
            view.state.doc,
            diagnostic.diagnostics ?? [],
            diagnostic.filePath,
            diagnostic.mainFile,
          ),
        ),
      );
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    const change = computeMinimalChange(current, value);
    if (!change) return;
    view.dispatch({
      changes: change,
      annotations: [
        externalValueSyncAnnotation.of(true),
        Transaction.addToHistory.of(recordExternalChanges),
      ],
    });
  }, [value, recordExternalChanges]);

  useEffect(() => {
    const view = viewRef.current;
    if (view)
      view.dispatch(
        setDiagnostics(
          view.state,
          toCmDiagnostics(
            view.state.doc,
            diagnostics ?? [],
            filePath,
            mainFile,
          ),
        ),
      );
  }, [diagnostics, filePath, mainFile, value]);

  useImperativeHandle(
    ref,
    (): LatexCodeEditorHandle => ({
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
    }),
    [],
  );

  return (
    <div
      ref={hostRef}
      data-testid="latex-editor-codemirror"
      className={cn("h-full w-full overflow-hidden", className)}
    />
  );
});
