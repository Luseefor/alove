import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ManuscriptOutline } from "./ManuscriptOutline";
import { useWorkbenchStore } from "@/stores/workbenchStore";

describe("ManuscriptOutline", () => {
  it("opens the included file at its exact heading offset without editing", () => {
    const files = {
      "main.tex": String.raw`\begin{document}\section{Root}\input{child}\end{document}`,
      "child.tex": "😀\r\n\\section{Child}\r\nBody",
    };
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
    useWorkbenchStore
      .getState()
      .initializeProject({
        projectId: "local-outline",
        mainFile: "main.tex",
        files: Object.entries(files).map(([path, content]) => ({
          path,
          content,
        })),
      });
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() => root.render(<ManuscriptOutline />));
    expect(host.textContent).toContain("Root");
    expect(host.textContent).toContain("Child");
    const button = host.querySelector<HTMLButtonElement>(
      'button[aria-label^="Go to Child"]',
    )!;
    act(() => button.click());
    const state = useWorkbenchStore.getState();
    expect(state.activeFileId).toBe("child.tex");
    expect(state.nextSelection).toEqual({ start: 4, end: 4 });
    expect(state.filesByPath).toEqual(files);
    act(() => root.unmount());
  });
});
