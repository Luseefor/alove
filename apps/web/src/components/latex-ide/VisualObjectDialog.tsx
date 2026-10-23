"use client";
import React from "react";
import { useState, useRef, type RefObject } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { canEditVisualRange } from "@alove/editor";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import { buildProjectLanguageIndex } from "@/lib/projectLanguage";
import {
  createVisualTable,
  parseVisualTable,
  requiredTablePackages,
} from "@/lib/visualTable";
import {
  createVisualSubfigure,
  parseVisualSubfigure,
} from "@/lib/visualSubfigure";
import { VisualSubfigureEditor } from "./VisualSubfigureEditor";
import {
  createVisualFigure,
  parseVisualFigure,
  isFigurePath,
  requiredFigurePackages,
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
  visualPackageSetup,
  isVisualObjectCurrent,
  objectSourcePatches,
  type VisualObjectTarget,
} from "@/lib/visualObjectSession";
import type { VisualSourcePatch } from "@/lib/visualObjectTypes";
import type { LatexCodeEditorHandle } from "./LatexCodeEditor";
import { VisualTableEditor } from "./VisualTableEditor";
import {
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
  const [figurePackages, setFigurePackages] = useState<string[]>([]);
  const [enabledFigurePackages, setEnabledFigurePackages] = useState<string[]>(
    [],
  );
  const [tablePackages, setTablePackages] = useState<string[]>([]);
  const [enabledTablePackages, setEnabledTablePackages] = useState<string[]>(
    [],
  );
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
    setFigurePackages([]);
    setEnabledFigurePackages([]);
    setTablePackages(
      object.kind === "table"
        ? requiredTablePackages(object).filter(
            (name) =>
              !visualPackageSetup(
                current.filesByPath[current.mainFile ?? ""] ?? "",
                name,
              ).present,
          )
        : [],
    );
    setEnabledTablePackages([]);
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
          : kind === "subfigure"
            ? createVisualSubfigure([path, path], eol)
            : kind === "math"
              ? createVisualMath("x^2", false, eol)
              : createVisualCitation([key], kind);
    if (kind === "table" || kind === "figure" || kind === "subfigure") {
      const used = new Set(language.labels.map((entry) => entry.label));
      fragment = fragment.replace(/\\label\{([^{}]+)\}/g, (_, base: string) => {
        let label = base,
          n = 1;
        while (used.has(label)) label = `${base}-${n++}`;
        used.add(label);
        return `\\label{${label}}`;
      });
    }
    const object =
      parseVisualTable(fragment) ??
      parseVisualSubfigure(fragment) ??
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
      if (
        target.object.kind === "figure" ||
        target.object.kind === "subfigure"
      ) {
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
      if (
        target.object.kind === "figure" ||
        target.object.kind === "subfigure"
      ) {
        const fragment = applyVisualSourcePatches(
          target.object.source,
          edits.map((patch) => ({
            ...patch,
            from: patch.from - target.object.from,
            to: patch.to - target.object.from,
          })),
        );
        const candidate =
          parseVisualSubfigure(fragment) ?? parseVisualFigure(fragment);
        if (!candidate)
          throw new Error(
            "The edited figure could not be recognized safely. Keep this edit in Source.",
          );
        const required = requiredFigurePackages(candidate).filter(
          (name) => name !== "graphicx",
        );
        const state = useWorkbenchStore.getState();
        const root = state.filesByPath[state.mainFile ?? ""] ?? "";
        const missing = required.filter(
          (name) => !visualPackageSetup(root, name).present,
        );
        setFigurePackages(missing);
        if (missing.length) {
          const setup = visualPackageSetup(root, missing[0]!);
          if (state.mainFile !== target.fileId || setup.insertion === null)
            throw new Error(
              `Enable ${missing.join(", ")} in ${state.mainFile} document setup in Source first.`,
            );
          if (missing.some((name) => !enabledFigurePackages.includes(name)))
            throw new Error(
              "These figure options require packages. Review and enable them below, then Apply again.",
            );
          const eol = target.source.includes("\r\n") ? "\r\n" : "\n";
          patches.push({
            from: setup.insertion,
            to: setup.insertion,
            insert: `\\usepackage{${missing.join(",")}}${eol}`,
          });
        }
      }
      if (target.object.kind === "table") {
        const fragment = applyVisualSourcePatches(
          target.object.source,
          edits.map((p) => ({
            ...p,
            from: p.from - target.object.from,
            to: p.to - target.object.from,
          })),
        );
        const candidate = parseVisualTable(fragment);
        if (!candidate)
          throw new Error(
            "The edited table could not be recognized safely. Keep this edit in Source.",
          );
        const state = useWorkbenchStore.getState(),
          root = state.filesByPath[state.mainFile ?? ""] ?? "";
        const missing = requiredTablePackages(candidate).filter(
          (name) => !visualPackageSetup(root, name).present,
        );
        setTablePackages(missing);
        if (missing.length) {
          const setup = visualPackageSetup(root, missing[0]!);
          if (state.mainFile !== target.fileId || setup.insertion === null)
            throw new Error(
              `Enable ${missing.join(", ")} in ${state.mainFile} document setup in Source before applying these table options.`,
            );
          if (missing.some((name) => !enabledTablePackages.includes(name)))
            throw new Error(
              "These table options require packages. Review and enable them below, then Apply again.",
            );
          const eol = target.source.includes("\r\n") ? "\r\n" : "\n";
          patches.push({
            from: setup.insertion,
            to: setup.insertion,
            insert: `\\usepackage{${missing.join(",")}}${eol}`,
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
    target?.object.kind === "figure" || target?.object.kind === "subfigure"
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
                  : target.object.kind === "table"
                    ? "[data-cell]:not([disabled])"
                    : 'textarea:not([disabled]), input:not([disabled]):not([type="checkbox"]), select:not([disabled])',
              );
              if (targetField && !targetField.hasAttribute("disabled")) {
                event.preventDefault();
                targetField.focus();
              }
            }}
            className={
              target.object.kind === "table"
                ? "visual-table-dialog"
                : target.object.kind === "subfigure"
                  ? "fixed left-1/2 top-1/2 z-[100] flex h-[min(760px,94dvh)] max-h-[94dvh] w-[min(850px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-background p-5 text-foreground shadow-2xl"
                  : "fixed left-1/2 top-1/2 z-[100] max-h-[90dvh] w-[min(850px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-border bg-background p-5 text-foreground shadow-2xl"
            }
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
            <div
              className={
                target.object.kind === "table"
                  ? "flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-4"
                  : "mb-4 flex shrink-0 items-start justify-between gap-3"
              }
            >
              <div className="min-w-0 flex-1">
                <Dialog.Title className="text-lg font-semibold">
                  {target.insertion === null ? "Edit" : "Insert"}{" "}
                  {target.object.kind === "math"
                    ? "equation"
                    : target.object.kind}
                </Dialog.Title>
                <Dialog.Description className="sr-only">
                  Changes apply to the original LaTeX source as one undoable
                  edit. Cancel discards object edits; uploaded assets remain in
                  the project.
                </Dialog.Description>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    onRequestSource?.();
                    const current = useWorkbenchStore.getState();
                    if (
                      current.projectId === target.projectId &&
                      current.activeFileId === target.fileId &&
                      editor.current?.getValue() === target.source
                    )
                      useWorkbenchStore.setState({
                        nextSelection: {
                          start: target.insertion ?? target.object.from,
                          end: target.insertion ?? target.object.to,
                        },
                      });
                    setTarget(null);
                  }}
                >
                  Edit in Source
                </button>
                {target.object.kind === "table" && (
                  <button
                    type="button"
                    aria-label="Close table editor"
                    disabled={busy}
                    onClick={close}
                    className="flex h-8 w-8 items-center justify-center rounded text-xl text-muted-foreground hover:bg-muted"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
            {error && (
              <p
                role="alert"
                className={
                  target.object.kind === "table"
                    ? "shrink-0 border-b border-border px-5 py-2 text-sm text-error"
                    : "mb-3 text-sm text-error"
                }
              >
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
                    Add <code>{"\\usepackage{graphicx}"}</code> to{" "}
                    {store.mainFile} in Source before applying a figure here.
                  </p>
                )}
              </div>
            )}
            {figurePackages.length > 0 && (
              <div className="mb-3 border-y border-border py-2 text-sm">
                {store.mainFile === target.fileId ? (
                  figurePackages.map((name) => (
                    <label className="flex items-center gap-2 py-1" key={name}>
                      <input
                        type="checkbox"
                        aria-label={`Enable ${name} in document setup`}
                        disabled={disabled}
                        checked={enabledFigurePackages.includes(name)}
                        onChange={(e) =>
                          setEnabledFigurePackages((names) =>
                            e.target.checked
                              ? [...names, name]
                              : names.filter((n) => n !== name),
                          )
                        }
                      />
                      {name}
                    </label>
                  ))
                ) : (
                  <p>
                    Enable {figurePackages.join(", ")} in {store.mainFile}{" "}
                    document setup in Source first.
                  </p>
                )}
              </div>
            )}
            {target.object.kind === "table" && tablePackages.length > 0 && (
              <div className="shrink-0 border-b border-border bg-muted/30 px-5 py-3 text-sm">
                {store.mainFile === target.fileId ? (
                  <>
                    <p className="mb-2">Enable required document packages:</p>
                    {tablePackages.map((name) => (
                      <label
                        key={name}
                        className="flex items-center gap-2 py-1"
                      >
                        <input
                          type="checkbox"
                          aria-label={`Enable ${name} in document setup`}
                          checked={enabledTablePackages.includes(name)}
                          disabled={disabled}
                          onChange={(e) =>
                            setEnabledTablePackages(
                              e.target.checked
                                ? [...enabledTablePackages, name]
                                : enabledTablePackages.filter(
                                    (n) => n !== name,
                                  ),
                            )
                          }
                        />
                        {name}
                      </label>
                    ))}
                  </>
                ) : (
                  <p>
                    Enable {tablePackages.join(", ")} in {store.mainFile}{" "}
                    document setup in Source first.
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
            ) : target.object.kind === "subfigure" ? (
              <VisualSubfigureEditor
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
