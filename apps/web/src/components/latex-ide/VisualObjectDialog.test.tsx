import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useVisualObjects } from "./VisualObjectDialog";
import { parseVisualTable, createVisualTable } from "@/lib/visualTable";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import type { LatexCodeEditorHandle } from "./LatexCodeEditor";
const fragment = createVisualTable();
const source = `\\documentclass{article}\n\\begin{document}\n${fragment}\n\\end{document}`;
const model = parseVisualTable(fragment, source.indexOf(fragment))!;
let api: ReturnType<typeof useVisualObjects>;
let container: HTMLDivElement, root: Root;
const apply = vi.fn(() => true),
  focus = vi.fn();
const editor = {
  current: {
    getValue: () => source,
    applySourcePatches: apply,
    focus,
    setSelection: vi.fn(),
  } as unknown as LatexCodeEditorHandle,
};
function Harness() {
  api = useVisualObjects(editor, vi.fn(), vi.fn());
  return api.dialog;
}
async function click(text: string) {
  const b = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  )!;
  await act(async () => b.click());
}
async function open() {
  await act(async () => api.open(model, source));
}
beforeEach(async () => {
  vi.clearAllMocks();
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useWorkbenchStore.setState({
    projectId: "p",
    activeFileId: "main.tex",
    mainFile: "main.tex",
    filesByPath: { "main.tex": source },
    documentRevision: 3,
    projectRole: "owner",
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
it("checkpoints before one exact-source editor transaction", async () => {
  const checkpoint = vi.fn(async () => {
    expect(apply).not.toHaveBeenCalled();
    return { proceed: true };
  });
  useWorkbenchStore.setState({
    persistence: { prepareSourceReplacement: checkpoint },
  });
  await open();
  await click("Apply table changes");
  expect(checkpoint).toHaveBeenCalledWith(
    expect.objectContaining({
      affectedPaths: ["main.tex"],
      expectedDocumentRevision: useWorkbenchStore.getState().documentRevision,
    }),
  );
  expect(apply).toHaveBeenCalledWith(source, []);
  expect(document.querySelector("[role=dialog]")).toBeNull();
});
it("keeps the draft open after checkpoint refusal", async () => {
  useWorkbenchStore.setState({
    persistence: {
      prepareSourceReplacement: async () => ({
        proceed: false,
        message: "Disk full",
      }),
    },
  });
  await open();
  await click("Apply table changes");
  expect(apply).not.toHaveBeenCalled();
  expect(document.querySelector("[role=alert]")?.textContent).toBe("Disk full");
  expect(document.querySelector("[role=dialog]")).not.toBeNull();
});
it("rejects edits that arrive while a checkpoint is pending", async () => {
  let finish!: (v: boolean) => void;
  const checkpoint = new Promise<boolean>((r) => {
    finish = r;
  });
  useWorkbenchStore.setState({
    persistence: { prepareSourceReplacement: () => checkpoint },
  });
  await open();
  await click("Apply table changes");
  await act(async () => useWorkbenchStore.setState({ documentRevision: 4 }));
  await act(async () => finish(true));
  expect(apply).not.toHaveBeenCalled();
  expect(document.querySelector("[role=alert]")?.textContent).toContain(
    "changed while saving",
  );
});
it("rejects project switches and viewer transitions, and Cancel leaves source intact", async () => {
  await open();
  await act(async () => useWorkbenchStore.setState({ projectId: "other" }));
  await click("Apply table changes");
  expect(apply).not.toHaveBeenCalled();
  await click("Cancel");
  expect(document.querySelector("[role=dialog]")).toBeNull();
  await act(async () =>
    useWorkbenchStore.setState({ projectId: "p", projectRole: "viewer" }),
  );
  await open();
  expect(
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Apply table changes",
    )?.disabled,
  ).toBe(true);
  expect(apply).not.toHaveBeenCalled();
});
