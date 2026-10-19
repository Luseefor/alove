import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
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
});
