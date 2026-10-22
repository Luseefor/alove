import {
  Annotation,
  EditorSelection,
  EditorState,
  StateField,
  Transaction,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  keymap,
  type DecorationSet,
} from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { parseVisualDocument, type VisualDocument } from "./visualDocument";

/** Only programmatic source synchronization and validated formatting use this seam. */
export const visualSourceTransaction = Annotation.define<
  "external" | "format"
>();
export type VisualFormat =
  | "bold"
  | "italic"
  | "paragraph"
  | "section"
  | "subsection"
  | "subsubsection"
  | "bulletList"
  | "numberedList";
export const visualDocumentField = StateField.define<VisualDocument>({
  create: (state) => parseVisualDocument(state.doc.toString()),
  update: (value, tr) =>
    tr.docChanged ? parseVisualDocument(tr.newDoc.toString()) : value,
});

export function escapeVisualText(text: string): string {
  return text.replace(
    /[\\%&#_${}~^]/g,
    (char) =>
      ({
        "\\": "\\textbackslash{}",
        "~": "\\textasciitilde{}",
        "^": "\\textasciicircum{}",
      })[char] ?? `\\${char}`,
  );
}

function allowedRange(
  model: VisualDocument,
  from: number,
  to: number,
): boolean {
  if (model.limited || from < model.body.from || to > model.body.to)
    return false;
  return !model.protected.some((range) => {
    if (from === to) {
      if (from < range.from || from > range.to) return false;
      if (from > range.from && from < range.to) return true;
      // At an unknown command's boundary, appending letters can rename the
      // command (\\custom + x => \\customx). Only known wrappers/literals have
      // safe editable boundaries; custom syntax stays a Source operation.
      return ![...model.hidden, ...model.literals].some(
        (known) => known.from <= range.from && known.to >= range.to,
      );
    }
    if (from >= range.to || to <= range.from) return false;
    return !model.literals.some(
      (literal) =>
        literal.from <= range.from &&
        literal.to >= range.to &&
        from <= literal.from &&
        to >= literal.to,
    );
  });
}

/** A range-based edit; the source around it is never regenerated. */
export function formatVisualSelection(
  view: EditorView,
  kind: VisualFormat,
  reject: (message: string) => void = () => {},
): boolean {
  if (view.state.readOnly) return false;
  const model = view.state.field(visualDocumentField, false);
  if (!model) return false;
  const range = view.state.selection.main;
  let from = range.from,
    to = range.to;
  let insert: string;
  let anchor: number, head: number;
  const source = view.state.doc.toString();
  if (kind === "bold" || kind === "italic") {
    if (from === to || !allowedRange(model, from, to)) {
      reject("Select editable text to format. Use Source for custom LaTeX.");
      return false;
    }
    const prefix = kind === "bold" ? "\\textbf{" : "\\textit{";
    insert = prefix + source.slice(from, to) + "}";
    anchor = from + prefix.length;
    head = anchor + to - from;
  } else if (kind === "bulletList" || kind === "numberedList") {
    from = view.state.doc.lineAt(from).from;
    to = view.state.doc.lineAt(
      to > from && source[to - 1] === "\n" ? to - 1 : to,
    ).to;
    if (!allowedRange(model, from, to) || !source.slice(from, to).trim()) {
      reject("Select plain body paragraphs to turn into a list.");
      return false;
    }
    const env = kind === "bulletList" ? "itemize" : "enumerate";
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    const text = source.slice(from, to);
    const trailingCR = text.endsWith("\r") ? "\r" : "";
    insert =
      `\\begin{${env}}${eol}` +
      text
        .replace(/\r$/, "")
        .split(/\r?\n/)
        .map((line) => (line.trim() ? `\\item ${line}` : line))
        .join(eol) +
      `${eol}\\end{${env}}${trailingCR}`;
    anchor = from + `\\begin{${env}}${eol}\\item `.length;
    head = anchor;
  } else {
    const line = view.state.doc.lineAt(from);
    if (to > line.to) {
      reject("Choose one paragraph or heading at a time.");
      return false;
    }
    from = line.from;
    to = line.to;
    const existing =
      /^(\\(?:section|subsection|subsubsection)\*?\{)(.*)\}(\r?)$/.exec(
        line.text,
      );
    const textFrom = existing ? from + existing[1]!.length : from;
    const textTo = existing
      ? to - existing[3]!.length - 1
      : to - (line.text.endsWith("\r") ? 1 : 0);
    // Known heading wrappers are replaced explicitly; only their argument is inspected.
    if (!allowedRange(model, textFrom, textTo) || textFrom === textTo) {
      reject(
        "Choose a plain body paragraph or heading. Use Source for custom LaTeX.",
      );
      return false;
    }
    const text = source.slice(textFrom, textTo);
    const prefix = kind === "paragraph" ? "" : `\\${kind}{`;
    insert =
      prefix +
      text +
      (kind === "paragraph" ? "" : "}") +
      (line.text.endsWith("\r") ? "\r" : "");
    anchor = from + prefix.length;
    head = anchor + text.length;
  }
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor, head },
    annotations: [
      visualSourceTransaction.of("format"),
      Transaction.userEvent.of("input.format"),
      isolateHistory.of("full"),
    ],
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

class LiteralWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: LiteralWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.textContent = this.text;
    return span;
  }
}
class SetupWidget extends WidgetType {
  constructor(readonly requestSource: () => void) {
    super();
  }
  eq(other: SetupWidget) {
    return other.requestSource === this.requestSource;
  }
  toDOM() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-visual-setup";
    button.textContent = "Document setup · Edit source";
    button.setAttribute("aria-label", "Edit document setup in Source");
    button.addEventListener("click", this.requestSource);
    return button;
  }
  ignoreEvent() {
    return false;
  }
}

