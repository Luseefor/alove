"use client";
import React, { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import { serializeWorkspaceSource } from "@/lib/workspaceArchive";

export function ProjectCheckpointRecovery({
  projectId,
}: {
  projectId: Id<"projects">;
}) {
  const rows = useQuery(api.sourceHistory.checkpoints, { projectId });
  const [id, setId] = useState<Id<"projectCheckpoints"> | null>(null);
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const snapshot = useQuery(
    api.sourceHistory.getCheckpoint,
    id ? { checkpointId: id } : "skip",
  );
  const restore = useMutation(api.sourceHistory.restoreCheckpointFile);
  const current = useWorkbenchStore((s) =>
    path ? s.filesByPath[path] : undefined,
  );
  const role = useWorkbenchStore((s) => s.projectRole);
  if (!rows?.length) return null;
  return (
    <section className="space-y-2 border-t pt-3">
      <h3 className="font-medium">Whole-project checkpoints</h3>
      <p className="text-xs text-muted-foreground">
        The two latest complete source snapshots are kept before bulk
        replacement or GitHub pull (up to 8 MiB). Download a snapshot to recover
        the entire project as a copy, or restore individual files here.
      </p>
      <select
        aria-label="Project checkpoint"
        className="w-full rounded border bg-background p-2 text-sm"
        value={id ?? ""}
        onChange={(e) => {
          setId((e.target.value as Id<"projectCheckpoints">) || null);
          setPath("");
          setError("");
        }}
      >
        <option value="">Choose a project checkpoint</option>
        {rows.map((row) => (
          <option value={row._id} key={row._id}>
            {new Date(row.createdAt).toLocaleString()} · {row.files.length}{" "}
            files
          </option>
        ))}
      </select>
      {snapshot && (
        <>
          <button
            type="button"
            className="rounded border px-2 py-1 text-xs hover:bg-muted"
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob(
                  [
                    serializeWorkspaceSource({
                      title: snapshot.title,
                      mainFile: snapshot.mainFile ?? null,
                      files: snapshot.files,
                    }),
                  ],
                  { type: "application/json" },
                ),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "checkpoint.weftly.json";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Download project checkpoint
          </button>
          <select
            aria-label="Checkpoint file"
            className="w-full rounded border bg-background p-2 text-sm"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          >
            <option value="">Preview a file</option>
            {Object.keys(snapshot.files).map((file) => (
              <option key={file} value={file}>
                {file}
              </option>
            ))}
          </select>
          {path && Object.hasOwn(snapshot.files, path) && (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="text-xs">Current source</p>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all border p-2 text-xs">
                    {current ?? "(deleted)"}
                  </pre>
                </div>
                <div>
                  <p className="text-xs">Checkpoint source</p>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all border p-2 text-xs">
                    {snapshot.files[path]}
                  </pre>
                </div>
              </div>
              <button
                type="button"
                disabled={busy || role === "viewer"}
                className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
                onClick={() => {
                  if (busy) return;
                  setBusy(true);
                  setError("");
                  void (async () => {
                    const revision =
                      useWorkbenchStore.getState().documentRevision;
                    await useWorkbenchStore.getState().saveAllDirtyFiles();
                    const state = useWorkbenchStore.getState();
                    if (
                      state.documentRevision !== revision ||
                      state.saveStatus !== "saved"
                    )
                      throw new Error(
                        "Source changed or could not save. Refresh before restoring.",
                      );
                    if (state.projectId !== projectId)
                      throw new Error("Project changed.");
                    await restore({
                      checkpointId: snapshot._id,
                      path,
                      expectedVersion: state.versionsByPath[path] ?? 0,
                      expectedIncarnation: state.incarnationsByPath[path],
                    });
                    setError("File restored. Previous source is in history.");
                  })()
                    .catch((e) =>
                      setError(
                        e instanceof Error
                          ? e.message
                          : "Could not restore file.",
                      ),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                Restore checkpoint file
              </button>
            </>
          )}
        </>
      )}
      {error && (
        <p role="status" className="text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
