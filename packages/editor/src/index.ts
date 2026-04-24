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
  indentOnInput,
  StreamLanguage,
} from "@codemirror/language";
import {
  closeBrackets,
  closeBracketsKeymap,
} from "@codemirror/autocomplete";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { searchKeymap } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { lintGutter } from "@codemirror/lint";
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

function themeExtension(theme: EditorTheme): Extension[] {
  return theme === "dark" ? [oneDark] : [];
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