function decorations(
  state: EditorState,
  requestSource: () => void,
  opaque: readonly { from: number; to: number }[] = [],
): DecorationSet {
  const model = state.field(visualDocumentField);
  const covers = (
    ranges: readonly { from: number; to: number }[],
    from: number,
    to: number,
  ) => {
    let lo = 0,
      hi = ranges.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (ranges[mid]!.from <= from) lo = mid + 1;
      else hi = mid;
    }
    return lo > 0 && ranges[lo - 1]!.to >= to;
  };
  const carriageReturns = [...state.doc.toString().matchAll(/\r(?=\n|$)/g)]
    .filter(
      (match) =>
        !covers(model.hidden, match.index, match.index + 1) &&
        !covers(opaque, match.index, match.index + 1),
    )
    .map((match) => Decoration.replace({}).range(match.index, match.index + 1));
  const ranges = [
    ...carriageReturns,
    ...model.hidden.map(({ from, to }) =>
      Decoration.replace({
        ...(from === 0 && to === model.body.from
          ? { widget: new SetupWidget(requestSource) }
          : {}),
      }).range(from, to),
    ),
    ...model.items.map(({ from, to, text }) =>
      Decoration.replace({ widget: new LiteralWidget(text) }).range(from, to),
    ),
    ...model.literals.map(({ from, to, text }) =>
      Decoration.replace({ widget: new LiteralWidget(text) }).range(from, to),
    ),
    ...model.marks
      .filter((mark) => mark.from < mark.to)
      .map(({ from, to, kind }) =>
        Decoration.mark({ class: `cm-visual-${kind}` }).range(from, to),
      ),
    ...model.headings.map(({ from, level }) =>
      Decoration.line({ class: `cm-visual-heading cm-visual-h${level}` }).range(
        from,
      ),
    ),
    ...model.protected
      .filter(
        ({ from, to }) =>
          from < to &&
          !covers(model.hidden, from, to) &&
          !covers(model.literals, from, to) &&
          !covers(model.items, from, to),
      )
      .map(({ from, to }) =>
        Decoration.mark({
          class: "cm-visual-source",
          attributes: { title: "Custom LaTeX · edit in Source" },
        }).range(from, to),
      ),
  ];
  return Decoration.set(ranges, true);
}

