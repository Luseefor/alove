"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { useWorkbenchStore } from "@/stores/workbenchStore";
import { prepareSourceReplacement } from "@/lib/prepareSourceReplacement";
import {
  GITHUB_OAUTH_SCOPES,
  type PullPreviewResponse,
  type SyncStatusResponse,
} from "@/lib/githubSync";

type RepoOption = { owner: string; name: string; private: boolean; defaultBranch: string };
type BranchOption = { name: string; sha: string };

type Notice = { kind: "error" | "info" | "ok"; text: string };

async function postJson<T>(url: string, body: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: T;
  try {
    data = (await res.json()) as T;
  } catch {
    data = { error: `Request failed (${res.status}).` } as T;
  }
  return { status: res.status, data };
}

function errorText(data: unknown, fallback: string): string {
  if (typeof data === "object" && data !== null && "error" in data && typeof (data as { error: unknown }).error === "string")
    return (data as { error: string }).error;
  return fallback;
}

/** Server-driven GitHub pull/push sync for cloud projects. The OAuth token
 *  never reaches this component: every GitHub call runs in API routes. */
export function GitHubSync() {
  const { user } = useUser();
  const projectId = useWorkbenchStore((s) => s.projectId);
  const projectRole = useWorkbenchStore((s) => s.projectRole);

  const [status, setStatus] = useState<SyncStatusResponse | null>(null);
  const [repos, setRepos] = useState<RepoOption[] | null>(null);
  const [branches, setBranches] = useState<BranchOption[] | null>(null);
  const [repoChoice, setRepoChoice] = useState("");
  const [branchChoice, setBranchChoice] = useState("");
  const [preview, setPreview] = useState<PullPreviewResponse | null>(null);
  const [previewSnapshot, setPreviewSnapshot] = useState<string[]>([]);
  const [importConfirmed, setImportConfirmed] = useState(false);
  const [initializeConfirmed, setInitializeConfirmed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const isLocal = !projectId || projectId.startsWith("local");
  const canEdit = projectRole === "owner" || projectRole === "editor";
  const isOwner = projectRole === "owner";

  const refreshStatus = useCallback(async () => {
    if (!projectId || isLocal) return;
    setBusy("status");
    try {
      const res = await fetch(`/api/github/status?projectId=${encodeURIComponent(projectId)}`);
      const data = (await res.json()) as SyncStatusResponse;
      if (!res.ok) throw new Error(errorText(data, "Could not load sync status."));
      setStatus(data);
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not load sync status." });
    } finally {
      setBusy(null);
    }
  }, [projectId, isLocal]);

  useEffect(() => {
    setStatus(null);
    setPreview(null);
    setPreviewSnapshot([]);
    setImportConfirmed(false);
    setInitializeConfirmed(false);
    if (projectId && !isLocal) void refreshStatus();
  }, [projectId, isLocal, refreshStatus]);

  if (isLocal) {
    return (
      <section data-testid="github-sync" aria-label="GitHub sync">
        <p className="text-xs text-muted-foreground">
          GitHub sync is available for cloud projects. Local workspaces stay on this device.
        </p>
      </section>
    );
  }

  const githubLinked =
    (status?.connected === false ? status.githubLinked : status && "githubLinked" in status ? status.githubLinked : false) ||
    Boolean(user?.externalAccounts?.some((a) => a.provider === "github" && a.verification?.status === "verified"));

  async function connectGitHubAccount() {
    if (!user) return;
    setBusy("oauth");
    setNotice(null);
    try {
      const existing = user.externalAccounts.find((account) => account.provider === "github");
      const authorization = {
        redirectUrl: window.location.href,
        additionalScopes: [...GITHUB_OAUTH_SCOPES],
      };
      const account = existing
        ? await existing.reauthorize(authorization)
        : await user.createExternalAccount({ strategy: "oauth_github", ...authorization });
      const url = account.verification?.externalVerificationRedirectURL;
      if (url) window.location.href = url instanceof URL ? url.href : String(url);
      else setNotice({ kind: "error", text: "GitHub did not return a verification URL." });
    } catch {
      setNotice({ kind: "error", text: "Could not start GitHub authorization." });
    } finally {
      setBusy(null);
    }
  }

  async function loadRepos() {
    setBusy("repos");
    setNotice(null);
    try {
      const res = await fetch("/api/github/repos");
      const data = (await res.json()) as { repos?: RepoOption[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not list repositories.");
      setRepos(data.repos ?? []);
      if ((data.repos ?? []).length === 0) setNotice({ kind: "info", text: "No repositories found on the connected GitHub account." });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not list repositories." });
    } finally {
      setBusy(null);
    }
  }

  async function loadBranches(owner: string, repo: string) {
    setBusy("branches");
    try {
      const res = await fetch(`/api/github/branches?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}`);
      const data = (await res.json()) as { branches?: BranchOption[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not list branches.");
      setBranches(data.branches ?? []);
      const names = (data.branches ?? []).map((b) => b.name);
      if (names.length === 0) {
        // A brand-new repository has no branches yet: the user names the
        // first branch below (GitHub defaults to `main`).
        setBranchChoice("main");
        return;
      }
      const def = repos?.find((r) => r.owner === owner && r.name === repo)?.defaultBranch;
      setBranchChoice(names.includes(def as string) ? (def as string) : (names[0] ?? ""));
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Could not list branches." });
    } finally {
      setBusy(null);
    }
  }

  function snapshot() {
    const s = useWorkbenchStore.getState();
    return Object.keys(s.filesByPath).map((path) => ({
      path,
      version: s.versionsByPath[path] ?? 0,
      ...(s.incarnationsByPath[path] !== undefined ? { incarnation: s.incarnationsByPath[path] } : {}),
    }));
  }

  async function ensureSaved(): Promise<boolean> {
    const s = useWorkbenchStore.getState();
    const gate = await prepareSourceReplacement({ expectedDocumentRevision: s.documentRevision });
    if (!gate.proceed) {
      setNotice({ kind: "error", text: gate.message ?? "Save your work before syncing." });
      return false;
    }
    return true;
  }

  async function doConnect() {
    if (!repoChoice || !branchChoice || !projectId) return;
    const [owner, ...rest] = repoChoice.split("/");
    setBusy("connect");
    setNotice(null);
    const { status: code, data } = await postJson<{ error?: string }>(`/api/github/connect`, {
      projectId,
      owner,
      repo: rest.join("/"),
      branch: branchChoice,
    });
    setBusy(null);
    if (code !== 200) {
      setNotice({ kind: "error", text: errorText(data, "Could not connect the repository.") });
      return;
    }
    setNotice({ kind: "ok", text: "Repository connected. Preview a pull to establish the sync baseline." });
    await refreshStatus();
  }

  async function doPreview() {
    if (!projectId) return;
    setBusy("preview");
    setNotice(null);
    setPreview(null);
    const snap = snapshot();
    const { status: code, data } = await postJson<PullPreviewResponse & { error?: string }>(
      `/api/github/pull-preview`,
      { projectId, snapshot: snap },
    );
    setBusy(null);
    if (code !== 200) {
      const raw = errorText(data, "Could not preview the pull.");
      // Keep the empty-branch guidance consistent with the initializer below.
      setNotice({
        kind: "error",
        text: /no commits yet/i.test(raw)
          ? "The remote branch has no commits yet. Initialize it below to push saved source first, or pick a branch with history."
          : raw,
      });
      return;
    }
    setPreview(data as PullPreviewResponse);
    setPreviewSnapshot(snap.map((s) => s.path));
  }

  async function doApplyPull() {
    if (!projectId || !preview) return;
    if (!(await ensureSaved())) return;
    if (preview.needsInitialImport && !importConfirmed) {
      setNotice({ kind: "error", text: "Confirm the initial import: it merges repository files into local source. Local-only files are kept." });
      return;
    }
    setBusy("apply");
    const { status: code, data } = await postJson<
      { applied?: boolean; files?: { path: string; content: string; version: number; incarnation: string }[]; error?: string; code?: string }
    >(`/api/github/pull-apply`, {
      projectId,
      remoteHead: preview.remoteHead,
      expected: snapshot(),
      ...(preview.needsInitialImport ? { importConfirmed: true } : {}),
    });
    setBusy(null);
    if (code !== 200 || !data.applied || !data.files) {
      setNotice({ kind: "error", text: errorText(data, "Could not apply the pull.") });
      return;
    }
    useWorkbenchStore.getState().mergeRemoteProject({ projectId, files: data.files });
    setPreview(null);
    setPreviewSnapshot([]);
    setImportConfirmed(false);
    setNotice({ kind: "ok", text: "Pull applied. Both the checkpoint and the new source are in history." });
    await refreshStatus();
  }

  async function doPush() {
    if (!projectId) return;
    if (!(await ensureSaved())) return;
    setBusy("push");
    setNotice(null);
    const base = preview?.remoteHead ?? (status && status.connected ? (status.connection.lastCommitSha ?? null) : null);
    const { status: code, data } = await postJson<
      { pushed?: boolean; recorded?: boolean; commitSha?: string; error?: string; code?: string }
    >(`/api/github/push`, { projectId, remoteHead: base, expected: snapshot() });
    setBusy(null);
    if (code === 200 && data.pushed && data.recorded) {
      setNotice({ kind: "ok", text: `Pushed as ${data.commitSha?.slice(0, 7)}.` });
      setPreview(null);
      await refreshStatus();
      return;
    }
    if (code === 200 && data.pushed && !data.recorded) {
      setNotice({
        kind: "error",
        text: `Push landed as ${data.commitSha?.slice(0, 7)} but the sync record did not update. Use Refresh to reconcile before syncing again.`,
      });
      await refreshStatus();
      return;
    }
    if (code === 200 && data.pushed === false) {
      setNotice({ kind: "ok", text: "Already in sync. Nothing to push." });
      return;
    }
    setNotice({ kind: "error", text: errorText(data, "Could not push.") });
  }

  async function doInitialize() {
    if (!projectId) return;
    if (!(await ensureSaved())) return;
    if (!initializeConfirmed) {
      setNotice({ kind: "error", text: "Confirm initialization: it publishes saved source as the first commit." });
      return;
    }
    setBusy("initialize");
    setNotice(null);
    const { status: code, data } = await postJson<
      { pushed?: boolean; recorded?: boolean; commitSha?: string; error?: string; code?: string }
    >(`/api/github/push`, { projectId, expected: snapshot(), initializeBranch: true });
    setBusy(null);
    const branch = status && status.connected ? status.connection.branch : "branch";
    if (code === 200 && data.pushed && data.recorded) {
      setNotice({ kind: "ok", text: `Initialized ${branch} as ${data.commitSha?.slice(0, 7)}.` });
      setInitializeConfirmed(false);
      await refreshStatus();
      return;
    }
    if (code === 200 && data.pushed && !data.recorded) {
      setNotice({
        kind: "error",
        text: `Branch created as ${data.commitSha?.slice(0, 7)} but the sync record did not update. Use Refresh to reconcile before syncing again.`,
      });
      await refreshStatus();
      return;
    }
    setNotice({ kind: "error", text: errorText(data, "Could not initialize the branch.") });
  }

  async function doRefresh() {
    if (!projectId) return;
    setBusy("refresh");
    const { status: code, data } = await postJson<{ refreshed?: boolean; error?: string }>(
      `/api/github/refresh`,
      { projectId },
    );
    setBusy(null);
    if (code !== 200) {
      setNotice({ kind: "error", text: errorText(data, "Could not refresh. Pull the remote changes instead.") });
      return;
    }
    setNotice({
      kind: "ok",
      text: data.refreshed ? "Baseline reconciled with the remote head." : "Already at the remote head.",
    });
    await refreshStatus();
  }

  async function doDisconnect() {
    if (!projectId) return;
    setBusy("disconnect");
    await postJson(`/api/github/disconnect`, { projectId });
    setBusy(null);
    setRepos(null);
    setBranches(null);
    setPreview(null);
    await refreshStatus();
  }

  const connected = status?.connected === true;
  const needsInitialPull = connected && status.needsInitialPull;

  return (
    <section data-testid="github-sync" aria-label="GitHub sync" className="flex flex-col gap-2">
      {notice && (
        <p role={notice.kind === "error" ? "alert" : "status"} className="text-xs text-muted-foreground">
          {notice.text}
        </p>
      )}
      <button
        type="button"
        disabled={busy !== null || !user}
        onClick={() => void connectGitHubAccount()}
        className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
      >
        {busy === "oauth"
          ? "Opening GitHub…"
          : githubLinked
            ? "Authorize GitHub sync"
            : "Connect GitHub account"}
      </button>
      {!connected ? (
        <div className="flex flex-col gap-2">
          {githubLinked && (
            <>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void loadRepos()}
                className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
              >
                List repositories
              </button>
              {repos && (
                <label className="flex flex-col gap-1 text-xs">
                  Repository
                  <select
                    aria-label="Repository"
                    value={repoChoice}
                    onChange={(e) => {
                      setRepoChoice(e.target.value);
                      setBranches(null);
                      const [owner, ...rest] = e.target.value.split("/");
                      if (owner && rest.length > 0) void loadBranches(owner, rest.join("/"));
                    }}
                    className="rounded border border-border bg-background px-1 py-1 text-xs"
                  >
                    <option value="">Select a repository…</option>
                    {repos.map((r) => (
                      <option key={`${r.owner}/${r.name}`} value={`${r.owner}/${r.name}`}>
                        {r.owner}/{r.name}
                        {r.private ? " (private)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {branches && branches.length > 0 && (
                <label className="flex flex-col gap-1 text-xs">
                  Branch
                  <select
                    aria-label="Branch"
                    value={branchChoice}
                    onChange={(e) => setBranchChoice(e.target.value)}
                    className="rounded border border-border bg-background px-1 py-1 text-xs"
                  >
                    {branches.map((b) => (
                      <option key={b.name} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {branches && branches.length === 0 && (
                <label className="flex flex-col gap-1 text-xs">
                  Branch name
                  <input
                    aria-label="Branch name"
                    value={branchChoice}
                    onChange={(e) => setBranchChoice(e.target.value)}
                    placeholder="main"
                    className="rounded border border-border bg-background px-1 py-1 text-xs"
                  />
                  <span className="text-muted-foreground">This repository has no branches yet; the name above becomes its first branch.</span>
                </label>
              )}
              {isOwner ? (
                <button
                  type="button"
                  disabled={busy !== null || !repoChoice || !branchChoice}
                  onClick={() => void doConnect()}
                  className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
                >
                  Connect repository
                </button>
              ) : (
                <p className="text-xs text-muted-foreground">Only the project owner can connect a repository.</p>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2" data-testid="github-sync-connected">
          <p className="text-xs">
            {status.connection.owner}/{status.connection.repo} · {status.connection.branch}
          </p>
          <p className="text-xs text-muted-foreground" role="status">
            {needsInitialPull
              ? "No sync baseline yet. Preview a pull to merge the remote tree into local source, or initialize the empty branch below."
              : status.inSync
                ? "Remote branch unchanged since last sync. Push to publish local changes."
                : status.remoteHead
                  ? "Remote head differs from the last sync."
                  : "Remote head unavailable."}
          </p>
          {needsInitialPull && canEdit && (
            <div className="flex flex-col gap-1 text-xs" data-testid="github-init-branch">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={initializeConfirmed}
                  onChange={(e) => setInitializeConfirmed(e.target.checked)}
                />
                Initialize empty branch from saved source
              </label>
              <button
                type="button"
                disabled={busy !== null || !initializeConfirmed}
                onClick={() => void doInitialize()}
                className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
              >
                Initialize branch
              </button>
            </div>
          )}
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void doPreview()}
                className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
              >
                Preview pull
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void doPush()}
                className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
              >
                Push
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void doRefresh()}
                className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
              >
                Refresh
              </button>
              {isOwner && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void doDisconnect()}
                  className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
                >
                  Disconnect
                </button>
              )}
            </div>
          )}
          {preview && (
            <div className="flex flex-col gap-1 text-xs" data-testid="github-pull-preview">
              <p>
                {preview.added.length} added · {preview.updated.length} may change · {preview.removed.length} removed
                {preview.skipped.length > 0 ? ` · ${preview.skipped.length} skipped` : ""}
              </p>
              {(() => {
                const remote = new Set(preview.paths.map((p) => p.path));
                const kept = previewSnapshot.filter((p) => !remote.has(p) && !preview.removed.includes(p));
                return kept.length > 0 ? (
                  <p className="text-muted-foreground">
                    {kept.length} local-only file{kept.length === 1 ? "" : "s"} kept: {kept.slice(0, 5).join(", ")}
                    {kept.length > 5 ? "…" : ""}
                  </p>
                ) : null;
              })()}
              {preview.needsInitialImport && (
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={importConfirmed}
                    onChange={(e) => setImportConfirmed(e.target.checked)}
                  />
                  Merge repository tree into local source (initial import)
                </label>
              )}
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void doApplyPull()}
                className="rounded border border-border px-2 py-1 text-xs disabled:opacity-50"
              >
                Apply pull
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
