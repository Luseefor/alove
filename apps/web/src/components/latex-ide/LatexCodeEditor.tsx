"use client";

import {
  historyField,
  runLatexEditorCommand,
  type EditorTheme,
  type ProjectCiteEntry,
  type ProjectLabelEntry,
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
import { setDiagnostics, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { toCmDiagnostics } from "@/lib/editorDiagnostics";
import {
  checkDocument,
  useEnglishSpellchecker,
  type SpellChecker,
} from "@/lib/spellcheckService";
import React from "react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
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
  /** Personal dictionary words (lowercase or mixed) excluded from spellcheck. */
  spellcheckCustomWords?: string[];
  /** Session-scoped ignored words excluded from spellcheck. */
  spellcheckIgnoreWords?: string[];
  /**
   * Injected checker (unit-test seam). When omitted, the component lazy-loads
   * the full dictionary-en engine; the bundled word list is never used here.
   */
  spellcheckChecker?: SpellChecker | null;
  onAddSpellcheckWord?: (word: string) => void;
  /** Project-wide bibliography entries for `\cite{...}` completion. */
  citationEntries?: ProjectCiteEntry[];
  /** Project-wide `\label{...}` entries for `\ref{...}` completion. */
  labelEntries?: ProjectLabelEntry[];
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

type CompletionIndex = {
  cites: ProjectCiteEntry[];
  labels: ProjectLabelEntry[];
};

function matchCase(source: string, suggestion: string): string {
  if (
    source.length > 0 &&
    source[0] === source[0]!.toUpperCase() &&
    source.slice(1) === source.slice(1).toLowerCase()
  ) {
    return suggestion.charAt(0).toUpperCase() + suggestion.slice(1);
  }
  return suggestion;
}

function toSpellcheckDiagnostics(
  docText: string,
  opts: {
    enabled: boolean;
    readOnly: boolean;
    customWords: string[];
    ignoreWords: string[];
    checker: SpellChecker | null;
    onAddWord?: (word: string) => void;
  },
): CmDiagnostic[] {
  if (!opts.enabled || !docText || !opts.checker) return [];
  const hits = checkDocument(docText, opts.checker, {
    customWords: opts.customWords,
    ignoreWords: opts.ignoreWords,
    maxMisspellings: 100,
    maxSuggestions: 3,
  });
  return hits.map((hit) => {
    const quoted =
      hit.suggestions.length > 0
        ? `“${hit.word}” — did you mean ${hit.suggestions
            .slice(0, 3)
            .map((s) => `“${matchCase(hit.word, s)}”`)
            .join(", ")}?`
        : `Unknown word “${hit.word}”`;
    if (opts.readOnly) {
      return {
        from: hit.from,
        to: hit.to,
        severity: "warning" as const,
        message: quoted,
        source: "spellcheck",
      };
    }
    const actions: { name: string; apply: (view: EditorView, from: number, to: number) => void }[] = hit.suggestions
      .slice(0, 3)
      .map((suggestion) => {
        const insert = matchCase(hit.word, suggestion);
        return {
          name: `Use “${insert}”`,
          apply: (view: EditorView, from: number, to: number) => {
            view.dispatch({ changes: { from, to, insert } });
          },
        };
      });
    if (opts.onAddWord) {
      const lower = hit.word.toLowerCase();
      const onAddWord = opts.onAddWord;
      actions.push({
        name: "Add to dictionary",
        apply: () => {
          onAddWord(lower);
        },
      });
    }
    return {
      from: hit.from,
      to: hit.to,
      severity: "warning" as const,
      message: quoted,
      source: "spellcheck",
      actions,
    };
  });
}

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

// Bounded per-file retention: at most this many inactive files keep their
// CodeMirror EditorState (doc + undo/redo + selection) for instant tab
// switches. Eviction is LRU by last unmount time.
export const MAX_RETAINED_EDITOR_STATES = 20;

function cacheEditorState(
  cache: Map<string, EditorState> | undefined,
  key: string | undefined,
  state: EditorState,
) {
  if (!cache || !key) return;
  // Refresh recency: Map.set on an existing key preserves insertion order,
  // so delete first to move the entry to most-recent. The key is then newest
  // and eviction of the oldest never removes the just-written entry.
  if (cache.has(key)) cache.delete(key);
  cache.set(key, state);
  while (cache.size > MAX_RETAINED_EDITOR_STATES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function buildDynamicExtensions(
  theme: EditorTheme,
  settings: LatexSettings,
  completion?: CompletionIndex | null,
): Extension[] {
  const cites = completion?.cites ?? [];
  const labels = completion?.labels ?? [];
  return [
    ...createLatexEditorExtensions(theme, {
      vim: settings.keybindings === "vim",
      emacs: settings.keybindings === "emacs",
      lineNumbers: false,
      closeBrackets: settings.autoCloseBrackets,
      wordWrap: settings.wordWrap,
      autocomplete: settings.autocompleteEnabled,
      nonBlinkingCursor: settings.nonBlinkingCursor,
      completionIndex:
        cites.length > 0 || labels.length > 0
          ? () => ({ cites, labels })
          : undefined,
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
    spellcheckCustomWords = [],
    spellcheckIgnoreWords = [],
    spellcheckChecker,
    onAddSpellcheckWord,
    citationEntries = [],
    labelEntries = [],
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
  const onAddSpellcheckWordRef = useRef(onAddSpellcheckWord);
  onAddSpellcheckWordRef.current = onAddSpellcheckWord;

  onChangeRef.current = onChange;
  onSelectionChangeRef.current = onSelectionChange;
  onFocusRef.current = onFocus;

  const completionIndex = useMemo<CompletionIndex>(
    () => ({ cites: citationEntries, labels: labelEntries }),
    [citationEntries, labelEntries],
  );
  // Injected checker (tests). When omitted, the full dictionary-en engine
  // lazy-loads once spellcheck is enabled; there is no bundled-list path.
  const serviceChecker = useEnglishSpellchecker(
    spellCheck && !spellcheckChecker,
  );
  const checker = spellcheckChecker ?? serviceChecker;
  const spellOptions = useMemo(
    () => ({
      enabled: spellCheck,
      readOnly,
      customWords: spellcheckCustomWords,
      ignoreWords: spellcheckIgnoreWords,
      checker,
    }),
    [spellCheck, readOnly, spellcheckCustomWords, spellcheckIgnoreWords, checker],
  );
  const spellOptionsRef = useRef(spellOptions);
  spellOptionsRef.current = spellOptions;
  const completionRef = useRef(completionIndex);
  completionRef.current = completionIndex;

  function refreshDiagnostics(view: EditorView) {
    const diagnostic = diagnosticRef.current;
    const spell = spellOptionsRef.current;
    const compile = toCmDiagnostics(
      view.state.doc,
      diagnostic.diagnostics ?? [],
      diagnostic.filePath,
      diagnostic.mainFile,
    );
    const spellDiags = toSpellcheckDiagnostics(
      view.state.doc.toString(),
      {
        ...spell,
        onAddWord: onAddSpellcheckWordRef.current,
      },
    );
    view.dispatch(setDiagnostics(view.state, [...compile, ...spellDiags]));
  }

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
        EditorView.theme({
          "&": { height: "100%", minHeight: "0" },
          ".cm-scroller": { overflow: "auto" },
        }),
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
        compartment.of(
          buildDynamicExtensions(
            initialTheme,
            settings,
            completionRef.current,
          ),
        ),
        ...restoredHistory,
      ],
    });

    const view = createLatexEditorView(host, state);
    viewRef.current = view;
    refreshDiagnostics(view);
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
        buildDynamicExtensions(
          theme,
          {
            readOnly,
            spellCheck,
            wordWrap,
            autoCloseBrackets,
            autocompleteEnabled,
            nonBlinkingCursor,
            keybindings,
            ariaLabel,
          },
          completionIndex,
        ),
      ),
    });
    refreshDiagnostics(view);
  }, [
    ariaLabel,
    autoCloseBrackets,
    autocompleteEnabled,
    nonBlinkingCursor,
    keybindings,
    readOnly,
    spellCheck,
    wordWrap,
    completionIndex,
    spellOptions,
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
          buildDynamicExtensions(
            next,
            settingsRef.current,
            completionRef.current,
          ),
        ),
      });
      refreshDiagnostics(view);
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

  // Immediate refresh for toggles, settings, and checker readiness.
  useEffect(() => {
    const view = viewRef.current;
    if (view) refreshDiagnostics(view);
  }, [diagnostics, filePath, mainFile, spellOptions, completionIndex]);

  // Debounced refresh for keystrokes: full-dictionary suggest() per
  // misspelling is bounded but not keystroke-cheap, so value edits wait.
  useEffect(() => {
    const timer = setTimeout(() => {
      const view = viewRef.current;
      if (view) refreshDiagnostics(view);
    }, 500);
    return () => clearTimeout(timer);
  }, [value]);

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
