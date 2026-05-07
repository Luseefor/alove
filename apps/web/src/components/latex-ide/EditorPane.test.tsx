import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditorPane } from "@/components/latex-ide/EditorPane";
import { useWorkbenchStore } from "@/stores/workbenchStore";

describe("EditorPane", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
    useWorkbenchStore.setState({
      activeFileId: null,
      openFiles: [],
      filesByPath: {},
      dirtyByPath: {},
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders the empty editor hint when no file is active", () => {
    act(() => {
      root.render(<EditorPane />);
    });

    expect(container.textContent).toContain(
      "Open a `.tex` file from the project sidebar to start editing.",
    );
  });
});
