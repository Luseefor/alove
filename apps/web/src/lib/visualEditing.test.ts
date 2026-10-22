import { describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import {
  createLatexEditorExtensions,
  runLatexEditorCommand,
} from "@alove/editor";
import type { EditorView } from "@codemirror/view";
import {
  createVisualEditing,
  visualSourceTransaction,
  escapeVisualText,
} from "../../../../packages/editor/src/visualEditing";

const source =
  "% untouched setup\r\n\\documentclass{article}\r\n\\newcommand{\\custom}{safe}\r\n\\begin{document}\r\n\\section{Intro}\r\nPlain prose and \\textbf{bold text}.\r\n% untouched comment\r\n\\custom\r\n\\end{document}\r\n";
function editor(doc = source, readOnly = false) {
  const blocked = vi.fn();
  let state = EditorState.create({
    doc,
    extensions: [
      createLatexEditorExtensions("light"),
      EditorState.readOnly.of(readOnly),
      createVisualEditing({ requestSource() {}, onBlocked: blocked }),
    ],
  });
  return {
    blocked,
    get state() {
      return state;
    },
    change(from: number, to: number, insert: string) {
      state = state.update({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        annotations: Transaction.userEvent.of("input.type"),
      }).state;
    },
    dispatch(tr: ReturnType<EditorState["update"]>) {
      state = tr.state;
    },
  };
}

describe("source-preserving visual transactions", () => {
  it("inserts at the visual end before CRLF and preserves mixed endings", () => {
    const e = editor("A sentence.\r\nNext line.\nLast line.");
    const at = e.state.doc.toString().indexOf("\n");
    e.change(at, at, "%");
    expect(e.state.doc.toString()).toBe(
      "A sentence.\\%\r\nNext line.\nLast line.",
    );
    expect(e.state.selection.main.head).toBe("A sentence.\\%".length);
  });

  it("edits prose while preserving every setup/comment/custom byte", () => {
    const e = editor();
    const from = source.indexOf("Plain prose");
    e.change(from, from + 5, "Revised");
    expect(e.state.doc.toString()).toBe(
      source.slice(0, from) + "Revised" + source.slice(from + 5),
    );
    expect(e.blocked).not.toHaveBeenCalled();
  });
  it("refuses deletions across hidden wrappers and leaves canonical source intact", () => {
    const e = editor();
    e.change(source.indexOf("and "), source.indexOf("bold text") + 4, "lost");
    expect(e.state.doc.toString()).toBe(source);
    expect(e.blocked).toHaveBeenCalledOnce();
  });
  it("refuses typing at unknown command/argument boundaries so names cannot change", () => {
    for (const doc of ["\\custom{body}", "\\custom body"]) {
      const e = editor(doc);
      e.change("\\custom".length, "\\custom".length, "x");
      expect(e.state.doc.toString()).toBe(doc);
      expect(e.blocked).toHaveBeenCalledOnce();
    }
  });

  it("refuses preamble, comment and unknown macro changes", () => {
    for (const word of ["untouched setup", "untouched comment", "custom}"]) {
      const e = editor();
      const at = source.indexOf(word);
      e.change(at, at + 1, "X");
      expect(e.state.doc.toString()).toBe(source);
      expect(e.blocked).toHaveBeenCalled();
    }
  });
  it("escapes pasted prose characters and keeps the caret after escaped input", () => {
    const e = editor();
    const at = source.indexOf("Plain");
    const inserted = "50% & $5_{x} ~ ^ \\";
    e.change(at, at, inserted);
    const escaped = escapeVisualText(inserted);
    expect(e.state.doc.sliceString(at, at + escaped.length)).toBe(escaped);
    expect(e.state.selection.main.head).toBe(at + escaped.length);
    expect(e.state.doc.toString().slice(at + escaped.length)).toBe(
      source.slice(at),
    );
  });
  it("allows deleting a complete escaped literal without leaving a slash", () => {
    const e = editor("A 50\\% result.");
    const at = e.state.doc.toString().indexOf("\\%");
    e.change(at, at + 2, "");
    expect(e.state.doc.toString()).toBe("A 50 result.");
    const partial = editor("A \\% result.");
    partial.change(3, 4, "");
    expect(partial.state.doc.toString()).toBe("A \\% result.");
  });
  it("permits undo to restore exact original bytes after escaped insertion", () => {
    const e = editor();
    const at = source.indexOf("Plain");
    e.change(at, at, "50% ");
    const applied = runLatexEditorCommand(
      { state: e.state, dispatch: e.dispatch } as unknown as EditorView,
      "undo",
    );
    expect(applied).toBe(true);
    expect(e.state.doc.toString()).toBe(source);
  });
  it("keeps multi-cursor source edits local and maps both cursors", () => {
    const blocked = vi.fn();
    const base = "alpha beta gamma";
    const state = EditorState.create({
      doc: base,
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        createVisualEditing({ requestSource() {}, onBlocked: blocked }),
      ],
    });
    const tr = state.update({
      changes: [
        { from: 5, insert: "%" },
        { from: 10, insert: "&" },
      ],
      selection: EditorSelection.create([
        EditorSelection.cursor(6),
        EditorSelection.cursor(12),
      ]),
      annotations: Transaction.userEvent.of("input.type"),
    });
    expect(tr.newDoc.toString()).toBe("alpha\\% beta\\& gamma");
    expect(tr.newSelection.ranges.map((r) => r.head)).toEqual([7, 14]);
  });
  it("read-only refuses input but accepts explicit source synchronization", () => {
    const e = editor("Plain prose", true);
    e.change(0, 1, "X");
    expect(e.state.doc.toString()).toBe("Plain prose");
    e.dispatch(
      e.state.update({
        changes: { from: 0, to: 5, insert: "Remote" },
        annotations: visualSourceTransaction.of("external"),
      }),
    );
    expect(e.state.doc.toString()).toBe("Remote prose");
  });
});
