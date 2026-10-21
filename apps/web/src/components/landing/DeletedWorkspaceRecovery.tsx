"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import type { LocalWorkspace } from "@/lib/localWorkspace";
import type { LocalProjectRepository } from "./LocalProjectList";

export function DeletedWorkspaceRecovery({
  repository,
}: {
  repository: LocalProjectRepository;
}) {
  const [rows, setRows] = useState<LocalWorkspace[]>([]);
  const [error, setError] = useState("");
  const [recovered, setRecovered] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || !repository.listDeleted) return;
    let active = true;
    void repository
      .listDeleted()
      .then((items) => {
        if (active) setRows(items);
      })
      .catch(() => {
        if (active)
          setError("Could not load deleted project checkpoints. Try again.");
      });
    return () => {
      active = false;
    };
  }, [open, repository]);
  if (!repository.listDeleted) return null;
  async function recover(row: LocalWorkspace) {
    setBusy(true);
    setError("");
    try {
      const id = `local-${crypto.randomUUID()}`;
      await repository.save(
        { ...row, id, title: `${row.title.slice(0, 185)} (recovered)` },
        0,
      );
      setRecovered(id);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Recovery failed. The checkpoint is still available.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="rounded border border-border p-4 text-sm"
    >
      <summary className="cursor-pointer font-medium">
        Recover deleted projects
      </summary>
      <p className="my-2 text-muted-foreground">
        Recover the latest retained source as a separate project. Checkpoints
        are stored only in this browser.
      </p>
      {error && <p role="alert">{error}</p>}
      {recovered && (
        <Link className="underline" href={`/editor?project=${recovered}`}>
          Open recovered project
        </Link>
      )}
      {open && rows.length === 0 && !error && (
        <p>No deleted project checkpoints.</p>
      )}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <span className="min-w-0 break-words">
              {row.title} · {Object.keys(row.files).length} files
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => void recover(row)}
              className="rounded border border-border px-3 py-2 disabled:opacity-50"
            >
              Recover {row.title}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
