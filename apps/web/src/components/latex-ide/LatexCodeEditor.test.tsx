import React, { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LatexCodeEditor,
  type LatexCodeEditorHandle,
} from "@/components/latex-ide/LatexCodeEditor";

describe("LatexCodeEditor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
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
});
