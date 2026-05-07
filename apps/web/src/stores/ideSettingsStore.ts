import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CompilerEngine = "pdflatex" | "xelatex" | "lualatex";
export type EditorKeybindings = "none" | "vim" | "emacs";
export type PdfViewerStyle = "embedded" | "overleaf" | "browser";

export interface IdeSettingsState {
  editorAutocomplete: boolean;
  editorAutoCloseBrackets: boolean;
  editorNonBlinkingCursor: boolean;
  editorCodeCheck: boolean;
  editorKeybindings: EditorKeybindings;
  pdfViewerStyle: PdfViewerStyle;
  referenceSearchMode: "default" | "fuzzy" | "bibtex";
  spellcheckEnabled: boolean;
  defaultCompilerEngine: CompilerEngine;
  compilerCleanAux: boolean;
  setEditorAutocomplete: (v: boolean) => void;
  setEditorAutoCloseBrackets: (v: boolean) => void;
  setEditorNonBlinkingCursor: (v: boolean) => void;
  setEditorCodeCheck: (v: boolean) => void;
  setEditorKeybindings: (v: EditorKeybindings) => void;
  setPdfViewerStyle: (v: PdfViewerStyle) => void;
  setReferenceSearchMode: (v: IdeSettingsState["referenceSearchMode"]) => void;
  setSpellcheckEnabled: (v: boolean) => void;
  setDefaultCompilerEngine: (v: CompilerEngine) => void;
  setCompilerCleanAux: (v: boolean) => void;
}

export const useIdeSettingsStore = create<IdeSettingsState>()(
  persist(
    (set) => ({
      editorAutocomplete: true,
      editorAutoCloseBrackets: true,
      editorNonBlinkingCursor: false,
      editorCodeCheck: true,
      editorKeybindings: "none",
      pdfViewerStyle: "embedded",
      referenceSearchMode: "default",
      spellcheckEnabled: false,
      defaultCompilerEngine: "xelatex",
      compilerCleanAux: false,
      setEditorAutocomplete: (v) => set({ editorAutocomplete: v }),
      setEditorAutoCloseBrackets: (v) => set({ editorAutoCloseBrackets: v }),
      setEditorNonBlinkingCursor: (v) => set({ editorNonBlinkingCursor: v }),
      setEditorCodeCheck: (v) => set({ editorCodeCheck: v }),
      setEditorKeybindings: (v) => set({ editorKeybindings: v }),
      setPdfViewerStyle: (v) => set({ pdfViewerStyle: v }),
      setReferenceSearchMode: (v) => set({ referenceSearchMode: v }),
      setSpellcheckEnabled: (v) => set({ spellcheckEnabled: v }),
      setDefaultCompilerEngine: (v) => set({ defaultCompilerEngine: v }),
      setCompilerCleanAux: (v) => set({ compilerCleanAux: v }),
    }),
    { name: "alove-ide-settings-v1" },
  ),
);