export function createVisualEditing(options: {
  requestSource: () => void;
  onBlocked: (message: string) => void;
  opaqueRanges?: (source: string) => readonly { from: number; to: number }[];
}): Extension {
  const rendered = StateField.define<DecorationSet>({
    create: (state) =>
      decorations(
        state,
        options.requestSource,
        options.opaqueRanges?.(state.doc.toString()),
      ),
    update: (value, tr) =>
      tr.docChanged
        ? decorations(
            tr.state,
            options.requestSource,
            options.opaqueRanges?.(tr.newDoc.toString()),
          )
        : value,
    provide: (field) => [
      EditorView.decorations.from(field),
      EditorView.atomicRanges.of((view) => {
        const model = view.state.field(visualDocumentField);
        return Decoration.set(
          [...model.hidden, ...model.literals, ...model.items].map(
            ({ from, to }) => Decoration.replace({}).range(from, to),
          ),
          true,
        );
      }),
    ],
  });
  return [
    visualDocumentField,
    rendered,
    EditorView.lineWrapping,
    EditorState.transactionFilter.of((tr) => {
      if (
        !tr.docChanged ||
        tr.annotation(visualSourceTransaction) === "external"
      )
        return tr;
      if (tr.startState.readOnly) return [];
      if (tr.isUserEvent("undo") || tr.isUserEvent("redo")) return tr;
      // Formatting commands already validate the argument and intentionally change wrappers.
      if (tr.annotation(visualSourceTransaction) === "format") return tr;
      const model = tr.startState.field(visualDocumentField);
      let blocked = false,
        escaped = false;
      const source = tr.startState.doc.toString();
      const caretChanges: {
        fromB: number;
        toB: number;
        from: number;
        length: number;
      }[] = [];
      const changes: { from: number; to: number; insert: string }[] = [];
      tr.changes.iterChanges(
        (originalFrom, originalTo, fromB, toB, inserted) => {
          let from = originalFrom,
            to = originalTo;
          const raw = inserted.toString();
          // CR remains canonical data, but the visual caret sits before that invisible line ending.
          if (
            from === to &&
            source[from - 1] === "\r" &&
            (source[from] === "\n" || from === source.length)
          ) {
            from--;
            to--;
          }
          if (
            !raw &&
            tr.isUserEvent("delete.backward") &&
            to === from + 1 &&
            source[from] === "\r" &&
            from > 0
          ) {
            to = from;
            from--;
          }
          if (!allowedRange(model, from, to)) blocked = true;
          let insert = tr.isUserEvent("input") ? escapeVisualText(raw) : raw;
          if (tr.isUserEvent("input") && source.includes("\r\n"))
            insert = insert.replace(/\r?\n/g, "\r\n");
          if (insert !== raw || from !== originalFrom || to !== originalTo)
            escaped = true;
          changes.push({ from, to, insert });
          caretChanges.push({ fromB, toB, from, length: insert.length });
        },
      );
      if (blocked) {
        options.onBlocked(
          "That edit crosses LaTeX structure. Switch to Source to edit it.",
        );
        return [];
      }
      if (!escaped) return tr;
      const mapped = tr.startState.changes(changes);
      const inverse = tr.changes.invertedDesc;
      const selection = EditorSelection.create(
        tr.newSelection.ranges.map((range) => {
          const edit =
            range.empty &&
            caretChanges.find(
              (change) =>
                range.head >= change.fromB && range.head <= change.toB,
            );
          if (edit)
            return EditorSelection.cursor(
              mapped.mapPos(edit.from, -1) + edit.length,
            );
          return EditorSelection.range(
            mapped.mapPos(inverse.mapPos(range.anchor, 1), 1),
            mapped.mapPos(inverse.mapPos(range.head, 1), 1),
          );
        }),
        tr.newSelection.mainIndex,
      );
      return {
        changes: mapped,
        selection,
        scrollIntoView: tr.scrollIntoView,
        annotations: [
          Transaction.userEvent.of(
            tr.annotation(Transaction.userEvent) ?? "input",
          ),
        ],
      };
    }),
    keymap.of([
      {
        key: "Mod-b",
        run: (view) => {
          formatVisualSelection(view, "bold", options.onBlocked);
          return true;
        },
      },
      {
        key: "Mod-i",
        run: (view) => {
          formatVisualSelection(view, "italic", options.onBlocked);
          return true;
        },
      },
    ]),
    EditorView.theme({
      "&": {
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: "18px",
      },
      ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.8" },
      ".cm-content": {
        maxWidth: "760px",
        margin: "0 auto",
        padding: "32px 28px 120px",
        flexGrow: "1",
      },
      ".cm-line": { padding: "0" },
      ".cm-line span": { color: "inherit" },
      ".cm-activeLine": { backgroundColor: "transparent" },
      ".cm-gutters": { display: "none" },
      ".cm-visual-bold": { fontWeight: "700" },
      ".cm-visual-italic": { fontStyle: "italic" },
      ".cm-visual-heading": {
        fontFamily: "system-ui, sans-serif",
        fontWeight: "650",
        lineHeight: "1.4",
        paddingTop: "20px",
        paddingBottom: "8px",
      },
      ".cm-visual-h1": { fontSize: "1.7em" },
      ".cm-visual-h2": { fontSize: "1.35em" },
      ".cm-visual-h3": { fontSize: "1.12em" },
      ".cm-visual-source": {
        fontFamily: "monospace",
        fontSize: ".8em",
        backgroundColor: "var(--muted)",
        color: "var(--muted-foreground)",
      },
      ".cm-visual-setup": {
        fontFamily: "system-ui, sans-serif",
        fontSize: "12px",
        color: "var(--muted-foreground)",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        padding: "4px 10px",
        marginBottom: "20px",
        cursor: "pointer",
      },
      ".cm-visual-setup:focus-visible": { outline: "2px solid var(--ring)" },
      "@media(max-width: 600px)": {
        ".cm-content": { padding: "20px 18px 80px" },
        "&": { fontSize: "17px" },
      },
    }),
  ];
}

