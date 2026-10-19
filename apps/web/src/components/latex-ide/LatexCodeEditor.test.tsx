import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView, getDrawSelectionConfig, keymap } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import { historyField } from "@alove/editor";
import {
  LatexCodeEditor,
  type LatexCodeEditorHandle,
} from "@/components/latex-ide/LatexCodeEditor";

// jsdom lacks Range geometry; CodeMirror measures layout on scroll/selection.
// Polyfill here (not global setup) so focused editor tests don't emit
// unhandled getClientRects errors.
{
  const rangeProto =
    (globalThis as unknown as { Range?: { prototype: Range } }).Range
      ?.prototype;
  if (rangeProto && typeof rangeProto.getClientRects !== "function") {
    rangeProto.getClientRects = () =>
      [] as unknown as DOMRectList;
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
    const view = EditorView.findFromDOM(host().querySelector(".cm-editor") as HTMLElement)!;
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

    expect(container.querySelector('[data-testid="latex-editor-codemirror"]')).toBeNull();

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
    return view.state.facet(keymap).some((bindings) =>
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
    expect(getDrawSelectionConfig(findView().state).cursorBlinkRate).not.toBe(0);

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
    expect(getDrawSelectionConfig(findView().state).cursorBlinkRate).not.toBe(0);
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
});
