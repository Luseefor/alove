"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TEMPLATES } from "@/lib/templates";
import { parseWorkspaceSource } from "@/lib/workspaceArchive";
import { createLocalWorkspaceRepository } from "@/lib/localWorkspace";

export function ProjectLauncher() {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function importSource(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.size > 20 * 1024 * 1024)
        throw new Error("Archive exceeds 20 MiB.");
      const source = parseWorkspaceSource(await file.text());
      const id = `local-${crypto.randomUUID()}`;
      const mainFile =
        source.mainFile ??
        Object.keys(source.files).find((path) => path.endsWith(".tex")) ??
        null;
      const activeFile = mainFile ?? Object.keys(source.files)[0] ?? null;
      await createLocalWorkspaceRepository().save(
        {
          ...source,
          id,
          mainFile,
          activeFile,
          openFiles: activeFile ? [activeFile] : [],
        },
        0,
      );
      router.push(`/editor?project=${encodeURIComponent(id)}`);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Import failed. Existing projects are unchanged.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Create or import a project"
      className="space-y-3 rounded-xl border border-border bg-background p-4"
    >
      <h2 className="text-sm font-semibold">Start a project</h2>
      <div className="flex flex-wrap gap-2 text-xs">
        <Link
          href="/editor?new=true"
          className="rounded border border-border px-3 py-2 hover:bg-muted"
        >
          Blank document
        </Link>
        {Object.entries(TEMPLATES).map(([id, template]) => (
          <Link
            key={id}
            href={`/editor?template=${id}`}
            className="rounded border border-border px-3 py-2 hover:bg-muted"
          >
            {template.label}
          </Link>
        ))}
        <Link
          href="/editor?sample=true"
          className="rounded border border-border px-3 py-2 hover:bg-muted"
        >
          New sample project
        </Link>
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="rounded border border-border px-3 py-2 hover:bg-muted disabled:opacity-50"
        >
          {busy ? "Importing…" : "Import source archive"}
        </button>
      </div>
      <input
        ref={input}
        type="file"
        aria-label="Import project archive"
        className="hidden"
        accept=".json,.weftly.json,.alove.json,application/json"
        onChange={(event) => {
          void importSource(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