export function canEditVisualRange(
  source: string,
  from: number,
  to = from,
): boolean {
  const model = parseVisualDocument(source);
  return (
    model.body.from < model.body.to &&
    Number.isInteger(from) &&
    Number.isInteger(to) &&
    from >= 0 &&
    to >= from &&
    to <= source.length &&
    allowedRange(model, from, to)
  );
}
/** Apply a caller-validated object transaction without replacing the editor/history. */
export function applyGuardedVisualPatches(
  view: EditorView,
  expectedSource: string,
  patches: readonly { from: number; to: number; insert: string }[],
): boolean {
  if (
    view.state.readOnly ||
    view.state.doc.toString() !== expectedSource ||
    patches.length > 500
  )
    return false;
  const sorted = [...patches].sort((a, b) => a.from - b.from || a.to - b.to);
  let last = 0;
  for (const patch of sorted) {
    if (
      !Number.isInteger(patch.from) ||
      !Number.isInteger(patch.to) ||
      patch.from < last ||
      patch.to < patch.from ||
      patch.to > expectedSource.length ||
      typeof patch.insert !== "string"
    )
      return false;
    last = patch.to;
  }
  if (!sorted.length) return true;
  view.dispatch({
    changes: sorted,
    annotations: [
      visualSourceTransaction.of("format"),
      Transaction.userEvent.of("input.visual-object"),
      isolateHistory.of("full"),
    ],
  });
  view.focus();
  return true;
}
