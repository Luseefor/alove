import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView, getDrawSelectionConfig, keymap } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { historyField } from "@alove/editor";
import {
  LatexCodeEditor,
  MAX_RETAINED_EDITOR_STATES,
  type LatexCodeEditorHandle,
} from "@/components/latex-ide/LatexCodeEditor";

// jsdom lacks Range geometry; CodeMirror measures layout on scroll/selection.
// Polyfill here (not global setup) so focused editor tests don't emit
// unhandled getClientRects errors.
{
  const rangeProto = (globalThis as unknown as { Range?: { prototype: Range } })
    .Range?.prototype;
  if (rangeProto && typeof rangeProto.getClientRects !== "function") {
    rangeProto.getClientRects = () => [] as unknown as DOMRectList;
  }
  if (rangeProto && typeof rangeProto.getBoundingClientRect !== "function") {
    rangeProto.getBoundingClientRect = () =>
      ({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        toJSON: () => ({}),
      }) as unknown as DOMRect;
  }
}

describe("LatexCodeEditor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    document.documentElement.classList.remove("dark");
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function host(): HTMLElement {
    const el = container.querySelector(
      '[data-testid="latex-editor-codemirror"]',
    );
    if (!el || !(el instanceof HTMLElement)) {
      throw new Error("editor host not found");
    }
    return el;
  }

  function content(): HTMLElement | null {
    return container.querySelector(
      '[data-testid="latex-editor-codemirror-content"]',
    );
  }

  it("switches source/visual without changing bytes or recreating the view, with shared formatting undo", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();
    let current =
      "\\documentclass{article}\n\\begin{document}\n\\section{Intro}\nPlain prose.\n% keep me\n\\end{document}";
    const original = current;
    function render(presentation: "source" | "visual") {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={current}
          presentation={presentation}
          onChange={(next) => {
            current = next;
            onChange(next);
          }}
        />,
      );
    }
    act(() => render("source"));
    const view = EditorView.findFromDOM(host().querySelector(".cm-editor")!)!;
    const from = current.indexOf("Plain prose");
    act(() => ref.current!.setSelection(from, from + 5));
    act(() => render("visual"));
    expect(EditorView.findFromDOM(host().querySelector(".cm-editor")!)).toBe(
      view,
    );
    expect(ref.current!.getSelection()).toEqual({ start: from, end: from + 5 });
    expect(onChange).not.toHaveBeenCalled();
    expect(ref.current!.getValue()).toBe(original);
    act(() => ref.current!.format("bold"));
    expect(current).toBe(original.replace("Plain", "\\textbf{Plain}"));
    act(() => render("source"));
    act(() => ref.current!.runCommand("undo"));
    expect(current).toBe(original);
    act(() => render("visual"));
    act(() => ref.current!.runCommand("redo"));
    expect(current).toBe(original.replace("Plain", "\\textbf{Plain}"));
  });

  it("changes a heading without changing adjacent source and refuses formatting setup", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    let current =
      "\\documentclass{article}\n\\begin{document}\nA heading\nBody text.\n\\end{document}";
    const original = current;
    const blocked = vi.fn();
    act(() =>
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={current}
          presentation="visual"
          onChange={(next) => {
            current = next;
          }}
          onVisualBlocked={blocked}
        />,
      ),
    );
    const at = current.indexOf("A heading");
    act(() => ref.current!.setSelection(at, at));
    act(() => ref.current!.format("section"));
    expect(current).toBe(original.replace("A heading", "\\section{A heading}"));
    act(() => ref.current!.format("subsection"));
    expect(current).toBe(
      original.replace("A heading", "\\subsection{A heading}"),
    );
    act(() => ref.current!.format("paragraph"));
    expect(current).toBe(original);
    act(() => ref.current!.setSelection(2, 4));
    act(() => ref.current!.format("bold"));
    expect(current).toBe(original);
    expect(blocked).toHaveBeenCalled();
  });

  it("creates visual lists as one exact source edit and undoes across modes", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    let current = "Before.\r\nFirst item.\r\nSecond item.\r\nAfter.";
    const original = current;
    const render = (presentation: "source" | "visual") =>
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={current}
          presentation={presentation}
          onChange={(next) => {
            current = next;
          }}
        />,
      );
    act(() => render("visual"));
    act(() =>
      ref.current!.setSelection(
        current.indexOf("First"),
        current.indexOf("After") - 2,
      ),
    );
    act(() => ref.current!.format("numberedList"));
    expect(current).toBe(
      "Before.\r\n\\begin{enumerate}\r\n\\item First item.\r\n\\item Second item.\r\n\\end{enumerate}\r\nAfter.",
    );
    expect(content()?.textContent).toContain("1.");
    expect(content()?.textContent).toContain("2.");
    act(() => render("source"));
    act(() => ref.current!.runCommand("undo"));
    expect(current).toBe(original);
  });

  it("routes navigation to hidden setup into Source without changing the document", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const requestSource = vi.fn();
    const onChange = vi.fn();
    const source =
      "\\documentclass{article}\n\\begin{document}\nBody prose.\n\\end{document}";
    act(() =>
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={source}
          presentation="visual"
          onChange={onChange}
          onRequestSource={requestSource}
        />,
      ),
    );
    act(() => ref.current!.setSelection(2, 8));
    expect(requestSource).toHaveBeenCalledOnce();
    expect(ref.current!.getSelection()).toEqual({ start: 2, end: 8 });
    expect(ref.current!.getValue()).toBe(source);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("renders with initial value", () => {
    const ref = createRef<LatexCodeEditorHandle>();

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={"\\section{Intro}"}
          onChange={() => {}}
          aria-label="latex editor"
        />,
      );
    });

    expect(ref.current?.getValue()).toBe("\\section{Intro}");
  });

  it("calls onChange when edited through adapter handle", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={"abc"}
          onChange={onChange}
          aria-label="latex editor"
        />,
      );
    });

    act(() => {
      ref.current?.replaceRange(0, 3, "xyz");
    });

    expect(onChange).toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith("xyz");
  });

  it("applies external value sync without onChange and keeps user edits reporting", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={"server v1"}
          onChange={onChange}
          aria-label="latex editor"
        />,
      );
    });

    const domBefore = host().firstChild;
    expect(domBefore).not.toBeNull();
    expect(ref.current?.getValue()).toBe("server v1");

    act(() => {
      ref.current?.replaceRange(0, 9, "user edit");
    });
    expect(ref.current?.getValue()).toBe("user edit");
    expect(onChange).toHaveBeenLastCalledWith("user edit");
    const callsAfterUserEdit = onChange.mock.calls.length;

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={"server v2 - cloud refetch"}
          onChange={onChange}
          aria-label="latex editor"
        />,
      );
    });

    expect(host().firstChild).toBe(domBefore);
    expect(ref.current?.getValue()).toBe("server v2 - cloud refetch");
    expect(onChange.mock.calls.length).toBe(callsAfterUserEdit);

    act(() => {
      ref.current?.replaceRange(0, 6, "USER");
    });
    expect(ref.current?.getValue()).toBe("USER v2 - cloud refetch");
    expect(onChange).toHaveBeenLastCalledWith("USER v2 - cloud refetch");
    expect(onChange.mock.calls.length).toBe(callsAfterUserEdit + 1);
    expect(host().firstChild).toBe(domBefore);

    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("server v2 - cloud refetch");
    expect(host().firstChild).toBe(domBefore);
  });

  it("preserves same view, selection, text and undo across settings changes", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={"hello world"}
          onChange={onChange}
          aria-label="latex editor"
          wordWrap={true}
          spellCheck={false}
          readOnly={false}
          autoCloseBrackets={true}
          keybindings="none"
        />,
      );
    });

    const hostEl = host();
    const domBefore = hostEl.firstChild;
    expect(domBefore).not.toBeNull();
    expect(ref.current?.getValue()).toBe("hello world");

    act(() => {
      ref.current?.setSelection(1, 4);
    });
    expect(ref.current?.getSelection()).toEqual({ start: 1, end: 4 });

    act(() => {
      ref.current?.replaceRange(0, 5, "HELLO");
    });
    expect(ref.current?.getValue()).toBe("HELLO world");
    expect(onChange).toHaveBeenLastCalledWith("HELLO world");
    const callsAfterEdit = onChange.mock.calls.length;
    const selectionAfterEdit = ref.current?.getSelection();
    expect(selectionAfterEdit).toEqual({ start: 5, end: 5 });

    const currentValue = ref.current?.getValue() ?? "";

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={currentValue}
          onChange={onChange}
          aria-label="updated label"
          wordWrap={false}
          spellCheck={true}
          readOnly={false}
          autoCloseBrackets={false}
          keybindings="none"
        />,
      );
    });

    expect(host().firstChild).toBe(domBefore);
    expect(ref.current?.getValue()).toBe("HELLO world");
    expect(ref.current?.getSelection()).toEqual(selectionAfterEdit);
    expect(onChange.mock.calls.length).toBe(callsAfterEdit);
    expect(content()?.getAttribute("aria-label")).toBe("updated label");
    expect(content()?.getAttribute("spellcheck")).toBe("true");

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={ref.current?.getValue() ?? ""}
          onChange={onChange}
          aria-label="updated label 2"
          wordWrap={true}
          spellCheck={false}
          readOnly={false}
          autoCloseBrackets={true}
          keybindings="none"
        />,
      );
    });

    expect(host().firstChild).toBe(domBefore);
    expect(ref.current?.getValue()).toBe("HELLO world");
    expect(onChange.mock.calls.length).toBe(callsAfterEdit);

    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("hello world");

    act(() => {
      ref.current?.runCommand("redo");
    });
    expect(ref.current?.getValue()).toBe("HELLO world");
    expect(host().firstChild).toBe(domBefore);
  });

  it("keeps readOnly/keybindings/aria reconfig without resetting text or history", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={"abc"}
          onChange={onChange}
          aria-label="latex editor"
          readOnly={false}
          keybindings="none"
        />,
      );
    });

    const domBefore = host().firstChild;
    act(() => {
      ref.current?.replaceRange(0, 3, "abcd");
    });
    expect(ref.current?.getValue()).toBe("abcd");
    const callsAfterEdit = onChange.mock.calls.length;

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={ref.current?.getValue() ?? ""}
          onChange={onChange}
          aria-label="aria changed"
          readOnly={true}
          keybindings="vim"
        />,
      );
    });

    expect(host().firstChild).toBe(domBefore);
    expect(ref.current?.getValue()).toBe("abcd");
    expect(onChange.mock.calls.length).toBe(callsAfterEdit);
    expect(content()?.getAttribute("aria-label")).toBe("aria changed");
    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("abcd");
    act(() =>
      root.render(
        <LatexCodeEditor
          ref={ref}
          value="abcd"
          onChange={onChange}
          readOnly={false}
          aria-label="aria changed"
        />,
      ),
    );
    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("abc");
  });

  it("follows root .dark class without resetting doc, selection, history or firing onChange", async () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={"abc"}
          onChange={onChange}
          aria-label="latex editor"
        />,
      );
    });

    const domBefore = host().firstChild;
    expect(domBefore).not.toBeNull();
    const view = EditorView.findFromDOM(
      host().querySelector(".cm-editor") as HTMLElement,
    )!;
    expect(view.state.facet(EditorView.darkTheme)).toBe(false);

    act(() => {
      ref.current?.replaceRange(0, 3, "abcd");
    });
    act(() => {
      ref.current?.setSelection(1, 2);
    });
    expect(ref.current?.getValue()).toBe("abcd");
    const selectionBefore = ref.current?.getSelection();
    const callsAfterEdit = onChange.mock.calls.length;

    await act(async () => {
      document.documentElement.classList.add("dark");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(view.state.facet(EditorView.darkTheme)).toBe(true);
    expect(host().firstChild).toBe(domBefore);
    expect(ref.current?.getValue()).toBe("abcd");
    expect(ref.current?.getSelection()).toEqual(selectionBefore);
    expect(onChange.mock.calls.length).toBe(callsAfterEdit);

    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("abc");

    await act(async () => {
      document.documentElement.classList.remove("dark");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(view.state.facet(EditorView.darkTheme)).toBe(false);
    expect(host().firstChild).toBe(domBefore);
    expect(ref.current?.getValue()).toBe("abc");

    act(() => {
      ref.current?.runCommand("redo");
    });
    expect(ref.current?.getValue()).toBe("abcd");
    expect(host().firstChild).toBe(domBefore);
    expect(onChange.mock.calls.length).toBeGreaterThan(callsAfterEdit);
  });

  it("destroys the view on unmount and disconnects theme observation", async () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={"hello"}
          onChange={onChange}
          aria-label="latex editor"
        />,
      );
    });

    expect(host().firstChild).not.toBeNull();
    expect(ref.current?.getValue()).toBe("hello");
    const callsBeforeUnmount = onChange.mock.calls.length;

    act(() => {
      root.unmount();
    });

    expect(
      container.querySelector('[data-testid="latex-editor-codemirror"]'),
    ).toBeNull();

    await act(async () => {
      document.documentElement.classList.add("dark");
      await new Promise((resolve) => setTimeout(resolve, 20));
      document.documentElement.classList.remove("dark");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(onChange.mock.calls.length).toBe(callsBeforeUnmount);
  });

  function findView(): EditorView {
    const view = EditorView.findFromDOM(
      host().querySelector(".cm-editor") as HTMLElement,
    );
    if (!view) throw new Error("editor view not found");
    return view;
  }

  function hasKey(view: EditorView, key: string): boolean {
    const target = key.toLowerCase();
    return view.state
      .facet(keymap)
      .some((bindings) =>
        bindings.some(
          (b) => typeof b.key === "string" && b.key.toLowerCase() === target,
        ),
      );
  }

  it("toggles autocomplete via settings without resetting view, selection, or history", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={"hello world"}
          onChange={onChange}
          aria-label="latex editor"
          autocompleteEnabled={true}
        />,
      );
    });

    const domBefore = host().firstChild;
    expect(domBefore).not.toBeNull();
    expect(hasKey(findView(), "Ctrl-Space")).toBe(true);

    act(() => {
      ref.current?.setSelection(1, 4);
    });
    act(() => {
      ref.current?.replaceRange(0, 5, "HELLO");
    });
    expect(ref.current?.getValue()).toBe("HELLO world");
    const callsAfterEdit = onChange.mock.calls.length;
    const selectionAfterEdit = ref.current?.getSelection();

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={ref.current?.getValue() ?? ""}
          onChange={onChange}
          aria-label="latex editor"
          autocompleteEnabled={false}
        />,
      );
    });

    const viewDisabled = findView();
    expect(host().firstChild).toBe(domBefore);
    expect(ref.current?.getValue()).toBe("HELLO world");
    expect(ref.current?.getSelection()).toEqual(selectionAfterEdit);
    expect(onChange.mock.calls.length).toBe(callsAfterEdit);
    expect(hasKey(viewDisabled, "Ctrl-Space")).toBe(false);

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={ref.current?.getValue() ?? ""}
          onChange={onChange}
          aria-label="latex editor"
          autocompleteEnabled={true}
        />,
      );
    });

    expect(host().firstChild).toBe(domBefore);
    expect(hasKey(findView(), "Ctrl-Space")).toBe(true);
    expect(onChange.mock.calls.length).toBe(callsAfterEdit);

    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("hello world");
    expect(host().firstChild).toBe(domBefore);
  });

  it("defaults autocomplete to enabled when prop omitted", () => {
    const ref = createRef<LatexCodeEditorHandle>();

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={"abc"}
          onChange={() => {}}
          aria-label="latex editor"
        />,
      );
    });

    expect(hasKey(findView(), "Ctrl-Space")).toBe(true);
  });

  it("enables emacs motion via settings and runs Ctrl-a without resetting view", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={"hello world"}
          onChange={onChange}
          aria-label="latex editor"
          keybindings="none"
        />,
      );
    });

    const domBefore = host().firstChild;
    expect(domBefore).not.toBeNull();
    expect(hasKey(findView(), "Ctrl-a")).toBe(false);

    act(() => {
      ref.current?.replaceRange(0, 11, "hello world!");
    });
    const callsAfterEdit = onChange.mock.calls.length;

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={ref.current?.getValue() ?? ""}
          onChange={onChange}
          aria-label="latex editor"
          keybindings="emacs"
        />,
      );
    });

    const view = findView();
    expect(host().firstChild).toBe(domBefore);
    expect(onChange.mock.calls.length).toBe(callsAfterEdit);
    expect(hasKey(view, "Ctrl-a")).toBe(true);

    const bindings = view.state.facet(keymap).flat();
    const ctrlA = bindings.find(
      (b) => typeof b.key === "string" && b.key.toLowerCase() === "ctrl-a",
    );
    expect(ctrlA?.run).toBeDefined();

    act(() => {
      ref.current?.setSelection(5, 5);
    });
    expect(ref.current?.getSelection()).toEqual({ start: 5, end: 5 });

    act(() => {
      ctrlA?.run?.(view);
    });
    expect(ref.current?.getSelection()).toEqual({ start: 0, end: 0 });

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={ref.current?.getValue() ?? ""}
          onChange={onChange}
          aria-label="latex editor"
          keybindings="none"
        />,
      );
    });

    expect(host().firstChild).toBe(domBefore);
    expect(hasKey(findView(), "Ctrl-a")).toBe(false);
    expect(onChange.mock.calls.length).toBe(callsAfterEdit);

    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("hello world");
  });

  it("applies non-blinking cursor via drawSelection config without resetting view", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={"hello world"}
          onChange={onChange}
          aria-label="latex editor"
          nonBlinkingCursor={false}
        />,
      );
    });

    const domBefore = host().firstChild;
    expect(getDrawSelectionConfig(findView().state).cursorBlinkRate).not.toBe(
      0,
    );

    act(() => {
      ref.current?.setSelection(1, 4);
    });
    act(() => {
      ref.current?.replaceRange(0, 5, "HELLO");
    });
    const callsAfterEdit = onChange.mock.calls.length;
    const selectionAfterEdit = ref.current?.getSelection();

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={ref.current?.getValue() ?? ""}
          onChange={onChange}
          aria-label="latex editor"
          nonBlinkingCursor={true}
        />,
      );
    });

    expect(host().firstChild).toBe(domBefore);
    expect(ref.current?.getValue()).toBe("HELLO world");
    expect(ref.current?.getSelection()).toEqual(selectionAfterEdit);
    expect(onChange.mock.calls.length).toBe(callsAfterEdit);
    expect(getDrawSelectionConfig(findView().state).cursorBlinkRate).toBe(0);

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={ref.current?.getValue() ?? ""}
          onChange={onChange}
          aria-label="latex editor"
          nonBlinkingCursor={false}
        />,
      );
    });

    expect(host().firstChild).toBe(domBefore);
    expect(getDrawSelectionConfig(findView().state).cursorBlinkRate).not.toBe(
      0,
    );
    expect(onChange.mock.calls.length).toBe(callsAfterEdit);

    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("hello world");
  });

  it("records controlled snippet insertion for toolbar undo when recordExternalChanges true", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={"abc"}
          onChange={onChange}
          aria-label="latex editor"
          recordExternalChanges={true}
        />,
      );
    });

    expect(ref.current?.getValue()).toBe("abc");
    expect(findView().state.field(historyField, false)).toBeTruthy();

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={"abc\\section{}"}
          onChange={onChange}
          aria-label="latex editor"
          recordExternalChanges={true}
        />,
      );
    });

    expect(ref.current?.getValue()).toBe("abc\\section{}");
    expect(onChange).not.toHaveBeenCalled();

    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("abc");
  });

  it("does not record external server sync when recordExternalChanges false", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={"hello"}
          onChange={onChange}
          aria-label="latex editor"
          recordExternalChanges={false}
        />,
      );
    });

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={"hello world"}
          onChange={onChange}
          aria-label="latex editor"
          recordExternalChanges={false}
        />,
      );
    });

    expect(ref.current?.getValue()).toBe("hello world");
    expect(onChange).not.toHaveBeenCalled();
    expect(findView().state.field(historyField, false)).toBeTruthy();

    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("hello world");
  });

  it("retains undo and selection across remount with same historyKey", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();
    const cache = new Map<string, EditorState>();

    act(() => {
      root.render(
        <LatexCodeEditor
          key="proj:fileA"
          ref={ref}
          value={"abc"}
          onChange={onChange}
          aria-label="latex editor"
          historyCache={cache}
          historyKey="fileA"
        />,
      );
    });

    act(() => {
      ref.current?.replaceRange(3, 3, "d");
    });
    expect(ref.current?.getValue()).toBe("abcd");
    act(() => {
      ref.current?.setSelection(1, 2);
    });
    const savedSelection = ref.current?.getSelection();
    expect(cache.size).toBe(0);

    act(() => {
      root.render(
        <LatexCodeEditor
          key="proj:fileB"
          ref={ref}
          value={"xyz"}
          onChange={onChange}
          aria-label="latex editor"
          historyCache={cache}
          historyKey="fileB"
        />,
      );
    });

    expect(cache.get("fileA")?.doc.toString()).toBe("abcd");
    expect(ref.current?.getValue()).toBe("xyz");

    act(() => {
      root.render(
        <LatexCodeEditor
          key="proj:fileA"
          ref={ref}
          value={"abcd"}
          onChange={onChange}
          aria-label="latex editor"
          historyCache={cache}
          historyKey="fileA"
        />,
      );
    });

    expect(ref.current?.getValue()).toBe("abcd");
    expect(ref.current?.getSelection()).toEqual(savedSelection);
    expect(findView().state.field(historyField, false)).toBeTruthy();

    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("abc");
  });

  it("isolates history across different historyKeys and discards on doc mismatch", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();
    const cache = new Map<string, EditorState>();

    act(() => {
      root.render(
        <LatexCodeEditor
          key="proj:fileA"
          ref={ref}
          value={"aaa"}
          onChange={onChange}
          aria-label="latex editor"
          historyCache={cache}
          historyKey="fileA"
        />,
      );
    });
    act(() => {
      ref.current?.replaceRange(3, 3, "1");
    });
    expect(ref.current?.getValue()).toBe("aaa1");

    act(() => {
      root.render(
        <LatexCodeEditor
          key="proj:fileB"
          ref={ref}
          value={"bbb"}
          onChange={onChange}
          aria-label="latex editor"
          historyCache={cache}
          historyKey="fileB"
        />,
      );
    });
    expect(ref.current?.getValue()).toBe("bbb");
    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("bbb");

    act(() => {
      root.render(
        <LatexCodeEditor
          key="proj:fileA-mismatch"
          ref={ref}
          value={"RESET-DIFFERENT"}
          onChange={onChange}
          aria-label="latex editor"
          historyCache={cache}
          historyKey="fileA"
        />,
      );
    });

    expect(ref.current?.getValue()).toBe("RESET-DIFFERENT");
    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("RESET-DIFFERENT");
  });

  it("retains redo across remount with same historyKey", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();
    const cache = new Map<string, EditorState>();

    act(() => {
      root.render(
        <LatexCodeEditor
          key="proj:fileA"
          ref={ref}
          value={"abc"}
          onChange={onChange}
          aria-label="latex editor"
          historyCache={cache}
          historyKey="fileA"
        />,
      );
    });
    act(() => {
      ref.current?.replaceRange(3, 3, "d");
    });
    expect(ref.current?.getValue()).toBe("abcd");
    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("abc");

    act(() => {
      root.render(
        <LatexCodeEditor
          key="proj:fileB"
          ref={ref}
          value={"xyz"}
          onChange={onChange}
          aria-label="latex editor"
          historyCache={cache}
          historyKey="fileB"
        />,
      );
    });
    expect(ref.current?.getValue()).toBe("xyz");

    act(() => {
      root.render(
        <LatexCodeEditor
          key="proj:fileA"
          ref={ref}
          value={"abc"}
          onChange={onChange}
          aria-label="latex editor"
          historyCache={cache}
          historyKey="fileA"
        />,
      );
    });
    expect(ref.current?.getValue()).toBe("abc");

    act(() => {
      ref.current?.runCommand("redo");
    });
    expect(ref.current?.getValue()).toBe("abcd");
    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("abc");
  });

  it("keeps per-file undo/redo isolated in both directions", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();
    const cache = new Map<string, EditorState>();

    act(() => {
      root.render(
        <LatexCodeEditor
          key="proj:fileA"
          ref={ref}
          value={"aaa"}
          onChange={onChange}
          aria-label="latex editor"
          historyCache={cache}
          historyKey="fileA"
        />,
      );
    });
    act(() => {
      ref.current?.replaceRange(3, 3, "1");
    });
    expect(ref.current?.getValue()).toBe("aaa1");

    act(() => {
      root.render(
        <LatexCodeEditor
          key="proj:fileB"
          ref={ref}
          value={"bbb"}
          onChange={onChange}
          aria-label="latex editor"
          historyCache={cache}
          historyKey="fileB"
        />,
      );
    });
    act(() => {
      ref.current?.replaceRange(3, 3, "2");
    });
    expect(ref.current?.getValue()).toBe("bbb2");

    act(() => {
      root.render(
        <LatexCodeEditor
          key="proj:fileA"
          ref={ref}
          value={"aaa1"}
          onChange={onChange}
          aria-label="latex editor"
          historyCache={cache}
          historyKey="fileA"
        />,
      );
    });
    expect(ref.current?.getValue()).toBe("aaa1");
    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("aaa");
    act(() => {
      ref.current?.runCommand("redo");
    });
    expect(ref.current?.getValue()).toBe("aaa1");

    act(() => {
      root.render(
        <LatexCodeEditor
          key="proj:fileB"
          ref={ref}
          value={"bbb2"}
          onChange={onChange}
          aria-label="latex editor"
          historyCache={cache}
          historyKey="fileB"
        />,
      );
    });
    expect(ref.current?.getValue()).toBe("bbb2");
    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("bbb");
    act(() => {
      ref.current?.runCommand("redo");
    });
    expect(ref.current?.getValue()).toBe("bbb2");
  });

  it("bounds retention and refreshes recency on revisit", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();
    const cache = new Map<string, EditorState>();
    const renderFile = (name: string, doc: string) => {
      act(() => {
        root.render(
          <LatexCodeEditor
            key={`proj:${name}`}
            ref={ref}
            value={doc}
            onChange={onChange}
            aria-label="latex editor"
            historyCache={cache}
            historyKey={name}
          />,
        );
      });
    };

    renderFile("fileA", "a");
    act(() => {
      ref.current?.replaceRange(1, 1, "1");
    });
    expect(ref.current?.getValue()).toBe("a1");

    renderFile("fileB", "b");
    expect(cache.get("fileA")?.doc.toString()).toBe("a1");

    // Revisit A: caches B, restores A, then refreshes A as most-recent on next switch.
    renderFile("fileA", "a1");
    expect(ref.current?.getValue()).toBe("a1");
    renderFile("fileC", "c");
    expect(cache.get("fileA")?.doc.toString()).toBe("a1");
    expect(cache.get("fileB")?.doc.toString()).toBe("b");

    // Fill with enough new files to force eviction of exactly the oldest (fileB).
    // Start order is [fileB, fileA]; adding MAX-1 files grows the unbounded
    // cache to MAX+1, so a single LRU eviction removes fileB (oldest, never
    // revisited) while refreshed fileA survives.
    for (let i = 0; i < MAX_RETAINED_EDITOR_STATES - 1; i += 1) {
      renderFile(`fill-${i}`, `fill-${i}`);
    }

    expect(cache.size).toBe(MAX_RETAINED_EDITOR_STATES);
    expect(cache.has("fileB")).toBe(false);
    expect(cache.get("fileA")?.doc.toString()).toBe("a1");
  });

  it("caps retention at the bounded maximum across many files", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();
    const cache = new Map<string, EditorState>();
    const total = MAX_RETAINED_EDITOR_STATES + 5;

    for (let i = 0; i < total; i += 1) {
      act(() => {
        root.render(
          <LatexCodeEditor
            key={`proj:many-${i}`}
            ref={ref}
            value={`content-${i}`}
            onChange={onChange}
            aria-label="latex editor"
            historyCache={cache}
            historyKey={`many-${i}`}
          />,
        );
      });
    }

    expect(cache.size).toBe(MAX_RETAINED_EDITOR_STATES);
    expect(cache.has("many-0")).toBe(false);
    expect(cache.get(`many-${total - 2}`)?.doc.toString()).toBe(
      `content-${total - 2}`,
    );
  });

  it("falls back to fresh state without historyCache/historyKey", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();

    act(() => {
      root.render(
        <LatexCodeEditor
          key="proj:solo"
          ref={ref}
          value={"fresh"}
          onChange={onChange}
          aria-label="latex editor"
        />,
      );
    });
    act(() => {
      ref.current?.replaceRange(5, 5, "!");
    });
    expect(ref.current?.getValue()).toBe("fresh!");

    act(() => {
      root.render(
        <LatexCodeEditor
          key="proj:other"
          ref={ref}
          value={"other"}
          onChange={onChange}
          aria-label="latex editor"
        />,
      );
    });
    expect(ref.current?.getValue()).toBe("other");
    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("other");

    act(() => {
      root.render(
        <LatexCodeEditor
          key="proj:solo"
          ref={ref}
          value={"fresh!"}
          onChange={onChange}
          aria-label="latex editor"
        />,
      );
    });
    // Without a cache there is nothing to restore: fresh doc, empty history.
    expect(ref.current?.getValue()).toBe("fresh!");
    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("fresh!");
  });

  it("marks prose misspellings only when spellCheck is on", async () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const doc = "The teh quick brown fox.";
    const { createWordListChecker } = await import("@/lib/spellcheckService");
    const { getBaseDictionary } = await import("@alove/editor");
    const checker = createWordListChecker(getBaseDictionary());

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={doc}
          onChange={() => {}}
          aria-label="latex editor"
          spellCheck={false}
          spellcheckChecker={checker}
        />,
      );
    });
    // Lint markers render async; allow the lint delay to elapse.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    expect(host().querySelectorAll(".cm-lintRange-warning").length).toBe(0);

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={doc}
          onChange={() => {}}
          aria-label="latex editor"
          spellCheck={true}
          spellcheckChecker={checker}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    expect(
      host().querySelectorAll(".cm-lintRange-warning").length,
    ).toBeGreaterThan(0);
  });

  it("ignores custom dictionary words in spellcheck markers", async () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const doc = "The TehCustomWord appears here.";
    const { createWordListChecker } = await import("@/lib/spellcheckService");
    const { getBaseDictionary } = await import("@alove/editor");

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={doc}
          onChange={() => {}}
          aria-label="latex editor"
          spellCheck={true}
          spellcheckChecker={createWordListChecker(getBaseDictionary())}
          spellcheckCustomWords={["tehcustomword"]}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    expect(host().querySelectorAll(".cm-lintRange-warning").length).toBe(0);
  });

  it("reconfigures project completion without resetting view or history", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();
    const cites = [{ key: "einstein1905", title: "Relativity" }];
    const labels = [{ label: "sec:intro", context: "Intro" }];

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={"See "}
          onChange={onChange}
          aria-label="latex editor"
          citationEntries={[]}
          labelEntries={[]}
        />,
      );
    });
    const domBefore = host().firstChild;
    act(() => {
      ref.current?.replaceRange(4, 4, "X");
    });
    const callsAfterEdit = onChange.mock.calls.length;

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={ref.current?.getValue() ?? ""}
          onChange={onChange}
          aria-label="latex editor"
          citationEntries={cites}
          labelEntries={labels}
        />,
      );
    });
    expect(host().firstChild).toBe(domBefore);
    expect(ref.current?.getValue()).toBe("See X");
    expect(onChange.mock.calls.length).toBe(callsAfterEdit);

    act(() => {
      ref.current?.runCommand("undo");
    });
    expect(ref.current?.getValue()).toBe("See ");
    expect(host().firstChild).toBe(domBefore);
  });

  it("keeps the exact doc across per-keystroke project churn", () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const onChange = vi.fn();

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={"\\section{Intro}"}
          onChange={onChange}
          aria-label="latex editor"
          citationEntries={[]}
          labelEntries={[]}
        />,
      );
    });
    const domBefore = host().firstChild;
    // Simulate native-input keystrokes: each edit is followed by a render
    // with fresh project array identities (new filesByPath object upstream).
    const typed = " alpha omega";
    for (let i = 0; i < typed.length; i += 1) {
      const at = (ref.current?.getValue() ?? "").length;
      act(() => {
        ref.current?.replaceRange(at, at, typed[i]!);
      });
      const current = ref.current?.getValue() ?? "";
      act(() => {
        root.render(
          <LatexCodeEditor
            ref={ref}
            value={current}
            onChange={onChange}
            aria-label="latex editor"
            citationEntries={[{ key: `cite-${i}` }]}
            labelEntries={[{ label: `sec-${i}` }]}
          />,
        );
      });
      expect(host().firstChild).toBe(domBefore);
    }
    expect(ref.current?.getValue()).toBe("\\section{Intro} alpha omega");
    // Every keystroke stays its own undo step back to the template.
    for (let i = 0; i < typed.length; i += 1) {
      act(() => {
        ref.current?.runCommand("undo");
      });
    }
    expect(ref.current?.getValue()).toBe("\\section{Intro}");
    expect(host().firstChild).toBe(domBefore);
  });

  it("does not dispatch on plain rerenders (stable array defaults)", async () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const { createWordListChecker } = await import("@/lib/spellcheckService");
    const { getBaseDictionary } = await import("@alove/editor");
    const checker = createWordListChecker(getBaseDictionary());
    const renderEditor = (extra?: {
      citationEntries?: { key: string }[];
      labelEntries?: { label: string }[];
    }) =>
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={"hello world"}
          onChange={() => {}}
          aria-label="latex editor"
          spellCheck={true}
          spellcheckChecker={checker}
          citationEntries={extra?.citationEntries}
          labelEntries={extra?.labelEntries}
        />,
      );

    act(() => {
      renderEditor();
    });
    const spy = vi.spyOn(findView(), "dispatch");
    // Fresh array identities each render (what EditorPane produces per
    // filesByPath update); omitted word-list props use module defaults.
    // Neither may cause a view.dispatch: one fired between Playwright's
    // select-all and insert collapses the DOM selection, so fill()
    // appends instead of replacing.
    act(() => {
      renderEditor({ citationEntries: [{ key: "k1" }] });
    });
    act(() => {
      renderEditor({
        citationEntries: [{ key: "k2" }],
        labelEntries: [{ label: "sec-a" }],
      });
    });
    act(() => {
      ref.current?.focus();
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(ref.current?.getValue()).toBe("hello world");
  });

  it("skips redundant identical refreshes so hovered tooltips survive the debounce timer", async () => {
    const ref = createRef<LatexCodeEditorHandle>();
    const { createWordListChecker } = await import("@/lib/spellcheckService");
    const { getBaseDictionary } = await import("@alove/editor");
    const doc = "The teh quick brown fox.";

    act(() => {
      root.render(
        <LatexCodeEditor
          ref={ref}
          value={doc}
          onChange={() => {}}
          aria-label="latex editor"
          spellCheck={true}
          spellcheckChecker={createWordListChecker(getBaseDictionary())}
        />,
      );
    });
    // Mount dispatches the initial refresh immediately; the debounced
    // value timer fires later with identical inputs. It must be a no-op:
    // re-dispatching the same diagnostics dismisses a hovered lint
    // tooltip (spelling suggestions).
    const spy = vi.spyOn(findView(), "dispatch");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(
      host().querySelectorAll(".cm-lintRange-warning").length,
    ).toBeGreaterThan(0);
  });
});
