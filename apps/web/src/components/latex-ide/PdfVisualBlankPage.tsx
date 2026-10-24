"use client";

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { escapeVisualText, parseVisualDocument } from "@alove/editor";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import { isBlankPdfSource } from "@/lib/pdfEditBridge";
import type { PdfEditBridge } from "@/lib/pdfEditBridge";

function targetEolFor(source: string): string {
  if (source.includes("\r\n")) return "\r\n";
  if (source.includes("\r") && !source.includes("\n")) return "\r";
  return "\n";
}

function nextFrame(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function PdfVisualBlankPage({
  bridge,
  text: providedText,
  onTextChange,
}: {
  bridge: RefObject<PdfEditBridge | null>;
  text?: string;
  onTextChange?: (text: string) => void;
}) {
  const state = useWorkbenchStore();
  const { mainFile, filesByPath, pdfDataUrl, projectRole, projectId } = state;
  const source = mainFile != null ? filesByPath[mainFile] : undefined;

  const body = useMemo(() => {
    if (typeof source !== "string") return null;
    try {
      const doc = parseVisualDocument(source);
      if (doc.limited) return null;
      const b = doc.body;
      if (!b || !Number.isInteger(b.from) || !Number.isInteger(b.to))
        return null;
      if (b.from < 0 || b.to < b.from || b.to > source.length) return null;
      return { from: b.from, to: b.to };
    } catch {
      return null;
    }
  }, [source]);

  const isBlankBody =
    body !== null &&
    typeof source === "string" &&
    source.slice(body.from, body.to).trim() === "";

  const canShow =
    mainFile != null &&
    mainFile.endsWith(".tex") &&
    typeof source === "string" &&
    body !== null &&
    isBlankBody &&
    isBlankPdfSource(source) &&
    pdfDataUrl === null &&
    projectRole !== "viewer";

  const [localText, setLocalText] = useState("");
  const controlled = providedText !== undefined;
  const text = providedText ?? localText;
  const setText = onTextChange ?? setLocalText;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const openedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!controlled) setLocalText("");
    setError("");
    setBusy(false);
    openedFor.current = null;
  }, [projectId, mainFile, controlled]);

  useEffect(() => {
    if (!canShow) return;
    if (!mainFile) return;
    const now = useWorkbenchStore.getState();
    if (now.activeFileId === mainFile) return;
    if (now.projectRole === "viewer") return;
    const key = `${now.projectId ?? ""}:${mainFile}`;
    if (openedFor.current === key) return;
    openedFor.current = key;
    now.openFile(mainFile);
  }, [canShow, mainFile, projectId]);

  async function apply() {
    if (busy) return;
    if (text.trim() === "") {
      setError("Write your first paragraph before applying.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const snap = useWorkbenchStore.getState();
      const snapProjectId = snap.projectId;
      const snapMainFile = snap.mainFile;
      const snapRevision = snap.documentRevision;
      const snapSource =
        snapMainFile != null ? snap.filesByPath[snapMainFile] : undefined;
      if (!snapProjectId || !snapMainFile || typeof snapSource !== "string") {
        throw new Error(
          "The document changed. Your draft is kept here; copy it, then try again.",
        );
      }
      if (snap.projectRole === "viewer") {
        throw new Error("This project is read-only.");
      }
      if (snap.buildStatus === "queued" || snap.buildStatus === "running") {
        throw new Error(
          "A build is running. Wait for it to finish, then apply.",
        );
      }
      let insertAt: number;
      try {
        const doc = parseVisualDocument(snapSource);
        if (doc.limited) throw new Error("limited");
        if (snapSource.slice(doc.body.from, doc.body.to).trim() !== "")
          throw new Error("not-blank");
        insertAt = doc.body.from;
      } catch (e) {
        if (e instanceof Error && e.message === "limited") {
          throw new Error(
            "This document needs Source editing. Your draft is kept here.",
          );
        }
        throw new Error(
          "The document changed. Your draft is kept here; copy it, then try again.",
        );
      }
      if (useWorkbenchStore.getState().activeFileId !== snapMainFile) {
        useWorkbenchStore.getState().openFile(snapMainFile);
      }
      const before = useWorkbenchStore.getState();
      const checkpoint = await before.persistence.prepareSourceReplacement?.({
        query: "Start writing on PDF",
        replaceText: "",
        affectedPaths: [snapMainFile],
        expectedDocumentRevision: snapRevision,
      });
      if (
        checkpoint === false ||
        (checkpoint && typeof checkpoint === "object" && !checkpoint.proceed)
      ) {
        throw new Error(
          (checkpoint &&
            typeof checkpoint === "object" &&
            checkpoint.message) ||
            "Could not save a checkpoint. Your draft has not been applied.",
        );
      }
      const isCurrent = (s: ReturnType<typeof useWorkbenchStore.getState>) =>
        s.projectRole !== "viewer" &&
        s.projectId === snapProjectId &&
        s.mainFile === snapMainFile &&
        s.documentRevision === snapRevision &&
        s.filesByPath[snapMainFile] === snapSource &&
        s.pdfDataUrl === null &&
        s.buildStatus !== "queued" &&
        s.buildStatus !== "running";
      const bridgeReady = () =>
        bridge.current?.fileId === snapMainFile &&
        bridge.current?.getValue() === snapSource;
      let now = useWorkbenchStore.getState();
      if (!isCurrent(now) || !bridgeReady()) {
        await nextFrame();
        now = useWorkbenchStore.getState();
        if (!isCurrent(now)) {
          throw new Error(
            "The document changed. Your draft is kept here; copy it, then try again.",
          );
        }
        if (!bridgeReady()) {
          throw new Error(
            "The source editor is not ready. Try applying again.",
          );
        }
      }
      const eol = targetEolFor(snapSource);
      const insert = escapeVisualText(text).replace(/\r\n|\n|\r/g, eol);
      if (insert.trim() === "") {
        throw new Error("Write your first paragraph before applying.");
      }
      const patch = { from: insertAt, to: insertAt, insert };
      const ok = bridge.current!.applySourcePatches(snapSource, [patch]);
      if (!ok) {
        throw new Error(
          "The source changed while saving. Your draft has not been applied.",
        );
      }
      setText("");
      await useWorkbenchStore.getState().runCompile();
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply this edit.");
    } finally {
      setBusy(false);
    }
  }

  if (!canShow || !mainFile || typeof source !== "string" || !body) {
    return null;
  }

  const buildBusy =
    state.buildStatus === "queued" || state.buildStatus === "running";
  const canApply = text.trim() !== "" && !busy && !buildBusy;

  return (
    <div
      data-testid="pdf-visual-blank-page"
      className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-muted/40 p-6"
    >
      <div className="w-full max-w-xl rounded-sm bg-white p-6 text-black shadow-lg">
        <textarea
          aria-label="PDF text"
          placeholder="Write your first paragraph…"
          value={text}
          disabled={busy}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !busy) {
              e.preventDefault();
              setText("");
              setError("");
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              void apply();
            }
          }}
          rows={6}
          className="block min-h-40 w-full resize-y border-0 bg-white p-1 font-serif text-base leading-relaxed text-black outline-none placeholder:text-neutral-400"
        />
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={!canApply}
            onClick={() => void apply()}
            className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Saving…" : "Apply & rebuild"}
          </button>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
