"use client";

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import type { PdfEditBridge } from "@/lib/pdfEditBridge";
import { buildPdfTextBlocks, pdfTextReplacement } from "@/lib/pdfVisualEditing";
import {
  buildPdfTextRegions,
  type PdfTextRegion,
} from "@/lib/pdfVisualRegions";
import type { PdfPageLayout } from "./PdfCanvasViewer";

export type PdfTextDraft = {
  region: PdfTextRegion;
  text: string;
  source: string;
  revision: number;
  projectId: string;
  pdf: string;
};

export function PdfVisualEditor({
  layout,
  bridge,
  onEditingChange,
  draft: providedDraft,
  onDraftChange,
}: {
  layout: PdfPageLayout;
  bridge: RefObject<PdfEditBridge | null>;
  onEditingChange?: (editing: boolean) => void;
  draft?: PdfTextDraft | null;
  onDraftChange?: (draft: PdfTextDraft | null) => void;
}) {
  const state = useWorkbenchStore();
  const blocks = useMemo(
    () => buildPdfTextBlocks(state.filesByPath),
    [state.filesByPath],
  );
  const regions = useMemo(
    () =>
      state.synctexMapping
        ? buildPdfTextRegions(blocks, layout, state.synctexMapping)
        : [],
    [blocks, layout, state.synctexMapping],
  );
  const [localDraft, setLocalDraft] = useState<PdfTextDraft | null>(null);
  const draft = providedDraft === undefined ? localDraft : providedDraft;
  const setDraft = onDraftChange ?? setLocalDraft;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const editing = draft !== null;
  useEffect(() => {
    onEditingChange?.(editing);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);
  const locked =
    state.projectRole === "viewer" ||
    state.buildStatus === "running" ||
    state.buildStatus === "queued" ||
    state.synctexRevision !== state.documentRevision ||
    state.pdfSourceRevision !== state.documentRevision;
  useEffect(() => {
    if (draft && document.activeElement !== input.current)
      input.current?.focus();
  }, [draft]);
  const current = (target: PdfTextDraft) => {
    const now = useWorkbenchStore.getState();
    return (
      now.projectRole !== "viewer" &&
      now.projectId === target.projectId &&
      now.documentRevision === target.revision &&
      now.synctexRevision === target.revision &&
      now.pdfSourceRevision === target.revision &&
      now.pdfDataUrl === target.pdf &&
      now.filesByPath[target.region.block.file] === target.source &&
      now.buildStatus !== "queued" &&
      now.buildStatus !== "running"
    );
  };
  function cancel() {
    if (!busy) {
      setDraft(null);
      setError("");
      requestAnimationFrame(() => opener.current?.focus());
    }
  }
  async function apply() {
    if (!draft || busy) return;
    setBusy(true);
    setError("");
    try {
      if (!current(draft))
        throw new Error(
          "The document changed. Your draft is kept here; copy it, then rebuild and reopen the text.",
        );
      if (draft.text === draft.region.block.text) {
        setDraft(null);
        return;
      }
      const patch = pdfTextReplacement(
        draft.region.block,
        draft.text,
        draft.source,
      );
      if (draft.source.slice(patch.from, patch.to) === patch.insert) {
        setDraft(null);
        return;
      }
      const before = useWorkbenchStore.getState();
      const checkpoint = await before.persistence.prepareSourceReplacement?.({
        query: "Edit text on PDF",
        replaceText: "",
        affectedPaths: [draft.region.block.file],
        expectedDocumentRevision: draft.revision,
      });
      if (
        checkpoint === false ||
        (checkpoint && typeof checkpoint === "object" && !checkpoint.proceed)
      )
        throw new Error(
          (checkpoint &&
            typeof checkpoint === "object" &&
            checkpoint.message) ||
            "Could not save a checkpoint. Your draft has not been applied.",
        );
      if (
        !current(draft) ||
        bridge.current?.fileId !== draft.region.block.file ||
        bridge.current?.getValue() !== draft.source ||
        !bridge.current.applySourcePatches(draft.source, [patch])
      )
        throw new Error(
          "The source changed while saving. Your draft has not been applied.",
        );
      setDraft(null);
      await useWorkbenchStore.getState().runCompile();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply this edit.");
    } finally {
      setBusy(false);
    }
  }
  const region = draft
    ? (regions.find((entry) => entry.block.id === draft.region.block.id) ??
      draft.region)
    : undefined;
  const left = region
    ? Math.max(
        4,
        Math.min(
          region.left - 4,
          layout.width - Math.min(240, layout.width - 8),
        ),
      )
    : 0;
  const width = region
    ? Math.min(
        layout.width - left - 4,
        Math.max(region.width + 8, Math.min(300, layout.width - 8)),
      )
    : 0;
  return (
    <>
      {!draft &&
        !locked &&
        regions.map((region) => (
          <button
            key={region.block.id}
            type="button"
            aria-label={`Edit ${region.block.kind}: ${region.block.text.slice(0, 80)}`}
            title="Click to edit this text"
            onClick={(event) => {
              opener.current = event.currentTarget;
              const now = useWorkbenchStore.getState();
              if (!now.projectId || !now.pdfDataUrl) return;
              now.openFile(region.block.file);
              setError("");
              setDraft({
                region,
                text: region.block.text,
                source: now.filesByPath[region.block.file],
                revision: now.documentRevision,
                projectId: now.projectId,
                pdf: now.pdfDataUrl,
              });
            }}
            className="absolute rounded-sm bg-transparent text-transparent hover:bg-primary/5 hover:outline hover:outline-1 hover:outline-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            style={{
              left: region.left - 2,
              top: region.top - 2,
              width: region.width + 4,
              height: region.height + 4,
            }}
          />
        ))}
      {draft && region && (
        <div
          role="group"
          aria-label="Edit text on PDF"
          className="absolute z-20 rounded-sm bg-white text-black shadow-lg ring-2 ring-primary"
          style={{ left, top: Math.max(0, region.top - 4), width }}
        >
          <textarea
            ref={input}
            aria-label="PDF text"
            value={draft.text}
            disabled={busy}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancel();
              }
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                void apply();
              }
            }}
            className="block w-full resize-y border-0 bg-white p-1 font-serif text-black outline-none"
            style={{
              minHeight: Math.max(region.height + 12, region.fontSize * 3),
              fontSize: Math.max(14, region.fontSize),
              lineHeight: 1.25,
              maxHeight: 350,
            }}
          />
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-background p-2 text-foreground">
            <button
              type="button"
              disabled={busy}
              onClick={cancel}
              className="rounded px-2 py-1 text-xs hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !draft.text.trim()}
              onClick={() => void apply()}
              className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {busy ? "Saving…" : "Apply & rebuild"}
            </button>
          </div>
          {error && (
            <p
              role="alert"
              className="bg-background p-2 text-xs text-foreground"
            >
              {error}
            </p>
          )}
        </div>
      )}
    </>
  );
}
