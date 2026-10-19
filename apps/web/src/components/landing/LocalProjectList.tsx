"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  createLocalWorkspaceRepository,
  type LocalWorkspace,
} from "@/lib/localWorkspace";

export type LocalProjectSummary = {
  id: string;
  title: string;
  mainFile: string | null;
  updatedAt: number;
  revision: number;
  fileCount: number;
  unavailableReason?: string;
};

export type LocalProjectRepository = {
  list: () => Promise<LocalProjectSummary[]>;
  load: (id: string) => Promise<LocalWorkspace | null>;
  save: (
    input: Omit<LocalWorkspace, "schemaVersion" | "revision" | "updatedAt">,
    expectedRevision: number,
  ) => Promise<LocalWorkspace>;
  remove: (id: string, expectedRevision: number) => Promise<void>;
};

function getDefaultRepository(): LocalProjectRepository {
  return createLocalWorkspaceRepository();
}

function sortByUpdatedAtDesc(
  items: LocalProjectSummary[],
): LocalProjectSummary[] {
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt);
}

function formatUpdatedAt(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString();
}

export function LocalProjectList({
  repository,
}: {
  repository?: LocalProjectRepository;
}) {
  const repo = useMemo<LocalProjectRepository>(
    () => repository ?? getDefaultRepository(),
    [repository],
  );
  const [projects, setProjects] = useState<LocalProjectSummary[] | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<"rename" | "delete" | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const refresh = useCallback(async () => {
    setStatus("loading");
    setLoadError(null);
    try {
      const items = await repo.list();
      setProjects(sortByUpdatedAtDesc(items));
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setLoadError(
        error instanceof Error ? error.message : "Could not load projects.",
      );
    }
  }, [repo]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("loading");
      setLoadError(null);
      try {
        const items = await repo.list();
        if (!cancelled) {
          setProjects(sortByUpdatedAtDesc(items));
          setStatus("ready");
        }
      } catch (error) {
        if (!cancelled) {
          setStatus("error");
          setLoadError(
            error instanceof Error ? error.message : "Could not load projects.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repo, refresh]);

  const normalizedQuery = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const all = projects ?? [];
    const filtered = normalizedQuery
      ? all.filter((p) => p.title.toLowerCase().includes(normalizedQuery))
      : all;
    return sortByUpdatedAtDesc(filtered);
  }, [projects, normalizedQuery]);

  function startRename(summary: LocalProjectSummary) {
    setActionError(null);
    setRenamingId(summary.id);
    setDraftTitle(summary.title);
  }

  function cancelRename() {
    if (busyId !== null) return;
    setRenamingId(null);
    setDraftTitle("");
  }

  async function confirmRename(summary: LocalProjectSummary) {
    const nextTitle = draftTitle.trim();
    if (!nextTitle || nextTitle.length > 200) {
      setActionError("Title must be 1–200 characters.");
      return;
    }
    setBusyId(summary.id);
    setBusyKind("rename");
    setActionError(null);
    try {
      const latest = await repo.load(summary.id);
      if (!latest) {
        throw new Error("Project no longer exists. Reload the list.");
      }
      if (latest.revision !== summary.revision) {
        throw new Error(
          "Project changed elsewhere. Reload the list and try again.",
        );
      }
      await repo.save(
        {
          id: latest.id,
          title: nextTitle,
          files: latest.files,
          mainFile: latest.mainFile,
          activeFile: latest.activeFile,
          openFiles: latest.openFiles,
        },
        latest.revision,
      );
      const refreshed = await repo.list();
      setProjects(sortByUpdatedAtDesc(refreshed));
      setRenamingId(null);
      setDraftTitle("");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Rename failed.");
    } finally {
      setBusyId(null);
      setBusyKind(null);
    }
  }

  async function confirmDelete(summary: LocalProjectSummary) {
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      const ok = window.confirm(
        `Delete "${summary.title}"? This cannot be undone.`,
      );
      if (!ok) return;
    }
    setBusyId(summary.id);
    setBusyKind("delete");
    setActionError(null);
    try {
      await repo.remove(summary.id, summary.revision);
      const refreshed = await repo.list();
      setProjects(sortByUpdatedAtDesc(refreshed));
      if (renamingId === summary.id) {
        setRenamingId(null);
        setDraftTitle("");
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setBusyId(null);
      setBusyKind(null);
    }
  }

  return (
    <section aria-labelledby="local-projects-heading" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="px-2">
          <h2
            id="local-projects-heading"
            className="text-overline text-muted-foreground opacity-80"
          >
            Saved projects
          </h2>
        </div>
        <Link
          href="/editor?new=true"
          className="inline-flex items-center justify-center rounded-2xl bg-primary px-4 py-2 text-[11px] font-black uppercase tracking-widest text-primary-foreground transition-opacity hover:opacity-85"
        >
          New project
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor="local-project-search" className="sr-only">
          Search projects by title
        </label>
        <input
          id="local-project-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search projects by title…"
          className="w-full rounded-2xl border border-border bg-background px-4 py-2 text-[13px] font-bold text-foreground placeholder:text-muted-foreground placeholder:font-bold focus:outline-2 focus:outline-primary sm:max-w-xs"
        />
      </div>

      <div aria-live="polite" className="sr-only">
        {status === "loading"
          ? "Loading saved projects."
          : `${visible.length} saved projects.`}
      </div>

      {actionError ? (
        <p
          role="alert"
          className="rounded-2xl border border-error-border bg-error-bg px-4 py-3 text-[12px] font-bold text-error"
        >
          {actionError}
        </p>
      ) : null}

      {status === "loading" && projects === null ? (
        <div className="rounded-shell border border-border bg-background p-10 shadow-sm">
          <p className="text-[13px] font-bold text-muted-foreground">
            Loading saved projects…
          </p>
        </div>
      ) : null}

      {status === "error" && projects === null ? (
        <div className="rounded-shell border border-border bg-background p-10 shadow-sm">
          <p role="alert" className="text-[13px] font-bold text-foreground">
            Could not load saved projects{loadError ? `: ${loadError}` : "."}
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-4 inline-flex items-center justify-center rounded-2xl border border-border bg-background px-4 py-2 text-[11px] font-black uppercase tracking-widest text-foreground transition-colors hover:bg-muted"
          >
            Retry
          </button>
        </div>
      ) : null}

      {status !== "loading" || projects !== null ? (
        <>
          {projects !== null && projects.length === 0 ? (
            <div className="rounded-shell border border-border bg-background p-10 text-center shadow-sm">
              <p className="text-[14px] font-black text-foreground">
                No saved projects yet
              </p>
              <p className="mt-1 text-[12px] font-bold text-muted-foreground">
                Create a project to see it listed here.
              </p>
              <Link
                href="/editor?new=true"
                className="mt-4 inline-flex items-center justify-center rounded-2xl bg-primary px-4 py-2 text-[11px] font-black uppercase tracking-widest text-primary-foreground transition-opacity hover:opacity-85"
              >
                New project
              </Link>
            </div>
          ) : projects !== null && visible.length === 0 ? (
            <div className="rounded-shell border border-border bg-background p-10 text-center shadow-sm">
              <p className="text-[14px] font-black text-foreground">
                No projects match “{query.trim()}”
              </p>
              <p className="mt-1 text-[12px] font-bold text-muted-foreground">
                Try a different title search.
              </p>
            </div>
          ) : projects !== null && visible.length > 0 ? (
            <div className="overflow-hidden rounded-shell border border-border bg-background shadow-sm">
              <ul className="divide-y divide-zinc-50">
                {visible.map((project) => {
                  if (project.unavailableReason)
                    return (
                      <li
                        key={project.id}
                        role="status"
                        className="p-4 text-xs text-muted-foreground"
                      >
                        Unavailable stored project · {project.id}:{" "}
                        {project.unavailableReason}. Stored data is unchanged.
                      </li>
                    );
                  const isBusy = busyId === project.id;
                  const isRenaming = renamingId === project.id;
                  return (
                    <li
                      key={project.id}
                      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-5"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        {isRenaming ? (
                          <div className="flex flex-col gap-2">
                            <label
                              htmlFor={`rename-${project.id}`}
                              className="text-[11px] font-black uppercase tracking-widest text-muted-foreground"
                            >
                              New title for {project.title}
                            </label>
                            <input
                              id={`rename-${project.id}`}
                              type="text"
                              value={draftTitle}
                              maxLength={200}
                              disabled={isBusy}
                              onChange={(event) =>
                                setDraftTitle(event.target.value)
                              }
                              className="w-full rounded-2xl border border-border bg-background px-3 py-2 text-[13px] font-bold text-foreground focus:outline-2 focus:outline-primary disabled:opacity-50"
                            />
                          </div>
                        ) : (
                          <Link
                            href={`/editor?project=${encodeURIComponent(project.id)}`}
                            className="block truncate text-[14px] font-black tracking-tight text-foreground hover:text-primary"
                          >
                            {project.title || "Untitled project"}
                          </Link>
                        )}
                        <p className="truncate text-[12px] font-bold uppercase tracking-wider text-muted-foreground">
                          {project.mainFile ?? "No main file"} ·{" "}
                          {project.fileCount}{" "}
                          {project.fileCount === 1 ? "file" : "files"} ·{" "}
                          {formatUpdatedAt(project.updatedAt)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        {isRenaming ? (
                          <>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void confirmRename(project)}
                              aria-label={`Save new title for ${project.title}`}
                              className="inline-flex items-center justify-center rounded-2xl bg-primary px-3 py-2 text-[11px] font-black uppercase tracking-widest text-primary-foreground transition-opacity hover:opacity-85 disabled:opacity-50"
                            >
                              {isBusy && busyKind === "rename"
                                ? "Saving…"
                                : "Save"}
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={cancelRename}
                              aria-label={`Cancel renaming ${project.title}`}
                              className="inline-flex items-center justify-center rounded-2xl border border-border bg-background px-3 py-2 text-[11px] font-black uppercase tracking-widest text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <Link
                              href={`/editor?project=${encodeURIComponent(project.id)}`}
                              aria-label={`Open ${project.title || "untitled project"}`}
                              className="inline-flex items-center justify-center rounded-2xl border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-primary transition-colors hover:bg-background"
                            >
                              Open
                            </Link>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => startRename(project)}
                              aria-label={`Rename ${project.title || "untitled project"}`}
                              className="inline-flex items-center justify-center rounded-2xl border border-border bg-background px-3 py-2 text-[11px] font-black uppercase tracking-widest text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void confirmDelete(project)}
                              aria-label={`Delete ${project.title || "untitled project"}`}
                              className="inline-flex items-center justify-center rounded-2xl border border-error-border bg-error-bg px-3 py-2 text-[11px] font-black uppercase tracking-widest text-error transition-colors hover:bg-background disabled:opacity-50"
                            >
                              {isBusy && busyKind === "delete"
                                ? "Deleting…"
                                : "Delete"}
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
