import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfVisualEditor } from "./PdfVisualEditor";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import type { PdfEditBridge } from "@/lib/pdfEditBridge";
import { SP_PER_BP } from "@/lib/synctex";
const source =
  "\\documentclass{article}\n\\begin{document}\nOriginal prose.\n\\end{document}";
const layout = {
  page: 1,
  width: 600,
  height: 800,
  pageWidthBp: 600,
  pageHeightBp: 800,
  textRuns: [
    { text: "Original prose.", left: 70, top: 100, width: 100, height: 12 },
  ],
};
describe("on-page PDF edits", () => {
  let host: HTMLDivElement, root: Root;
  const apply = vi.fn(() => true),
    compile = vi.fn(async () => {});
  let bridge: { current: PdfEditBridge };
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
    useWorkbenchStore.setState({
      projectId: "p",
      mainFile: "main.tex",
      activeFileId: "main.tex",
      filesByPath: { "main.tex": source },
      openFiles: ["main.tex"],
    });
    useWorkbenchStore.setState({
      documentRevision: 4,
      synctexRevision: 4,
      pdfSourceRevision: 4,
      pdfDataUrl: "data:application/pdf;base64,test",
      buildStatus: "ready",
      synctexMapping: {
        version: 1,
        truncated: false,
        entries: [
          {
            file: "main.tex",
            line: 3,
            page: 1,
            x: 70 * SP_PER_BP,
            y: 110 * SP_PER_BP,
          },
        ],
      },
      runCompile: compile,
    });
    apply.mockClear();
    compile.mockClear();
    bridge = {
      current: {
        fileId: "main.tex",
        getValue: () => source,
        applySourcePatches: apply,
        openObjectAt: () => false,
      },
    };
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  async function begin() {
    await act(async () =>
      root.render(<PdfVisualEditor layout={layout} bridge={bridge} />),
    );
    const button = host.querySelector(
      'button[aria-label^="Edit paragraph"]',
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    await act(async () => button.click());
  }
  async function change(text: string) {
    const input = host.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  function applyButton() {
    return [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "Apply & rebuild",
    )!;
  }
  it("patches through shared undo and rebuilds after checkpoint", async () => {
    const checkpoint = vi.fn(async () => ({ proceed: true }));
    useWorkbenchStore.setState({
      persistence: { prepareSourceReplacement: checkpoint },
    });
    await begin();
    await change("Edited 50% prose.");
    await act(async () => applyButton().click());
    expect(checkpoint).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(source, [
      {
        from: source.indexOf("Original"),
        to: source.indexOf("Original") + "Original prose.".length,
        insert: "Edited 50\\% prose.",
      },
    ]);
    expect(compile).toHaveBeenCalledOnce();
  });
  it("keeps the draft if source changes during checkpoint", async () => {
    let resolve!: (v: { proceed: boolean }) => void;
    useWorkbenchStore.setState({
      persistence: {
        prepareSourceReplacement: () =>
          new Promise((r) => {
            resolve = r;
          }),
      },
    });
    await begin();
    await change("Do not lose this draft.");
    await act(async () => applyButton().click());
    await act(async () => {
      useWorkbenchStore.setState({ documentRevision: 5 });
      resolve({ proceed: true });
    });
    expect(apply).not.toHaveBeenCalled();
    expect(compile).not.toHaveBeenCalled();
    expect(host.querySelector("textarea")!.value).toBe(
      "Do not lose this draft.",
    );
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });
  it("offers no targets for viewers or stale mappings", async () => {
    useWorkbenchStore.setState({ projectRole: "viewer" });
    await act(async () =>
      root.render(<PdfVisualEditor layout={layout} bridge={bridge} />),
    );
    expect(host.querySelector("button")).toBeNull();
    await act(async () =>
      useWorkbenchStore.setState({ projectRole: "owner", documentRevision: 5 }),
    );
    expect(host.querySelector("button")).toBeNull();
  });
  it("cancels without touching source", async () => {
    await begin();
    await change("Discarded draft.");
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === "Cancel")!
        .click(),
    );
    expect(apply).not.toHaveBeenCalled();
    expect(compile).not.toHaveBeenCalled();
  });
  it("returns a retained draft to its original PDF page after navigation elsewhere", async () => {
    await begin();
    await change("Draft on the first page.");
    const setPdfPage = vi.fn();
    await act(async () => {
      useWorkbenchStore.setState({ setPdfPage });
      root.render(
        <PdfVisualEditor
          layout={{ ...layout, page: 2, textRuns: [] }}
          bridge={bridge}
        />,
      );
    });
    expect(setPdfPage).toHaveBeenCalledWith(1);
    expect(host.querySelector("textarea")).toBeNull();
    await act(async () =>
      root.render(<PdfVisualEditor layout={layout} bridge={bridge} />),
    );
    expect(host.querySelector("textarea")!.value).toBe(
      "Draft on the first page.",
    );
    expect(apply).not.toHaveBeenCalled();
  });
});
