import { openSearchPanel } from "@codemirror/search";
import { EditorView, keymap } from "@codemirror/view";

export const editorExtrasKeymap = keymap.of([
  {
    key: "Mod-g",
    run: (view) => {
      const raw = window.prompt("Go to line number", "1");
      if (raw == null) return true;
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 1) return true;
      const doc = view.state.doc;
      const line = Math.min(Math.max(1, n), doc.lines);
      const pos = doc.line(line).from;
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: "center" }),
      });
      view.focus();
      return true;
    },
  },
  {
    key: "Mod-f",
    run: (view) => {
      openSearchPanel(view);
      return true;
    },
  },
]);
