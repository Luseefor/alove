import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubSync } from "@/components/latex-ide/GitHubSync";
import { useWorkbenchStore } from "@/stores/workbenchStore";

const userMock = vi.hoisted(() => ({ user: null as unknown }));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => userMock,
}));

const HEAD_A = "a".repeat(40);

function seedCloud(extra: Record<string, unknown> = {}) {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
  useWorkbenchStore.setState({
    projectId: "cloud-1",
    projectRole: "owner",
    activeFileId: "main.tex",
    openFiles: ["main.tex"],
    filesByPath: { "main.tex": "local main" },
    versionsByPath: { "main.tex": 3 },
    incarnationsByPath: { "main.tex": "row-1" },
    dirtyByPath: { "main.tex": false },
    saveStatus: "saved",
    mainFile: "main.tex",
    documentRevision: 7,
    // Cloud subscription baseline: mirrors the last Convex echo so the
    // pull merge below reconciles like production.
    remoteFiles: [{ path: "main.tex", content: "local main", version: 3, incarnation: "row-1" }],
    ...extra,
  });
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

describe("GitHubSync", () => {
  let container: HTMLDivElement;
  let root: Root;
  const fetchMock = vi.fn();

  beforeEach(() => {
    userMock.user = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("is truthful for local workspaces", () => {
    useWorkbenchStore.setState(useWorkbenchStore.getInitialState(), true);
    useWorkbenchStore.setState({ projectId: "local-1" });
    act(() => {
      root.render(<GitHubSync />);
    });
    expect(container.textContent).toMatch(/available for cloud projects/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers GitHub account connect when nothing is linked", async () => {
    seedCloud();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ connected: false, githubLinked: false }),
    );
    await act(async () => {
      root.render(<GitHubSync />);
    });
    expect(container.textContent).toMatch(/Connect GitHub account/);
  });

  it("authorizes repository sync through the existing GitHub sign-in account", async () => {
    seedCloud();
    const reauthorize = vi.fn().mockResolvedValue({ verification: {} });
    const createExternalAccount = vi.fn();
    userMock.user = {
      externalAccounts: [{
        provider: "github",
        verification: { status: "verified" },
        reauthorize,
      }],
      createExternalAccount,
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ connected: false, githubLinked: true }),
    );
    await act(async () => root.render(<GitHubSync />));
    const authorize = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Authorize GitHub sync",
    );
    expect(authorize).toBeTruthy();
    await act(async () => authorize!.click());
    expect(reauthorize).toHaveBeenCalledWith({
      redirectUrl: window.location.href,
      additionalScopes: ["repo"],
    });
    expect(createExternalAccount).not.toHaveBeenCalled();
  });

  it("previews and applies a pull into the store", async () => {
    seedCloud();
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/api/github/status"))
        return jsonResponse({
          connected: true,
          githubLinked: true,
          connection: {
            owner: "octo",
            repo: "docs",
            branch: "main",
            lastCommitSha: HEAD_A,
            trackedPaths: ["main.tex"],
            updatedAt: 1,
          },
          remoteHead: HEAD_A,
          inSync: true,
          needsInitialPull: false,
        });
      if (u.includes("/api/github/pull-preview"))
        return jsonResponse({
          remoteHead: HEAD_A,
          paths: [{ path: "main.tex", size: 5, sha: HEAD_A }],
          added: [],
          updated: ["main.tex"],
          removed: [],
          skipped: [],
          truncated: false,
          needsInitialImport: false,
        });
      if (u.includes("/api/github/pull-apply"))
        return jsonResponse({
          applied: true,
          remoteHead: HEAD_A,
          files: [{ path: "main.tex", content: "remote main", version: 4, incarnation: "row-1" }],
        });
      throw new Error(`unexpected ${u}`);
    });
    await act(async () => {
      root.render(<GitHubSync />);
    });
    const previewButton = Array.from(container.querySelectorAll("button")).find((b) =>
      /preview pull/i.test(b.textContent ?? ""),
    )!;
    await act(async () => {
      previewButton.click();
    });
    expect(container.textContent).toMatch(/may change/);
    const applyButton = Array.from(container.querySelectorAll("button")).find((b) =>
      /^apply pull$/i.test((b.textContent ?? "").trim()),
    )!;
    await act(async () => {
      applyButton.click();
    });
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toBe("remote main");
    expect(container.textContent).toMatch(/Pull applied/);
  });

  it("states which local-only files a pull keeps", async () => {
    seedCloud({
      filesByPath: { "main.tex": "local main", "scratch.tex": "local scratch" },
      versionsByPath: { "main.tex": 3, "scratch.tex": 1 },
      incarnationsByPath: { "main.tex": "row-1", "scratch.tex": "row-2" },
      dirtyByPath: { "main.tex": false, "scratch.tex": false },
      remoteFiles: [
        { path: "main.tex", content: "local main", version: 3, incarnation: "row-1" },
        { path: "scratch.tex", content: "local scratch", version: 1, incarnation: "row-2" },
      ],
    });
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/api/github/status"))
        return jsonResponse({
          connected: true,
          githubLinked: true,
          connection: {
            owner: "octo",
            repo: "docs",
            branch: "main",
            lastCommitSha: HEAD_A,
            trackedPaths: ["main.tex"],
            updatedAt: 1,
          },
          remoteHead: HEAD_A,
          inSync: true,
          needsInitialPull: false,
        });
      if (u.includes("/api/github/pull-preview"))
        return jsonResponse({
          remoteHead: HEAD_A,
          paths: [{ path: "main.tex", size: 5, sha: HEAD_A }],
          added: [],
          updated: ["main.tex"],
          removed: [],
          skipped: [],
          truncated: false,
          needsInitialImport: false,
        });
      throw new Error(`unexpected ${u}`);
    });
    await act(async () => {
      root.render(<GitHubSync />);
    });
    const previewButton = Array.from(container.querySelectorAll("button")).find((b) =>
      /preview pull/i.test(b.textContent ?? ""),
    )!;
    await act(async () => {
      previewButton.click();
    });
    expect(container.textContent).toMatch(/1 local-only file kept: scratch\.tex/);
  });

  it("refuses to pull while the store is dirty", async () => {
    seedCloud({
      filesByPath: { "main.tex": "unsaved draft" },
      dirtyByPath: { "main.tex": true },
      saveStatus: "unsaved",
    });
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/api/github/status"))
        return jsonResponse({
          connected: true,
          githubLinked: true,
          connection: {
            owner: "octo",
            repo: "docs",
            branch: "main",
            lastCommitSha: HEAD_A,
            trackedPaths: ["main.tex"],
            updatedAt: 1,
          },
          remoteHead: HEAD_A,
          inSync: true,
          needsInitialPull: false,
        });
      if (u.includes("/api/github/pull-preview"))
        return jsonResponse({
          remoteHead: HEAD_A,
          paths: [],
          added: [],
          updated: [],
          removed: [],
          skipped: [],
          truncated: false,
          needsInitialImport: false,
        });
      throw new Error(`must not reach ${u}`);
    });
    await act(async () => {
      root.render(<GitHubSync />);
    });
    const previewButton = Array.from(container.querySelectorAll("button")).find((b) =>
      /preview pull/i.test(b.textContent ?? ""),
    )!;
    await act(async () => {
      previewButton.click();
    });
    const applyButton = Array.from(container.querySelectorAll("button")).find((b) =>
      /^apply pull$/i.test((b.textContent ?? "").trim()),
    )!;
    await act(async () => {
      applyButton.click();
    });
    // prepareSourceReplacement fails: no pull-apply request is ever made and
    // the unsaved draft is preserved.
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/github/pull-apply"))).toBe(false);
    expect(useWorkbenchStore.getState().filesByPath["main.tex"]).toBe("unsaved draft");
    expect(container.textContent).toMatch(/Save your work|checkpointed/i);
  });

  it("names the first branch when the repository has none yet", async () => {
    seedCloud();
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/api/github/status"))
        return jsonResponse({ connected: false, githubLinked: true });
      if (u.includes("/api/github/repos"))
        return jsonResponse({ repos: [{ owner: "octo", name: "docs", private: false, defaultBranch: "main" }] });
      if (u.includes("/api/github/branches")) return jsonResponse({ branches: [] });
      if (u.includes("/api/github/connect")) return jsonResponse({ connection: {}, needsInitialPull: true });
      throw new Error(`unexpected ${u}`);
    });
    await act(async () => {
      root.render(<GitHubSync />);
    });
    const listButton = Array.from(container.querySelectorAll("button")).find((b) =>
      /list repositories/i.test(b.textContent ?? ""),
    )!;
    await act(async () => {
      listButton.click();
    });
    const repoSelect = container.querySelector('select[aria-label="Repository"]') as HTMLSelectElement | null;
    expect(repoSelect).toBeTruthy();
    await act(async () => {
      repoSelect!.value = "octo/docs";
      repoSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const branchInput = container.querySelector('input[aria-label="Branch name"]') as HTMLInputElement | null;
    expect(branchInput).toBeTruthy();
    expect(branchInput!.value).toBe("main");
    await act(async () => {
      branchInput!.value = "research";
      branchInput!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const connectButton = Array.from(container.querySelectorAll("button")).find((b) =>
      /connect repository/i.test(b.textContent ?? ""),
    )!;
    await act(async () => {
      connectButton.click();
    });
    const connectCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/api/github/connect"));
    expect(connectCall).toBeTruthy();
  });

  it("initializes an empty branch only with explicit confirmation", async () => {
    seedCloud();
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/api/github/status"))
        return jsonResponse({
          connected: true,
          githubLinked: true,
          connection: { owner: "octo", repo: "docs", branch: "main", trackedPaths: [], updatedAt: 1 },
          remoteHead: null,
          inSync: false,
          needsInitialPull: true,
        });
      if (u.includes("/api/github/push"))
        return jsonResponse({ pushed: true, recorded: true, commitSha: HEAD_A });
      throw new Error(`unexpected ${u}`);
    });
    await act(async () => {
      root.render(<GitHubSync />);
    });
    expect(container.textContent).toMatch(/No sync baseline yet/);
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(checkbox).toBeTruthy();
    expect(container.textContent).toMatch(/Initialize empty branch from saved source/);
    const initButton = Array.from(container.querySelectorAll("button")).find((b) =>
      /^initialize branch$/i.test((b.textContent ?? "").trim()),
    )! as HTMLButtonElement;
    expect(initButton.disabled).toBe(true);
    await act(async () => {
      checkbox!.click();
    });
    await act(async () => {
      initButton.click();
    });
    const pushCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/api/github/push"));
    expect(pushCall).toBeTruthy();
    expect(JSON.parse((pushCall![1] as { body: string }).body)).toMatchObject({ initializeBranch: true });
    expect(container.textContent).toMatch(/Initialized main as /);
  });
});
