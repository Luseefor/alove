"use client";
import React from "react";
import { useState, useRef, type RefObject } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { canEditVisualRange } from "@alove/editor";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import { buildProjectLanguageIndex } from "@/lib/projectLanguage";
import { createVisualTable, parseVisualTable } from "@/lib/visualTable";
import {
  createVisualFigure,
  parseVisualFigure,
  isFigurePath,
} from "@/lib/visualFigure";
import {
  createVisualMath,
  parseVisualMath,
  createVisualCitation,
  parseVisualCitation,
} from "@/lib/visualInline";
import {
  applyVisualSourcePatches,
  type VisualObject,
} from "@/lib/visualObjects";
import {
  graphicxSetup,
  isVisualObjectCurrent,
  objectSourcePatches,
  type VisualObjectTarget,
} from "@/lib/visualObjectSession";
import type { VisualSourcePatch } from "@/lib/visualObjectTypes";
import type { LatexCodeEditorHandle } from "./LatexCodeEditor";
import {
  VisualTableEditor,
  VisualFigureEditor,
  VisualMathEditor,
  VisualCitationEditor,
} from "./VisualObjectForms";

export function useVisualObjects(
  editor: RefObject<LatexCodeEditorHandle | null>,
  onRequestSource: (() => void) | undefined,
  onMessage: (message: string) => void,
) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialCell = useRef<{ row: number; column: number } | undefined>(
    undefined,
  );
  const [target, setTarget] = useState<VisualObjectTarget | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [enableGraphicx, setEnableGraphicx] = useState(false);
  const store = useWorkbenchStore();
  function begin(
    object: VisualObject,
    source: string,
    insertion: number | null = null,
  ) {
    const current = useWorkbenchStore.getState();
    if (
      !current.projectId ||
      !current.activeFileId ||
      current.filesByPath[current.activeFileId] !== source ||
      editor.current?.getValue() !== source
    ) {
      onMessage("The document changed. Try opening the object again.");
      return;
    }
    setTarget({
      object,
      source,
      projectId: current.projectId,
      fileId: current.activeFileId,
      revision: current.documentRevision,
      insertion,
    });
    setError("");
    setEnableGraphicx(false);
  }
  function open(
    object: VisualObject,
    source: string,
    cell?: { row: number; column: number },
  ) {
    initialCell.current = cell;
    begin(object, source);
  }
  function insert(kind: VisualObject["kind"]) {
    const current = useWorkbenchStore.getState(),
      source = editor.current?.getValue();
    const selection = editor.current?.getSelection();
    if (
      current.projectRole === "viewer" ||
      source === undefined ||
      !selection ||
      !canEditVisualRange(source, selection.start)
    ) {
      onMessage("Place the cursor in an editable paragraph first.");
      return;
    }
    const eol = source.includes("\r\n") ? "\r\n" : "\n";
    const language = buildProjectLanguageIndex(current.filesByPath);
    const key =
      kind === "citation"
        ? (language.citations[0]?.key ?? "key")
        : (language.labels[0]?.label ?? "label");
    const path =
      Object.keys(current.filesByPath).find(isFigurePath) ??
      "figures/image.png";
    let fragment =
      kind === "table"
        ? createVisualTable(2, 2, eol)
        : kind === "figure"
          ? createVisualFigure(path, eol)
          : kind === "math"
            ? createVisualMath("x^2", false, eol)
            : createVisualCitation([key], kind);
    if (kind === "table" || kind === "figure") {
      const base = kind === "table" ? "tab:new" : "fig:new";
      let label = base,
        n = 1;
      while (language.labels.some((entry) => entry.label === label))
        label = `${base}-${n++}`;
      fragment = fragment.replace(`\\label{${base}}`, `\\label{${label}}`);
    }
    const object =
      parseVisualTable(fragment) ??
      parseVisualFigure(fragment) ??
      parseVisualMath(fragment, 0, eol) ??
      parseVisualCitation(fragment);
    if (object) {
      initialCell.current = undefined;
      begin(object, source, selection.start);
    }
  }
  function close() {
    if (!busy) setTarget(null);
  }
  async function save(edits: VisualSourcePatch[]) {
    if (!target || busy) return;
    setBusy(true);
    setError("");
    try {
      const current = () =>
        isVisualObjectCurrent(
          target,
          useWorkbenchStore.getState(),
          editor.current?.getValue(),
        );
      if (!current())
        throw new Error(
          "The document or project changed. Reopen this editor; your draft has not been applied.",
        );
      const patches = objectSourcePatches(target, edits);
      if (target.object.kind === "figure") {
        const state = useWorkbenchStore.getState();
        const setup = graphicxSetup(
          state.filesByPath[state.mainFile ?? ""] ?? "",
        );
        if (!setup.present) {
          if (
            !enableGraphicx ||
            state.mainFile !== target.fileId ||
            setup.insertion === null
          )
            throw new Error(
              "Enable graphicx in the main document setup before applying this figure.",
            );
          const eol = target.source.includes("\r\n") ? "\r\n" : "\n";
          patches.push({
            from: setup.insertion,
            to: setup.insertion,
            insert: `\\usepackage{graphicx}${eol}`,
          });
        }
      }
      applyVisualSourcePatches(target.source, patches);
      const checkpoint = await useWorkbenchStore
        .getState()
        .persistence.prepareSourceReplacement?.({
          query: `Visual ${target.object.kind}`,
          replaceText: "",
          affectedPaths: [target.fileId],
          expectedDocumentRevision: target.revision,
        });
      if (
        checkpoint === false ||
        (checkpoint && typeof checkpoint === "object" && !checkpoint.proceed)
      )
        throw new Error(
          (checkpoint &&
            typeof checkpoint === "object" &&
            checkpoint.message) ||
            "The checkpoint could not be saved. Try again.",
        );
      if (
        !current() ||
        !editor.current?.applySourcePatches(target.source, patches)
      )
        throw new Error(
          "The document changed while saving. Reopen this editor; no object changes were applied.",
        );
      setTarget(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The object could not be applied.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File): Promise<string> {
    if (
      !target ||
      busy ||
      !isVisualObjectCurrent(
        target,
        useWorkbenchStore.getState(),
        editor.current?.getValue(),
      )
    )
      throw new Error("The document changed. Reopen the figure editor.");
    if (file.size > 500000 || file.size === 0)
      throw new Error("Choose an image or PDF up to 500 KB.");
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mime =
        bytes[0] === 137 &&
        bytes[1] === 80 &&
        bytes[2] === 78 &&
        bytes[3] === 71 &&
        bytes[4] === 13 &&
        bytes[5] === 10 &&
        bytes[6] === 26 &&
        bytes[7] === 10
          ? "image/png"
          : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            ? "image/jpeg"
            : new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-"
              ? "application/pdf"
              : null;
      const ext =
        mime === "image/png"
          ? "png"
          : mime === "image/jpeg"
            ? "jpg"
            : mime === "application/pdf"
              ? "pdf"
              : null;
      if (!mime || !ext)
        throw new Error("Only PNG, JPEG and PDF files are supported.");
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const data = `data:${mime};base64,${btoa(binary)}`;
      const current = useWorkbenchStore.getState();
      if (!isVisualObjectCurrent(target, current, editor.current?.getValue()))
        throw new Error(
          "The document changed during upload. Reopen the figure editor.",
        );
      const base =
        file.name
          .replace(/\.[^.]*$/, "")
          .replace(/[^a-zA-Z0-9_-]/g, "-")
          .slice(0, 80) || "image";
      let path = `figures/${base}.${ext}`,
        n = 1;
      while (current.filesByPath[path] !== undefined)
        path = `figures/${base}-${n++}.${ext}`;
      current.createFile(path, data, { open: false });
      const after = useWorkbenchStore.getState();
      if (
        after.filesByPath[path] !== data ||
        after.projectId !== target.projectId ||
        after.activeFileId !== target.fileId ||
        after.filesByPath[target.fileId] !== target.source
      )
        throw new Error("The upload could not be added to this project.");
      setTarget((t) =>
        t === target ? { ...t, revision: after.documentRevision } : t,
      );
      return path;
    } finally {
      setBusy(false);
    }
  }
  const language = target ? buildProjectLanguageIndex(store.filesByPath) : null;
  const setup =
    target?.object.kind === "figure"
      ? graphicxSetup(store.filesByPath[store.mainFile ?? ""] ?? "")
      : null;
  const disabled = busy || store.projectRole === "viewer";
  const common = { onSave: save, onCancel: close, disabled };
  const dialog =
    target && language ? (
      <Dialog.Root
        open
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/60" />
          <Dialog.Content
            ref={dialogRef}
            onOpenAutoFocus={(event) => {
              const cell = initialCell.current;
              const targetField = dialogRef.current?.querySelector<HTMLElement>(
                cell
                  ? `[aria-label="Row ${cell.row + 1} column ${cell.column + 1}"]`
                  : 'textarea:not([disabled]), input:not([disabled]):not([type="checkbox"]), select:not([disabled])',
              );
              if (targetField && !targetField.hasAttribute("disabled")) {
                event.preventDefault();
                targetField.focus();
              }
            }}
            className="fixed left-1/2 top-1/2 z-[100] max-h-[90dvh] w-[min(850px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-border bg-background p-5 text-foreground shadow-2xl"
            onEscapeKeyDown={(event) => {
              if (busy) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (busy) event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              editor.current?.focus();
            }}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <Dialog.Title className="text-lg font-semibold">
                  {target.insertion === null ? "Edit" : "Insert"}{" "}
                  {target.object.kind === "math"
                    ? "equation"
                    : target.object.kind}
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                  Changes apply to the original LaTeX source as one undoable
                  edit. Cancel discards object edits; uploaded assets remain in
                  the project.
                </Dialog.Description>
              </div>
              <button
                type="button"
                disabled={busy}
                className="shrink-0 rounded border border-border px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  onRequestSource?.();
                  const current = useWorkbenchStore.getState();
                  if (
                    current.projectId === target.projectId &&
                    current.activeFileId === target.fileId &&
                    editor.current?.getValue() === target.source
                  )
                    editor.current?.setSelection(
                      target.insertion ?? target.object.from,
                      target.insertion ?? target.object.to,
                    );
                  setTarget(null);
                }}
              >
                Edit in Source
              </button>
            </div>
            {error && (
              <p role="alert" className="mb-3 text-sm text-error">
                {error}
              </p>
            )}
            {busy && (
              <p role="status" className="mb-3 text-sm">
                Saving checkpoint…
              </p>
            )}
            {setup && !setup.present && (
              <div className="mb-4 rounded border border-border p-3 text-sm">
                {store.mainFile === target.fileId &&
                setup.insertion !== null ? (
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={enableGraphicx}
                      disabled={disabled}
                      onChange={(e) => setEnableGraphicx(e.target.checked)}
                    />
                    Enable image support in document setup (graphicx)
                  </label>
                ) : (
                  <p>
                    Add <code>\\usepackage&#123;graphicx&#125;</code> to{" "}
                    {store.mainFile} in Source before applying a figure here.
                  </p>
                )}
              </div>
            )}
            {target.object.kind === "table" ? (
              <VisualTableEditor model={target.object} {...common} />
            ) : target.object.kind === "figure" ? (
              <VisualFigureEditor
                model={target.object}
                assets={store.filesByPath}
                onUpload={upload}
                {...common}
              />
            ) : target.object.kind === "math" ? (
              <VisualMathEditor model={target.object} {...common} />
            ) : (
              <VisualCitationEditor
                model={target.object}
                citations={language.citations}
                labels={language.labels}
                {...common}
              />
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    ) : null;
  return { open, insert, dialog };
}
