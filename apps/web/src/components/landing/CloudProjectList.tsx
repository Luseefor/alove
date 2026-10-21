"use client";

import Link from "next/link";
import React, { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { TEMPLATES } from "@/lib/templates";
import { parseWorkspaceSource } from "@/lib/workspaceArchive";
import {
  MAX_FILES,
  MAX_PROJECT_BYTES,
  PROJECT_TOO_LARGE_ERROR,
  TOO_MANY_FILES_ERROR,
  checkFileSize,
  checkProjectPath,
  findPathCollision,
  utf8ByteLength,
} from "@/lib/cloudProjectLimits";

const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;

type CloudImportPayload = {
  name: string;
  mainFile: string | null;
  files: Array<{ path: string; content: string }>;
};

function buildCloudImportPayload(source: {
  title: string;
  files: Record<string, string>;
  mainFile: string | null;
}): CloudImportPayload {
  const title = source.title.trim();
  if (!title || title.length > 200) {
    throw new Error("Project name must be 1-200 characters");
  }
  const entries = Object.entries(source.files);
  if (entries.length > MAX_FILES) {
    throw new Error(TOO_MANY_FILES_ERROR);
  }
  if (entries.length < 1) {
    throw new Error("Project must contain 1-250 files.");
  }
  const paths = entries.map(([path]) => path);
  let total = 0;
  for (const [path, content] of entries) {
    const check = checkProjectPath(path);
    if (!check.ok) {
      throw new Error(check.error);
    }
    const sizeError = checkFileSize(path, content);
    if (sizeError) {
      throw new Error(sizeError);
    }
    total += utf8ByteLength(content);
    if (total > MAX_PROJECT_BYTES) {
      throw new Error(PROJECT_TOO_LARGE_ERROR);
    }
  }
  for (const path of paths) {
    const collision = findPathCollision(path, paths, path);
    if (collision) {
      throw new Error(collision);
    }
  }
  return {
    name: title,
    mainFile: source.mainFile,
    files: entries.map(([path, content]) => ({ path, content })),
  };
}

type CloudProject = Doc<"projects"> & { role?: "owner" | "editor" | "viewer" };
type BusyKind = "rename" | "delete";
type LastAction =
  | { kind: "rename"; project: CloudProject; name: string }
  | { kind: "delete"; project: CloudProject };

function sortByUpdatedAtDesc(items: CloudProject[]): CloudProject[] {
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt);
}

function formatUpdatedAt(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleString();
}

