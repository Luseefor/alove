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
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { searchKeymap } from "@codemirror/search";
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

function editorBaseTheme(dark: boolean): Extension {
  return EditorView.theme(
    {
      "&": {
        backgroundColor: `var(--background, ${dark ? "#171c23" : "#ffffff"})`,
        color: `var(--foreground, ${dark ? "#dce4ee" : "#253247"})`,
      },
      "&.cm-focused": { outline: "none" },
      ".cm-content": {
        caretColor: `var(--foreground, ${dark ? "#dce4ee" : "#253247"})`,
        padding: "20px 0",
      },
      "&.cm-focused .cm-cursor": {
        borderLeftColor: `var(--foreground, ${dark ? "#dce4ee" : "#253247"})`,
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
        {
          backgroundColor: "var(--editor-selection, #d7e1e6)",
        },
      ".cm-activeLine": { backgroundColor: "var(--editor-line, #f2f1ee)" },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: "var(--editor-gutter, #898d93)",
        border: "none",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
        color: "var(--muted-foreground, #686c72)",
      },
      ".cm-foldPlaceholder": {
        backgroundColor: "var(--muted, #f0efec)",
        border: "none",
        color: "var(--muted-foreground, #686c72)",
      },
      ".cm-tooltip, .cm-panels": {
        backgroundColor: "var(--card-bg, #ffffff)",
        color: `var(--foreground, ${dark ? "#dce4ee" : "#253247"})`,
        borderColor: "var(--border, #e2e1dd)",
      },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
        backgroundColor: "var(--accent, #eae9e5)",
        color: `var(--foreground, ${dark ? "#dce4ee" : "#253247"})`,
      },
      ".cm-searchMatch": {
        backgroundColor: "var(--warning-bg, #f7f1e5)",
        outline: "1px solid var(--warning, #866128)",
      },
    },
    { dark },
  );
}

function createLatexHighlight(dark: boolean): HighlightStyle {
  const color = (token: string, light: string, night: string) =>
    `var(${token}, ${dark ? night : light})`;
  return HighlightStyle.define([
    {
      tag: [
        t.keyword,
        t.controlKeyword,
        t.tagName,
        t.macroName,
        t.function(t.variableName),
      ],
      color: color("--syntax-command", "#705581", "#baa6ca"),
    },
    {
      tag: [t.string, t.special(t.string)],
      color: color("--syntax-string", "#426e57", "#a8c4ad"),
    },
    {
      tag: [t.number, t.bool, t.atom],
      color: color("--syntax-number", "#856230", "#c8b18c"),
    },
    {
      tag: [t.comment, t.lineComment],
      color: color("--syntax-comment", "#73777d", "#939aa4"),
      fontStyle: "italic",
    },
    {
      tag: [t.bracket, t.brace, t.paren, t.squareBracket],
      color: color("--syntax-punctuation", "#66748a", "#a5abb4"),
    },
    { tag: [t.invalid], color: color("--error", "#ab4e50", "#d9a0a1") },
  ]);
}
const latexHighlightLight = createLatexHighlight(false);
const latexHighlightDark = createLatexHighlight(true);

function themeExtension(theme: EditorTheme): Extension[] {
  return [
    editorBaseTheme(theme === "dark"),
    syntaxHighlighting(
      theme === "dark" ? latexHighlightDark : latexHighlightLight,
    ),
  ];
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
  createVisualEditing,
  visualDocumentField,
  visualSourceTransaction,
  formatVisualSelection,
  escapeVisualText,
} from "./visualEditing";
export type { VisualFormat } from "./visualEditing";
export { canEditVisualRange, applyGuardedVisualPatches } from "./visualEditing";
