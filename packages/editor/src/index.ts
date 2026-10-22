import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  emacsStyleKeymap,
  history,
  historyField,
  historyKeymap,
  indentWithTab,
  redo,
  selectAll,
  undo,
} from "@codemirror/commands";
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  HighlightStyle,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import {
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { searchKeymap } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { lintGutter } from "@codemirror/lint";
import { tags as t } from "@lezer/highlight";
import { vim } from "@replit/codemirror-vim";
import { parseLatexOutline, type OutlineHeading } from "./outline";
import { latexBeginEndFold } from "./latexFold";
import { createLatexAutocomplete } from "./snippets";
import { editorExtrasKeymap } from "./keymapExtras";
import type { ProjectLanguageIndex } from "./projectCompletion";

export { latexAutocomplete } from "./snippets";
export {
  createLatexAutocomplete,
  createProjectAwareCompletionSource,
  createProjectCompletionExtension,
} from "./snippets";
export type { ProjectIndexGetter } from "./snippets";

export { parseLatexOutline, type OutlineHeading };
export { parseInputRefs, type InputRef } from "./inputRefs";
export {
  parseBibEntries,
  parseTexLabels,
  findCiteCompletion,
  findRefCompletion,
  buildCiteCompletions,
  buildRefCompletions,
  createProjectCompletionSource,
  CITE_COMMANDS,
  REF_COMMANDS,
} from "./projectCompletion";
export type {
  ProjectCiteEntry,
  ProjectLabelEntry,
  ProjectLanguageIndex,
} from "./projectCompletion";
export {
  extractProseTokens,
  maskLatexProse,
  findMisspellings,
  suggestCorrections,
  levenshtein,
  normalizeWord,
  normalizeCustomWord,
  getBaseDictionary,
  createDictionary,
} from "./latexSpellcheck";
export type {
  ProseToken,
  Misspelling,
  SpellcheckOptions,
} from "./latexSpellcheck";
export { historyField };

export type EditorTheme = "light" | "dark";

export type LatexEditorOptions = {
  vim?: boolean;
  emacs?: boolean;
  lineNumbers?: boolean;
  closeBrackets?: boolean;
  wordWrap?: boolean;
  autocomplete?: boolean;
  nonBlinkingCursor?: boolean;
  /** Project cite/label index for `\cite{}` / `\ref{}` completion. */
  completionIndex?: () => ProjectLanguageIndex;
};

export type LatexEditorCommand = "undo" | "redo" | "selectAll";

const lightBaseTheme = EditorView.theme({
  "&": {
    backgroundColor: "#ffffff",
    color: "#0f172a",
  },
  ".cm-content": {
    caretColor: "#7c3aed",
    padding: "24px 0",
  },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "#7c3aed",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "#7c3aed22",
  },
  ".cm-activeLine": {
    backgroundColor: "#7c3aed08",
  },
  ".cm-gutters": {
    backgroundColor: "#fdfcff",
    color: "#94a3b8",
    borderRight: "1px solid #e8e6f2",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "#7c3aed11",
    color: "#7c3aed",
    fontWeight: "bold",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "#f1f5f9",
    border: "none",
    color: "#64748b",
  },
}, { dark: false });

const latexHighlightLight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword], color: "#7c3aed", fontWeight: "700" },
  { tag: [t.macroName, t.function(t.variableName)], color: "#4c1d95", fontWeight: "600" },
  { tag: [t.string, t.special(t.string)], color: "#059669" },
  { tag: [t.number, t.bool, t.atom], color: "#d97706" },
  { tag: [t.comment, t.lineComment], color: "#94a3b8", fontStyle: "italic" },
  { tag: [t.brace, t.paren, t.squareBracket], color: "#64748b" },
  { tag: [t.invalid], color: "#ef4444" },
]);

const latexHighlightDark = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword], color: "#7dd3fc", fontWeight: "600" },
  { tag: [t.macroName, t.function(t.variableName)], color: "#38bdf8" },
  { tag: [t.string, t.special(t.string)], color: "#86efac" },
  { tag: [t.number, t.bool, t.atom], color: "#fdba74" },
  { tag: [t.comment, t.lineComment], color: "#94a3b8", fontStyle: "italic" },
  { tag: [t.brace, t.paren, t.squareBracket], color: "#cbd5e1" },
  { tag: [t.invalid], color: "#fca5a5" },
]);

function themeExtension(theme: EditorTheme): Extension[] {
  return theme === "dark"
    ? [oneDark, syntaxHighlighting(latexHighlightDark)]
    : [lightBaseTheme, syntaxHighlighting(latexHighlightLight)];
}

export function createLatexEditorExtensions(
  theme: EditorTheme,
  options: LatexEditorOptions = {},
): Extension[] {
  const shouldShowLineNumbers = options.lineNumbers !== false;
  const shouldCloseBrackets = options.closeBrackets !== false;
  const shouldAutocomplete = options.autocomplete !== false;
  const nonBlinkingCursor = options.nonBlinkingCursor === true;
  return [
    // Retain CR in existing CRLF/mixed endings instead of normalizing untouched source.
    EditorState.lineSeparator.of("\n"),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    ...(shouldShowLineNumbers ? [lineNumbers()] : []),
    ...(options.wordWrap ? [EditorView.lineWrapping] : []),
    highlightActiveLine(),
    highlightSpecialChars(),
    drawSelection(nonBlinkingCursor ? { cursorBlinkRate: 0 } : undefined),
    rectangularSelection(),
    crosshairCursor(),
    history(),
    foldGutter(),
    codeFolding(),
    latexBeginEndFold,
    bracketMatching(),
    ...(shouldCloseBrackets ? [closeBrackets()] : []),
    StreamLanguage.define(stex),
    ...(shouldAutocomplete
      ? [createLatexAutocomplete(options.completionIndex)]
      : []),
    lintGutter(),
    keymap.of([
      ...(options.emacs ? emacsStyleKeymap : []),
      ...(shouldCloseBrackets ? closeBracketsKeymap : []),
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
    editorExtrasKeymap,
    ...(options.vim ? [vim()] : []),
    ...themeExtension(theme),
  ];
}

export function createLatexEditorState(
  doc: string,
  theme: EditorTheme,
  extra: Extension[] = [],
  options: LatexEditorOptions = {},
) {
  return EditorState.create({
    doc,
    extensions: [...createLatexEditorExtensions(theme, options), ...extra],
  });
}

export function createLatexEditorView(
  parent: HTMLElement,
  state: EditorState,
  extra: Extension[] = [],
) {
  return new EditorView({ state, parent, extensions: extra });
}

export function runLatexEditorCommand(
  view: EditorView,
  command: LatexEditorCommand,
) {
  if (command === "undo") {
    return undo(view);
  }
  if (command === "redo") {
    return redo(view);
  }
  return selectAll(view);
}

export { parseVisualDocument } from "./visualDocument";
export type { VisualDocument } from "./visualDocument";
export {
  createVisualEditing, visualDocumentField, visualSourceTransaction,
  formatVisualSelection, escapeVisualText,
} from "./visualEditing";
export type { VisualFormat } from "./visualEditing";