export function CloudProjectList() {
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  const router = useRouter();
  const projects = useQuery(
    api.projects.listMine,
    isAuthenticated ? {} : "skip",
  );
  const invitations = useQuery(api.members.pending, isAuthenticated ? {} : "skip");
  const acceptInvitation = useMutation(api.members.accept);
  const renameProject = useMutation(api.projects.rename);
  const removeProject = useMutation(api.projects.remove);
  const importSource = useMutation(api.projects.importSource);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [lastImport, setLastImport] = useState<CloudImportPayload | null>(null);

  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<BusyKind | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);

  const normalizedQuery = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const all = projects ?? [];
    const filtered = normalizedQuery
      ? all.filter((p) => p.name.toLowerCase().includes(normalizedQuery))
      : all;
    return sortByUpdatedAtDesc(filtered);
  }, [projects, normalizedQuery]);

  function startRename(project: CloudProject) {
    setActionError(null);
    setLastAction(null);
    setRenamingId(project._id);
    setDraftTitle(project.name);
  }

  function cancelRename() {
    if (busyId !== null) return;
    setRenamingId(null);
    setDraftTitle("");
  }

  function clearError() {
    setActionError(null);
    setLastAction(null);
  }

  async function runRename(project: CloudProject, name: string) {
    setBusyId(project._id);
    setBusyKind("rename");
    setActionError(null);
    try {
      await renameProject({ projectId: project._id, name });
      setRenamingId(null);
      setDraftTitle("");
      setLastAction(null);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Rename failed.",
      );
      setLastAction({ kind: "rename", project, name });
    } finally {
      setBusyId(null);
      setBusyKind(null);
    }
  }

  async function confirmRename(project: CloudProject) {
    const nextTitle = draftTitle.trim();
    if (!nextTitle || nextTitle.length > 200) {
      setActionError("Title must be 1 to 200 characters.");
      setLastAction(null);
      return;
    }
    await runRename(project, nextTitle);
  }

  async function runDelete(project: CloudProject) {
    setBusyId(project._id);
    setBusyKind("delete");
    setActionError(null);
    try {
      await removeProject({ projectId: project._id });
      if (renamingId === project._id) {
        setRenamingId(null);
        setDraftTitle("");
      }
      setLastAction(null);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Delete failed.",
      );
      setLastAction({ kind: "delete", project });
    } finally {
      setBusyId(null);
      setBusyKind(null);
    }
  }

  async function confirmDelete(project: CloudProject) {
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      const ok = window.confirm(
        `Delete "${project.name}"? Project files are deleted too. This cannot be undone.`,
      );
      if (!ok) return;
    }
    await runDelete(project);
  }

  async function retryLastAction() {
    if (!lastAction) {
      clearError();
      return;
    }
    if (lastAction.kind === "rename") {
      await runRename(lastAction.project, lastAction.name);
    } else {
      await runDelete(lastAction.project);
    }
  }

  async function runCloudImport(payload: CloudImportPayload) {
    setImportBusy(true);
    setImportError(null);
    try {
      const projectId = await importSource(payload);
      setLastImport(null);
      router.push(`/editor?project=${encodeURIComponent(projectId)}`);
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : "Import failed. Existing projects are unchanged.",
      );
      setLastImport(payload);
    } finally {
      setImportBusy(false);
    }
  }

  async function handleImportFile(file?: File | null) {
    if (!file) return;
    setImportBusy(true);
    setImportError(null);
    setLastImport(null);
    try {
      if (file.size > MAX_ARCHIVE_BYTES) {
        throw new Error("Archive too large (maximum 20 MB).");
      }
      const source = parseWorkspaceSource(await file.text());
      const payload = buildCloudImportPayload(source);
      try {
        const projectId = await importSource(payload);
        setLastImport(null);
        router.push(`/editor?project=${encodeURIComponent(projectId)}`);
      } catch (error) {
        setImportError(
          error instanceof Error
            ? error.message
            : "Import failed. Existing projects are unchanged.",
        );
        setLastImport(payload);
      }
    } catch (error) {
      setImportError(
        error instanceof Error
          ? error.message
          : "Import failed. Existing projects are unchanged.",
      );
      setLastImport(null);
    } finally {
      setImportBusy(false);
    }
  }

  async function retryImport() {
    if (!lastImport) {
      setImportError(null);
      return;
    }
    await runCloudImport(lastImport);
  }

  function dismissImportError() {
    setImportError(null);
    setLastImport(null);
  }

  return (
    <section aria-labelledby="cloud-projects-heading" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="px-2">
          <h2
            id="cloud-projects-heading"
            className="text-overline text-muted-foreground opacity-80"
          >
            Cloud projects
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <UserButton />
        </div>
      </div>

      {invitations?.map(invitation => <div key={invitation._id} className="flex flex-wrap items-center gap-3 rounded border border-border p-3 text-sm"><span className="flex-1">Invitation: {invitation.projectName} ({invitation.role})</span><button type="button" className="rounded border px-3 py-2 hover:bg-muted" onClick={() => { void acceptInvitation({ invitationId: invitation._id }).then(id => router.push(`/editor?project=${encodeURIComponent(id)}`)).catch(() => setActionError("Could not accept invitation. It may have expired or been revoked.")); }}>Accept invitation</button></div>)}

      <div className="flex flex-wrap gap-2 text-xs">
        <Link
          href="/editor?new=true"
          className="inline-flex items-center justify-center rounded-2xl bg-primary px-4 py-2 text-[11px] font-black uppercase tracking-widest text-primary-foreground transition-opacity hover:opacity-85"
        >
          New blank project
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
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <label
            htmlFor="cloud-project-import"
            className="text-[11px] font-black uppercase tracking-widest text-muted-foreground"
          >
            Import source archive
          </label>
          <input
            id="cloud-project-import"
            ref={importInputRef}
            type="file"
            accept=".json,.alove.json,application/json"
            disabled={importBusy}
            onChange={(event) => {
              void handleImportFile(event.target.files?.[0]);
              event.target.value = "";
            }}
            className="text-[12px] font-bold text-muted-foreground file:mr-2 file:rounded file:border file:border-border file:bg-background file:px-3 file:py-2 file:text-[11px] file:font-black file:uppercase file:tracking-widest file:text-foreground hover:file:bg-muted disabled:opacity-50"
          />
          <button
            type="button"
            disabled={importBusy}
            onClick={() => importInputRef.current?.click()}
            className="inline-flex items-center justify-center rounded-2xl border border-border bg-background px-3 py-2 text-[11px] font-black uppercase tracking-widest text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {importBusy ? "Importing..." : "Import source archive"}
          </button>
        </div>
        {importBusy ? (
          <p
            role="status"
            className="text-[12px] font-bold text-muted-foreground"
          >
            Importing archive...
          </p>
        ) : null}
        {importError ? (
          <div className="rounded-2xl border border-error-border bg-error-bg px-4 py-3">
            <p role="alert" className="text-[12px] font-bold text-error">
              {importError}
            </p>
            <div className="mt-2 flex gap-2">
              {lastImport ? (
                <button
                  type="button"
                  onClick={() => void retryImport()}
                  className="inline-flex items-center justify-center rounded-2xl border border-border bg-background px-3 py-2 text-[11px] font-black uppercase tracking-widest text-foreground transition-colors hover:bg-muted"
                >
                  Retry import
                </button>
              ) : null}
              <button
                type="button"
                onClick={dismissImportError}
                aria-label="Dismiss import error"
                className="inline-flex items-center justify-center rounded-2xl border border-border bg-background px-3 py-2 text-[11px] font-black uppercase tracking-widest text-foreground transition-colors hover:bg-muted"
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor="cloud-project-search" className="sr-only">
          Search projects by title
        </label>
        <input
          id="cloud-project-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search projects by title..."
          className="w-full rounded-2xl border border-border bg-background px-4 py-2 text-[13px] font-bold text-foreground placeholder:text-muted-foreground placeholder:font-bold focus:outline-2 focus:outline-primary sm:max-w-xs"
        />
      </div>

      <div aria-live="polite" className="sr-only">
        {authLoading
          ? "Checking sign in."
          : !isAuthenticated
            ? "Sign in required."
            : projects === undefined
              ? "Loading cloud projects."
              : `${visible.length} cloud projects.`}
      </div>

      {actionError ? (
        <div className="rounded-2xl border border-error-border bg-error-bg px-4 py-3">
          <p
            role="alert"
            className="text-[12px] font-bold text-error"
          >
            {actionError}
          </p>
          <div className="mt-2 flex gap-2">
            {lastAction ? (
              <button
                type="button"
                onClick={() => void retryLastAction()}
                className="inline-flex items-center justify-center rounded-2xl border border-border bg-background px-3 py-2 text-[11px] font-black uppercase tracking-widest text-foreground transition-colors hover:bg-muted"
              >
                Retry
              </button>
            ) : null}
            <button
              type="button"
              onClick={clearError}
              aria-label="Dismiss error"
              className="inline-flex items-center justify-center rounded-2xl border border-border bg-background px-3 py-2 text-[11px] font-black uppercase tracking-widest text-foreground transition-colors hover:bg-muted"
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}

      {authLoading ? (
        <div className="rounded-shell border border-border bg-background p-10 shadow-sm">
          <p role="status" className="text-[13px] font-bold text-muted-foreground">
            Checking sign in...
          </p>
        </div>
      ) : !isAuthenticated ? (
        <div className="rounded-shell border border-border bg-background p-10 text-center shadow-sm">
          <p className="text-[14px] font-black text-foreground">
            Sign in to see your cloud projects
          </p>
          <p className="mt-1 text-[12px] font-bold text-muted-foreground">
            Your projects load after sign in completes.
          </p>
        </div>
      ) : projects === undefined ? (
        <div className="rounded-shell border border-border bg-background p-10 shadow-sm">
          <p role="status" className="text-[13px] font-bold text-muted-foreground">
            Loading cloud projects...
          </p>
        </div>
      ) : projects.length === 0 ? (
        <div className="rounded-shell border border-border bg-background p-10 text-center shadow-sm">
          <p className="text-[14px] font-black text-foreground">
            No cloud projects yet
          </p>
          <p className="mt-1 text-[12px] font-bold text-muted-foreground">
            Create a project to see it listed here.
          </p>
          <Link
            href="/editor?new=true"
            className="mt-4 inline-flex items-center justify-center rounded-2xl bg-primary px-4 py-2 text-[11px] font-black uppercase tracking-widest text-primary-foreground transition-opacity hover:opacity-85"
          >
            New blank project
          </Link>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-shell border border-border bg-background p-10 text-center shadow-sm">
          <p className="text-[14px] font-black text-foreground">
            No projects match &quot;{query.trim()}&quot;
          </p>
          <p className="mt-1 text-[12px] font-bold text-muted-foreground">
            Try a different title search.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-shell border border-border bg-background shadow-sm">
          <ul className="divide-y divide-zinc-50">
            {visible.map((project) => {
              const isBusy = busyId === project._id;
              const isRenaming = renamingId === project._id;
              return (
                <li
                  key={project._id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-5"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    {isRenaming ? (
                      <div className="flex flex-col gap-2">
                        <label
                          htmlFor={`rename-${project._id}`}
                          className="text-[11px] font-black uppercase tracking-widest text-muted-foreground"
                        >
                          New title for {project.name}
                        </label>
                        <input
                          id={`rename-${project._id}`}
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
                        href={`/editor?project=${encodeURIComponent(project._id)}`}
                        className="block truncate text-[14px] font-black tracking-tight text-foreground hover:text-primary"
                      >
                        {project.name || "Untitled project"}
                      </Link>
                    )}
                    <p className="truncate text-[12px] font-bold uppercase tracking-wider text-muted-foreground">
                      {formatUpdatedAt(project.updatedAt)} · {project.role ?? "owner"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {isRenaming ? (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void confirmRename(project)}
                          aria-label={`Save new title for ${project.name}`}
                          className="inline-flex items-center justify-center rounded-2xl bg-primary px-3 py-2 text-[11px] font-black uppercase tracking-widest text-primary-foreground transition-opacity hover:opacity-85 disabled:opacity-50"
                        >
                          {isBusy && busyKind === "rename"
                            ? "Saving..."
                            : "Save"}
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={cancelRename}
                          aria-label={`Cancel renaming ${project.name}`}
                          className="inline-flex items-center justify-center rounded-2xl border border-border bg-background px-3 py-2 text-[11px] font-black uppercase tracking-widest text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <Link
                          href={`/editor?project=${encodeURIComponent(project._id)}`}
                          aria-label={`Open ${project.name || "untitled project"}`}
                          className="inline-flex items-center justify-center rounded-2xl border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] font-black uppercase tracking-widest text-primary transition-colors hover:bg-background"
                        >
                          Open
                        </Link>
                        <button
                          type="button"
                          disabled={isBusy || project.role === "viewer"}
                          onClick={() => startRename(project)}
                          aria-label={`Rename ${project.name || "untitled project"}`}
                          className="inline-flex items-center justify-center rounded-2xl border border-border bg-background px-3 py-2 text-[11px] font-black uppercase tracking-widest text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          disabled={isBusy || (project.role !== undefined && project.role !== "owner")}
                          onClick={() => void confirmDelete(project)}
                          aria-label={`Delete ${project.name || "untitled project"}`}
                          className="inline-flex items-center justify-center rounded-2xl border border-error-border bg-error-bg px-3 py-2 text-[11px] font-black uppercase tracking-widest text-error transition-colors hover:bg-background disabled:opacity-50"
                        >
                          {isBusy && busyKind === "delete"
                            ? "Deleting..."
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
      )}
    </section>
  );
}
