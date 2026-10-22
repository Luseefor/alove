"use client";
import { parseVisualObjects } from "@/lib/visualObjects";

import {
  createVisualEditing,
  applyGuardedVisualPatches,
  formatVisualSelection,
  visualDocumentField,
  visualSourceTransaction,
  type VisualFormat,
  historyField,
  runLatexEditorCommand,
  type EditorTheme,
  type ProjectCiteEntry,
  type ProjectLabelEntry,
  createLatexEditorExtensions,
  createLatexEditorView,
} from "@alove/editor";
import {
  createVisualObjectExtension,
  refreshVisualObjectAssets,
} from "./visualObjectExtension";
import type { VisualObject } from "@/lib/visualObjects";
import type { VisualSourcePatch } from "@/lib/visualObjectTypes";
import type { EditorKeybindings } from "@/stores/ideSettingsStore";
import { EditorView } from "@codemirror/view";
import {
  Compartment,
  EditorState,
  Annotation,
  Transaction,
  type Extension,
  type Text,
} from "@codemirror/state";
import type { Diagnostic } from "@alove/protocol";
import {
  setDiagnostics,
  type Diagnostic as CmDiagnostic,
} from "@codemirror/lint";
import { toCmDiagnostics } from "@/lib/editorDiagnostics";
import {
  checkDocument,
  getSpellingSuggestions,
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
  objectAssets?: Record<string, string>;
  onOpenVisualObject?: (object: VisualObject, source: string) => void;
  presentation?: "source" | "visual";
  onRequestSource?: () => void;
  onVisualBlocked?: (message: string) => void;
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
  applySourcePatches: (
    expected: string,
    patches: VisualSourcePatch[],
  ) => boolean;
  format: (kind: VisualFormat) => void;
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
  presentation: "source" | "visual";
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

// Module-constant defaults: prop defaults like `= []` allocate a fresh
// array every render, and effect deps on those identities refire on plain
// rerenders (e.g. a focus-triggered store update). A view.dispatch from
// such a spurious refresh can land between Playwright's select-all and
// insert and collapse the DOM selection, so fill() appends instead of
// replacing. Never allocate defaults inline.
const EMPTY_WORDS: string[] = [];
const EMPTY_CITES: ProjectCiteEntry[] = [];
const EMPTY_LABELS: ProjectLabelEntry[] = [];

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
  const checker = opts.checker;
  const hits = checkDocument(docText, checker, {
    customWords: opts.customWords,
    ignoreWords: opts.ignoreWords,
    maxMisspellings: 100,
    // Mark prose promptly; expensive correction ranking waits for a visible tooltip.
    maxSuggestions: 0,
  });
  return hits.map((hit) => {
    const diagnostic: CmDiagnostic = {
      from: hit.from,
      to: hit.to,
      severity: "warning",
      message: `Unknown word “${hit.word}”`,
      source: "spellcheck",
      renderMessage: () => {
        const suggestions = getSpellingSuggestions(checker, hit.word);
        const message = document.createElement("span");
        message.textContent = suggestions.length
          ? `“${hit.word}” — did you mean ${suggestions.map((word) => `“${matchCase(hit.word, word)}”`).join(", ")}?`
          : diagnostic.message;
        if (!opts.readOnly) {
          const actions = suggestions.map((suggestion) => {
            const insert = matchCase(hit.word, suggestion);
            return {
              name: `Use “${insert}”`,
              apply: (view: EditorView, from: number, to: number) => {
                if (view.state.doc.sliceString(from, to) !== hit.word) return;
                view.dispatch({ changes: { from, to, insert } });
              },
            };
          });
          if (opts.onAddWord)
            actions.push({
              name: "Add to dictionary",
              apply: () => opts.onAddWord!(hit.word.toLowerCase()),
            });
          diagnostic.actions = actions;
        }
        return message;
      },
    };
    return diagnostic;
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
  getCompletion?: () => CompletionIndex,
  visualCallbacks?: {
    requestSource: () => void;
    onBlocked: (message: string) => void;
    getAssets: () => Record<string, string>;
    getView: () => EditorView | null;
    onOpen: (object: VisualObject, source: string) => void;
  },
): Extension[] {
  return [
    ...(settings.presentation === "visual" && visualCallbacks
      ? [
          createVisualEditing({
            ...visualCallbacks,
            opaqueRanges: parseVisualObjects,
          }),
          createVisualObjectExtension(visualCallbacks),
        ]
      : []),
    ...createLatexEditorExtensions(theme, {
      vim: settings.presentation !== "visual" && settings.keybindings === "vim",
      emacs:
        settings.presentation !== "visual" && settings.keybindings === "emacs",
      lineNumbers: false,
      closeBrackets:
        settings.presentation !== "visual" && settings.autoCloseBrackets,
      wordWrap: settings.wordWrap,
      autocomplete:
        settings.presentation !== "visual" && settings.autocompleteEnabled,
      nonBlinkingCursor: settings.nonBlinkingCursor,
      // Stable getter: the project-aware source reads the live index at
      // invocation time, so language updates never rebuild this compartment.
      completionIndex: getCompletion,
    }),
    EditorState.readOnly.of(settings.readOnly),
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
    objectAssets,
    onOpenVisualObject,
    presentation = "source",
    onRequestSource,
    onVisualBlocked,
    diagnostics,
    filePath,
    mainFile,
    onChange,
    className,
    readOnly = false,
    spellCheck = false,
    spellcheckCustomWords = EMPTY_WORDS,
    spellcheckIgnoreWords = EMPTY_WORDS,
    spellcheckChecker,
    onAddSpellcheckWord,
    citationEntries = EMPTY_CITES,
    labelEntries = EMPTY_LABELS,
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
  const visualCallbacksRef = useRef({
    onRequestSource,
    onVisualBlocked,
    objectAssets,
    onOpenVisualObject,
  });
  visualCallbacksRef.current = {
    onRequestSource,
    onVisualBlocked,
    objectAssets,
    onOpenVisualObject,
  };
  const visualCallbacks = useRef({
    requestSource: () => visualCallbacksRef.current.onRequestSource?.(),
    getAssets: () => visualCallbacksRef.current.objectAssets ?? {},
    getView: () => viewRef.current,
    onOpen: (object: VisualObject, source: string) =>
      visualCallbacksRef.current.onOpenVisualObject?.(object, source),
    onBlocked: (message: string) =>
      visualCallbacksRef.current.onVisualBlocked?.(message),
  }).current;
  const viewRef = useRef<EditorView | null>(null);
  const previousAssets = useRef<Record<string, string>>({});
  useEffect(() => {
    const assets = Object.fromEntries(
      Object.entries(objectAssets ?? {}).filter(([, value]) =>
        value.startsWith("data:"),
      ),
    );
    const before = previousAssets.current;
    previousAssets.current = assets;
    if (
      Object.keys(before).length !== Object.keys(assets).length ||
      Object.keys(assets).some((key) => before[key] !== assets[key])
    ) {
      viewRef.current?.dispatch({
        effects: refreshVisualObjectAssets.of(null),
      });
    }
  }, [objectAssets]);
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

  const completionRef = useRef<CompletionIndex>({ cites: [], labels: [] });
  completionRef.current = { cites: citationEntries, labels: labelEntries };
  // Stable across renders: the completion source reads the live index
  // through this getter at invocation time, so per-keystroke array
  // identities from the project store never rebuild the compartment.
  const getCompletionIndex = useRef<() => CompletionIndex>(
    () => completionRef.current,
  ).current;
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
    [
      spellCheck,
      readOnly,
      spellcheckCustomWords,
      spellcheckIgnoreWords,
      checker,
    ],
  );
  const spellOptionsRef = useRef(spellOptions);
  spellOptionsRef.current = spellOptions;

  // Last dispatched diagnostic refresh, per view. A refresh whose inputs
  // are all identical on an unchanged doc is a no-op and must not
  // dispatch: e.g. the debounced value timer firing after a checker-ready
  // immediate refresh would otherwise replace the same diagnostics and
  // dismiss a hovered lint tooltip (spelling suggestions).
  const lastRefreshRef = useRef<null | {
    view: EditorView;
    doc: Text;
    diagnostics: Diagnostic[] | undefined;
    filePath: string | undefined;
    mainFile: string | null | undefined;
    spell: typeof spellOptions;
    onAddWord: ((word: string) => void) | undefined;
  }>(null);

  function refreshDiagnostics(view: EditorView) {
    const diagnostic = diagnosticRef.current;
    const spell = spellOptionsRef.current;
    const onAddWord = onAddSpellcheckWordRef.current;
    const doc = view.state.doc;
    const prev = lastRefreshRef.current;
    if (
      prev !== null &&
      prev.view === view &&
      prev.doc === doc &&
      prev.diagnostics === diagnostic.diagnostics &&
      prev.filePath === diagnostic.filePath &&
      prev.mainFile === diagnostic.mainFile &&
      prev.spell === spell &&
      prev.onAddWord === onAddWord
    ) {
      return;
    }
    const compile = toCmDiagnostics(
      doc,
      diagnostic.diagnostics ?? [],
      diagnostic.filePath,
      diagnostic.mainFile,
    );
    const spellDiags = toSpellcheckDiagnostics(doc.toString(), {
      ...spell,
      onAddWord,
    });
    view.dispatch(setDiagnostics(view.state, [...compile, ...spellDiags]));
    lastRefreshRef.current = {
      view,
      doc,
      diagnostics: diagnostic.diagnostics,
      filePath: diagnostic.filePath,
      mainFile: diagnostic.mainFile,
      spell,
      onAddWord,
    };
  }

  const compartmentRef = useRef<Compartment | null>(null);
  if (!compartmentRef.current) {
    compartmentRef.current = new Compartment();
  }
  const settingsRef = useRef<LatexSettings>({
    presentation,
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
    presentation,
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
  const previousPresentation = useRef(presentation);

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
            getCompletionIndex,
            visualCallbacks,
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
      lastRefreshRef.current = null;
    };
  }, [getCompletionIndex, visualCallbacks]);

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
            presentation,
            readOnly,
            spellCheck,
            wordWrap,
            autoCloseBrackets,
            autocompleteEnabled,
            nonBlinkingCursor,
            keybindings,
            ariaLabel,
          },
          getCompletionIndex,
          visualCallbacks,
        ),
      ),
    });
    if (presentation === "visual") {
      const model = view.state.field(visualDocumentField, false);
      const selection = view.state.selection.main;
      if (
        model &&
        (selection.from < model.body.from || selection.to > model.body.to)
      ) {
        view.dispatch({
          selection: { anchor: model.body.from },
          scrollIntoView: true,
        });
      }
    }
    if (previousPresentation.current !== presentation) {
      previousPresentation.current = presentation;
      // EditorView.focus restores its canonical selection; a bare DOM focus can
      // otherwise adopt the browser's collapsed selection after a toolbar click.
      view.focus();
    }
    refreshDiagnostics(view);
  }, [
    presentation,
    visualCallbacks,
    ariaLabel,
    autoCloseBrackets,
    autocompleteEnabled,
    getCompletionIndex,
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
          buildDynamicExtensions(
            next,
            settingsRef.current,
            getCompletionIndex,
            visualCallbacks,
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
  }, [getCompletionIndex, visualCallbacks]);

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
        visualSourceTransaction.of("external"),
        Transaction.addToHistory.of(recordExternalChanges),
      ],
    });
  }, [value, recordExternalChanges]);

  // Immediate refresh for compile diagnostics only. Spell config has its
  // own effect below; completion data never needs a marker refresh.
  useEffect(() => {
    const view = viewRef.current;
    if (view) refreshDiagnostics(view);
  }, [diagnostics, filePath, mainFile]);

  // Spell checker/custom-word changes refresh markers without touching
  // the settings compartment.
  useEffect(() => {
    const view = viewRef.current;
    if (view) refreshDiagnostics(view);
  }, [checker, spellcheckCustomWords, spellcheckIgnoreWords]);

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
      applySourcePatches: (expected, patches) => {
        const view = viewRef.current;
        return !!view && applyGuardedVisualPatches(view, expected, patches);
      },
      format: (kind) => {
        const view = viewRef.current;
        if (view) formatVisualSelection(view, kind, visualCallbacks.onBlocked);
      },
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
        const model = view.state.field(visualDocumentField, false);
        if (
          model &&
          (start < model.body.from ||
            end > model.body.to ||
            model.protected.some(
              (range) => start < range.to && end > range.from,
            ))
        ) {
          visualCallbacks.requestSource();
        }
        view.dispatch({
          selection: { anchor: start, head: end },
          scrollIntoView: true,
        });
      },
      replaceRange: (start: number, end: number, insert: string) => {
        const view = viewRef.current;
        if (!view || view.state.readOnly) return;
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
    [visualCallbacks],
  );

  return (
    <div
      ref={hostRef}
      data-testid="latex-editor-codemirror"
      data-presentation={presentation}
      className={cn("h-full w-full overflow-hidden", className)}
    />
  );
});
