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
  history,
  historyKeymap,
  indentWithTab,
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
import { latexAutocomplete } from "./snippets";
import { editorExtrasKeymap } from "./keymapExtras";

export { parseLatexOutline, type OutlineHeading };
export { parseInputRefs, type InputRef } from "./inputRefs";

export type EditorTheme = "light" | "dark";

export type LatexEditorOptions = {
  vim?: boolean;
};

const latexHighlightLight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword], color: "#0c4a6e", fontWeight: "600" },
  { tag: [t.macroName, t.function(t.variableName)], color: "#0369a1" },
  { tag: [t.string, t.special(t.string)], color: "#166534" },
  { tag: [t.number, t.bool, t.atom], color: "#7c2d12" },
  { tag: [t.comment, t.lineComment], color: "#64748b", fontStyle: "italic" },
  { tag: [t.brace, t.paren, t.squareBracket], color: "#334155" },
  { tag: [t.invalid], color: "#b91c1c" },
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
    : [syntaxHighlighting(latexHighlightLight)];
}

export function createLatexEditorExtensions(
  theme: EditorTheme,
  options: LatexEditorOptions = {},
): Extension[] {
  return [
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    lineNumbers(),
    highlightActiveLine(),
    highlightSpecialChars(),
    drawSelection(),
    rectangularSelection(),
    crosshairCursor(),
    history(),
    foldGutter(),
    codeFolding(),
    latexBeginEndFold,
    bracketMatching(),
    closeBrackets(),
    StreamLanguage.define(stex),
    latexAutocomplete,
    lintGutter(),
    keymap.of([
      ...closeBracketsKeymap,
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
