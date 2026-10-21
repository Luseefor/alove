"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import type { LocalWorkspace } from "@/lib/localWorkspace";

export function WorkspaceHistory() {
  const { persistence, filesByPath, mainFile } = useWorkbenchStore();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<LocalWorkspace[]>([]);
  const [selected, setSelected] = useState<LocalWorkspace | null>(null);
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!persistence.listHistory || !persistence.restoreHistory) return null;
  const paths = selected
    ? [
        ...new Set([
          ...Object.keys(filesByPath),
          ...Object.keys(selected.files),
        ]),
      ].sort()
    : [];
  const changed = paths.filter((p) => filesByPath[p] !== selected?.files[p]);

  async function load() {
    setBusy(true);
    setError("");
    setSelected(null);
    try {
      setRows(await persistence.listHistory!());
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "History unavailable. Your source is unchanged.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await persistence.restoreHistory!(selected.revision);
      setOpen(false);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not restore history. Your source is unchanged.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (next) void load();
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="rounded-md px-2 py-1.5 text-xs font-medium hover:bg-muted"
        >
          History
        </button>
      </DialogTrigger>
      <DialogContent
        className="flex max-h-[90dvh] flex-col overflow-hidden"
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Workspace history</DialogTitle>
          <DialogDescription>
            Preview a checkpoint before restoring. Your current work is saved as
            a checkpoint first. This browser retains up to 20 checkpoints and 50
            MB per project.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-3 overflow-auto p-4 text-sm">
          {error && <p role="alert">{error}</p>}
          {busy && <p role="status">Working…</p>}
          {!busy && rows.length === 0 && (
            <p>
              No checkpoints yet. Earlier source is kept automatically when
              saved work changes.
            </p>
          )}
          <label className="block">
            Checkpoint
            <select
              aria-label="Checkpoint"
              disabled={busy}
              value={selected?.revision ?? ""}
              onChange={(e) => {
                const row =
                  rows.find((r) => r.revision === Number(e.target.value)) ??
                  null;
                setSelected(row);
                setPath(
                  row?.mainFile ?? Object.keys(row?.files ?? {})[0] ?? "",
                );
              }}
              className="mt-1 block w-full rounded border border-border bg-background p-2"
            >
              <option value="">Choose a checkpoint</option>
              {rows.map((row) => (
                <option key={row.revision} value={row.revision}>
                  Revision {row.revision} ·{" "}
                  {new Date(row.updatedAt).toLocaleString()} · {row.title}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <>
              <p>
                {changed.length} changed{" "}
                {changed.length === 1 ? "file" : "files"}. Main document:{" "}
                {mainFile ?? "none"} → {selected.mainFile ?? "none"}.
              </p>
              <label className="block">
                Preview file
                <select
                  aria-label="Preview file"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  className="mt-1 block w-full rounded border border-border bg-background p-2"
                >
                  {paths.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <h3 className="font-medium">Current source</h3>
                  <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-border p-2 text-xs">
                    {filesByPath[path] ?? "File absent"}
                  </pre>
                </div>
                <div className="min-w-0">
                  <h3 className="font-medium">Checkpoint source</h3>
                  <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-border p-2 text-xs">
                    {selected.files[path] ?? "File absent"}
                  </pre>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border p-4">
          <DialogClose asChild>
            <button
              type="button"
              disabled={busy}
              className="rounded border border-border px-3 py-2"
            >
              Cancel
            </button>
          </DialogClose>
          <button
            type="button"
            disabled={!selected || busy}
            onClick={() => void restore()}
            className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
          >
            Restore checkpoint
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
