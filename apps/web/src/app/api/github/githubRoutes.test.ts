import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const githubServer = vi.hoisted(() => {
  class MockGitHubError extends Error {
    status: number;
    constructor(message: string, status = 502) {
      super(message);
      this.status = status;
    }
  }
  return {
    GitHubError: MockGitHubError,
    getGitHubToken: vi.fn(),
    getBranchHead: vi.fn(),
    getCommitTreeSha: vi.fn(),
    getTreeRecursive: vi.fn(),
    getBlob: vi.fn(),
    createBlob: vi.fn(),
    createTree: vi.fn(),
    createRootTree: vi.fn(),
    createCommit: vi.fn(),
    createRef: vi.fn(),
    updateRef: vi.fn(),
    listUserRepos: vi.fn(),
    listBranches: vi.fn(),
  };
});

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  fetchQuery: vi.fn(),
  fetchMutation: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
  clerkClient: vi.fn(),
}));

vi.mock("convex/nextjs", () => ({
  fetchQuery: mocks.fetchQuery,
  fetchMutation: mocks.fetchMutation,
}));

vi.mock("@/lib/githubSyncServer", () => githubServer);

import { GET as reposGET } from "@/app/api/github/repos/route";
import { GET as branchesGET } from "@/app/api/github/branches/route";
import { GET as statusGET } from "@/app/api/github/status/route";
import { POST as connectPOST } from "@/app/api/github/connect/route";
import { POST as previewPOST } from "@/app/api/github/pull-preview/route";
import { POST as applyPOST } from "@/app/api/github/pull-apply/route";
import { POST as pushPOST } from "@/app/api/github/push/route";
import { POST as refreshPOST } from "@/app/api/github/refresh/route";

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

function projectJson(role: "owner" | "editor" | "viewer" = "owner") {
  return {
    _id: "project1",
    ownerId: role === "owner" ? "user-1" : "owner-2",
    role,
  };
}

function authedUser() {
  mocks.auth.mockResolvedValue({
    userId: "user-1",
    getToken: vi.fn().mockResolvedValue("convex-jwt"),
  });
}

/** Queue fetchQuery results in exact call order; unexpected calls fail loudly. */
function mockQueries(results: unknown[]) {
  mocks.fetchQuery.mockReset();
  for (const result of results) mocks.fetchQuery.mockResolvedValueOnce(result);
  mocks.fetchQuery.mockImplementation(async () => {
    throw new Error("unexpected convex query");
  });
}

function connection(lastCommitSha?: string) {
  return {
    _id: "conn1",
    projectId: "project1",
    owner: "octo",
    repo: "docs",
    branch: "main",
    ...(lastCommitSha ? { lastCommitSha } : {}),
    trackedPaths: ["main.tex"],
    updatedBy: "user-1",
    updatedAt: 1,
  };
}

function post(url: string, body: unknown) {
  return new Request(`http://localhost:3000${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  githubServer.getGitHubToken.mockResolvedValue("gh-token");
  authedUser();
});

describe("github status and connect", () => {
  it("reports disconnected truthfully and gates local projects", async () => {
    mockQueries([projectJson(), null]);
    const res = await statusGET(
      new Request("http://localhost:3000/api/github/status?projectId=cloud-1"),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: false, githubLinked: true });

    const local = await statusGET(
      new Request("http://localhost:3000/api/github/status?projectId=local-1"),
    );
    expect(local.status).toBe(400);
    expect(((await local.json()) as { error: string }).error).toMatch(/cloud projects/);
  });

  it("reports connection state with the live remote head", async () => {
    mockQueries([projectJson(), connection(HEAD_A)]);
    githubServer.getBranchHead.mockResolvedValue(HEAD_B);
    const res = await statusGET(
      new Request("http://localhost:3000/api/github/status?projectId=cloud-1"),
    );
    const body = await res.json();
    expect(body.connected).toBe(true);
    expect(body.remoteHead).toBe(HEAD_B);
    expect(body.inSync).toBe(false);
    expect(body.needsInitialPull).toBe(false);
  });

  it("requires the owner role to connect and sets no baseline", async () => {
    mockQueries([projectJson("owner")]);
    mocks.fetchMutation.mockResolvedValueOnce(connection());
    const res = await connectPOST(
      post("/api/github/connect", { projectId: "cloud-1", owner: "octo", repo: "docs", branch: "main" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.needsInitialPull).toBe(true);
    expect(mocks.fetchMutation.mock.calls[0][1]).toMatchObject({ owner: "octo", repo: "docs" });

    mockQueries([projectJson("editor")]);
    const denied = await connectPOST(
      post("/api/github/connect", { projectId: "cloud-1", owner: "octo", repo: "docs", branch: "main" }),
    );
    expect(denied.status).toBe(403);
  });
});

describe("github pull flow", () => {
  const tree = [
    { path: "main.tex", mode: "100644", type: "blob", sha: HEAD_A, size: 10 },
    { path: "notes.tex", mode: "100644", type: "blob", sha: HEAD_B, size: 5 },
    { path: "sub", mode: "040000", type: "tree", sha: HEAD_A },
    { path: "vendor", mode: "160000", type: "commit", sha: HEAD_A },
  ];

  beforeEach(() => {
    mockQueries([projectJson(), connection()]);
    githubServer.getBranchHead.mockResolvedValue(HEAD_A);
    githubServer.getCommitTreeSha.mockResolvedValue("tree-sha");
    githubServer.getTreeRecursive.mockResolvedValue({ entries: tree, truncated: false });
  });

  it("previews added/updated/removed and skips non-files", async () => {
    const res = await previewPOST(
      post("/api/github/pull-preview", {
        projectId: "cloud-1",
        snapshot: [{ path: "main.tex", version: 2 }],
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.remoteHead).toBe(HEAD_A);
    expect(body.added).toEqual(["notes.tex"]);
    expect(body.updated).toEqual(["main.tex"]);
    expect(body.removed).toEqual([]);
    expect(body.skipped.map((s: { path: string }) => s.path).sort()).toEqual(["sub", "vendor"]);
    expect(body.needsInitialImport).toBe(true);
  });

  it("requires import confirmation before the first apply", async () => {
    const res = await applyPOST(
      post("/api/github/pull-apply", {
        projectId: "cloud-1",
        remoteHead: HEAD_A,
        expected: [{ path: "main.tex", version: 2, incarnation: "row-1" }],
      }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("import-confirm-required");
  });

  it("applies a confirmed pull after re-verifying the head", async () => {
    const current = await githubServer.getTreeRecursive();
    githubServer.getTreeRecursive.mockResolvedValue({ ...current, entries: current.entries.filter((entry: { type: string; mode: string }) => entry.type === "tree" || entry.mode === "100644" || entry.mode === "100755") });
    githubServer.getBlob.mockImplementation(async (_t: string, _o: string, _r: string, sha: string) => ({
      content: Buffer.from(`content-${sha.slice(0, 1)}`).toString("base64"),
    }));
    mocks.fetchMutation.mockResolvedValueOnce({
      remoteHead: HEAD_A,
      files: [{ path: "main.tex", content: "x", version: 3, incarnation: "row-1" }],
    });
    const res = await applyPOST(
      post("/api/github/pull-apply", {
        projectId: "cloud-1",
        remoteHead: HEAD_A,
        expected: [{ path: "main.tex", version: 2, incarnation: "row-1" }],
        importConfirmed: true,
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { applied: boolean }).applied).toBe(true);
    expect(githubServer.getBlob).toHaveBeenCalledTimes(2);
  });

  it("refuses to apply when the remote moved after preview", async () => {
    githubServer.getBranchHead.mockResolvedValue(HEAD_B);
    const res = await applyPOST(
      post("/api/github/pull-apply", {
        projectId: "cloud-1",
        remoteHead: HEAD_A,
        expected: [],
        importConfirmed: true,
      }),
    );
    expect(res.status).toBe(409);
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
  });
});

describe("github push flow", () => {
  const rows = [
    { _id: "row-1", path: "main.tex", content: "v2", version: 2 },
    { _id: "row-2", path: "new.tex", content: "new", version: 1 },
  ];
  const expectedSnapshot = [
    { path: "main.tex", version: 2, incarnation: "row-1" },
    { path: "new.tex", version: 1, incarnation: "row-2" },
  ];

  it("refuses the first push before any pull baseline", async () => {
    mockQueries([projectJson(), connection()]);
    githubServer.getBranchHead.mockResolvedValue(HEAD_A);
    const res = await pushPOST(
      post("/api/github/push", { projectId: "cloud-1", remoteHead: HEAD_A, expected: [] }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("needs-initial-pull");
  });

  it("asks for initialization on an empty branch without confirmation", async () => {
    mockQueries([projectJson(), connection()]);
    githubServer.getBranchHead.mockResolvedValue(null);
    const res = await pushPOST(
      post("/api/github/push", { projectId: "cloud-1", expected: [] }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("needs-initialize-branch");
    expect(githubServer.createRootTree).not.toHaveBeenCalled();
    expect(githubServer.createRef).not.toHaveBeenCalled();
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
  });

  it("pushes changed files, preserves unrelated paths, deletes tracked removals", async () => {
    mockQueries([projectJson(), connection(HEAD_A), rows]);
    githubServer.getBranchHead.mockResolvedValue(HEAD_A);
    githubServer.getCommitTreeSha.mockResolvedValue("tree-sha");
    githubServer.getTreeRecursive.mockResolvedValue({
      entries: [
        { path: "main.tex", mode: "100644", type: "blob", sha: HEAD_A },
        { path: "old.tex", mode: "100644", type: "blob", sha: HEAD_B },
        { path: "README.md", mode: "100644", type: "blob", sha: HEAD_A },
      ],
      truncated: false,
    });
    githubServer.getBlob.mockResolvedValue({ content: Buffer.from("v1").toString("base64") });
    githubServer.createBlob.mockResolvedValue("new-blob");
    githubServer.createTree.mockResolvedValue("new-tree");
    githubServer.createCommit.mockResolvedValue(HEAD_B);
    githubServer.updateRef.mockResolvedValue(undefined);
    mocks.fetchMutation.mockResolvedValueOnce({ recorded: true, newSha: HEAD_B });

    const res = await pushPOST(
      post("/api/github/push", {
        projectId: "cloud-1",
        remoteHead: HEAD_A,
        expected: expectedSnapshot,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pushed: true, recorded: true, commitSha: HEAD_B });
    // Changed main.tex + new.tex uploaded; old.tex (untracked remotely,
    // README preserved via base_tree) — only tracked removals deleted.
    const treeArg = githubServer.createTree.mock.calls[0][4] as { path: string; sha: string | null }[];
    const byPath = new Map(treeArg.map((e) => [e.path, e.sha]));
    expect(byPath.get("main.tex")).toBe("new-blob");
    expect(byPath.get("new.tex")).toBe("new-blob");
    expect(byPath.has("README.md")).toBe(false);
    expect(byPath.has("old.tex")).toBe(false);
    expect(githubServer.updateRef.mock.calls[0].slice(1, 4)).toEqual(["octo", "docs", "main"]);
  });

  it("refuses to overwrite untracked remote files, symlinks, and tree collisions", async () => {
    const rows = [
      { _id: "row-1", path: "main.tex", content: "v2", version: 2 },
      { _id: "row-2", path: "notes.txt", content: "local notes", version: 1 },
      { _id: "row-3", path: "link.tex", content: "local link", version: 1 },
      { _id: "row-4", path: "a", content: "local file", version: 1 },
    ];
    mockQueries([projectJson(), connection(HEAD_A), rows]);
    githubServer.getBranchHead.mockResolvedValue(HEAD_A);
    githubServer.getCommitTreeSha.mockResolvedValue("tree-sha");
    githubServer.getTreeRecursive.mockResolvedValue({
      entries: [
        { path: "main.tex", mode: "100644", type: "blob", sha: HEAD_A },
        // Untracked by this sync: must be preserved, never overwritten.
        { path: "notes.txt", mode: "100644", type: "blob", sha: HEAD_B },
        // Symlink at a local path: refuse instead of replacing.
        { path: "link.tex", mode: "120000", type: "blob", sha: HEAD_B },
        // Remote content beneath a local file path: refuse.
        { path: "a/b.tex", mode: "100644", type: "blob", sha: HEAD_B },
      ],
      truncated: false,
    });
    githubServer.getBlob.mockResolvedValue({ content: Buffer.from("v1").toString("base64") });
    const res = await pushPOST(
      post("/api/github/push", {
        projectId: "cloud-1",
        remoteHead: HEAD_A,
        expected: rows.map((r) => ({ path: r.path, version: r.version, incarnation: r._id })),
      }),
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("remote-collision");
    expect(githubServer.createBlob).not.toHaveBeenCalled();
    expect(githubServer.createTree).not.toHaveBeenCalled();
    expect(githubServer.createCommit).not.toHaveBeenCalled();
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
  });

  it("reports ack failure for explicit refresh after a landed push", async () => {
    const singleRow = [{ _id: "row-1", path: "main.tex", content: "v2", version: 2 }];
    mockQueries([projectJson(), connection(HEAD_A), singleRow]);
    githubServer.getBranchHead.mockResolvedValue(HEAD_A);
    githubServer.getCommitTreeSha.mockResolvedValue("tree-sha");
    githubServer.getTreeRecursive.mockResolvedValue({
      entries: [{ path: "main.tex", mode: "100644", type: "blob", sha: HEAD_A }],
      truncated: false,
    });
    githubServer.getBlob.mockResolvedValue({ content: Buffer.from("v1").toString("base64") });
    githubServer.createBlob.mockResolvedValue("b");
    githubServer.createTree.mockResolvedValue("t");
    githubServer.createCommit.mockResolvedValue(HEAD_B);
    githubServer.updateRef.mockResolvedValue(undefined);
    mocks.fetchMutation.mockRejectedValueOnce(new Error("Sync state changed during the push."));

    const res = await pushPOST(
      post("/api/github/push", {
        projectId: "cloud-1",
        remoteHead: HEAD_A,
        expected: [{ path: "main.tex", version: 2, incarnation: "row-1" }],
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pushed: true, recorded: false, commitSha: HEAD_B });
  });
});

describe("github empty-branch initialization", () => {
  const rows = [{ _id: "row-1", path: "main.tex", content: "v2", version: 1 }];
  const expectedSnapshot = [{ path: "main.tex", version: 1, incarnation: "row-1" }];

  beforeEach(() => {
    mockQueries([projectJson(), connection(), rows]);
    githubServer.getBranchHead.mockResolvedValue(null);
    githubServer.createBlob.mockResolvedValue("blob-sha");
    githubServer.createRootTree.mockResolvedValue("root-tree");
    githubServer.createCommit.mockResolvedValue(HEAD_B);
    githubServer.createRef.mockResolvedValue(undefined);
    mocks.fetchMutation.mockResolvedValueOnce({ recorded: true, newSha: HEAD_B });
  });

  function initBody(extra: Record<string, unknown> = {}) {
    return { projectId: "cloud-1", expected: expectedSnapshot, initializeBranch: true, ...extra };
  }

  it("creates a root tree, root commit, and ref without a base", async () => {
    const res = await pushPOST(post("/api/github/push", initBody()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pushed: true, recorded: true, commitSha: HEAD_B });
    // Root tree without base_tree.
    expect(githubServer.createRootTree.mock.calls[0]?.slice(1, 3)).toEqual(["octo", "docs"]);
    const treeArg = githubServer.createRootTree.mock.calls[0][3] as { path: string; sha: string | null }[];
    expect(treeArg).toEqual([{ path: "main.tex", mode: "100644", type: "blob", sha: "blob-sha" }]);
    // Root commit has no parents.
    expect(githubServer.createCommit.mock.calls[0]?.slice(3, 6)).toEqual(["Initialize from alove", "root-tree", []]);
    // Ref creation targets the connected branch.
    expect(githubServer.createRef.mock.calls[0]?.slice(1, 5)).toEqual(["octo", "docs", "main", HEAD_B]);
    // Baseline recorded without a previous sha.
    const recordCall = mocks.fetchMutation.mock.calls[0][1] as Record<string, unknown>;
    expect(recordCall.prevSha).toBeUndefined();
    expect(recordCall.newSha).toBe(HEAD_B);
    expect(recordCall).toMatchObject({
      expectedTarget: { owner: "octo", repo: "docs", branch: "main" },
      trackedPaths: ["main.tex"],
    });
    expect(githubServer.updateRef).not.toHaveBeenCalled();
  });

  it("still requires an initial pull when the branch is not empty", async () => {
    githubServer.getBranchHead.mockResolvedValue(HEAD_A);
    const res = await pushPOST(post("/api/github/push", initBody()));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("needs-initial-pull");
    expect(githubServer.createRootTree).not.toHaveBeenCalled();
    expect(githubServer.createRef).not.toHaveBeenCalled();
    expect(githubServer.createCommit).not.toHaveBeenCalled();
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
  });

  it("leaves the remote unmodified when the branch appears mid-flight", async () => {
    const RaceError = githubServer.GitHubError as new (message: string, status?: number) => Error;
    githubServer.createRef.mockRejectedValueOnce(new RaceError("Reference already exists", 409));
    const res = await pushPOST(post("/api/github/push", initBody()));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("branch-created-race");
    // The baseline is never recorded for a ref we did not create.
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
  });

  it("uses refresh to reconcile when the acknowledgement fails", async () => {
    mocks.fetchMutation.mockReset();
    mocks.fetchMutation.mockRejectedValueOnce(new Error("Sync state changed during the push."));
    const res = await pushPOST(post("/api/github/push", initBody()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pushed: true, recorded: false, commitSha: HEAD_B });
  });
});

describe("github refresh", () => {
  it("reconciles only on exact content match", async () => {
    mockQueries([projectJson(), connection(HEAD_A)]);
    githubServer.getBranchHead.mockResolvedValue(HEAD_B);
    githubServer.getCommitTreeSha.mockResolvedValue("tree-sha");
    githubServer.getTreeRecursive.mockResolvedValue({
      entries: [{ path: "main.tex", mode: "100644", type: "blob", sha: HEAD_A }],
      truncated: false,
    });
    githubServer.getBlob.mockResolvedValue({ content: Buffer.from("same").toString("base64") });
    mocks.fetchMutation.mockResolvedValueOnce({ refreshed: true, remoteHead: HEAD_B });
    const res = await refreshPOST(post("/api/github/refresh", { projectId: "cloud-1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ refreshed: true, remoteHead: HEAD_B });
  });

  it("never advances the baseline when content differs", async () => {
    mockQueries([projectJson(), connection(HEAD_A)]);
    githubServer.getBranchHead.mockResolvedValue(HEAD_B);
    githubServer.getCommitTreeSha.mockResolvedValue("tree-sha");
    githubServer.getTreeRecursive.mockResolvedValue({
      entries: [{ path: "main.tex", mode: "100644", type: "blob", sha: HEAD_A }],
      truncated: false,
    });
    githubServer.getBlob.mockResolvedValue({ content: Buffer.from("same").toString("base64") });
    mocks.fetchMutation.mockRejectedValueOnce(
      new Error("Remote and local source differ. Pull the remote changes instead."),
    );
    const res = await refreshPOST(post("/api/github/refresh", { projectId: "cloud-1" }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe("differs");
  });
});


afterEach(() => vi.unstubAllEnvs());
describe("repository listing behind the configured proxy", () => {
  it("accepts same-origin GET fetch without an Origin header", async () => {
    githubServer.listUserRepos.mockResolvedValue([]);
    githubServer.listBranches.mockResolvedValue([]);
    expect((await reposGET(new Request("http://localhost:3000/api/github/repos"))).status).toBe(200);
    expect((await branchesGET(new Request("http://localhost:3000/api/github/branches?owner=octo&repo=docs"))).status).toBe(200);
  });
  it("uses the configured public origin for proxy requests and refuses foreign browser origins", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("ALOVE_SITE_URL", "https://alove.example"); vi.stubEnv("ALOVE_COMPILE_TRUST_PROXY", "true");
    githubServer.listUserRepos.mockResolvedValue([]);
    expect((await reposGET(new Request("http://web:3000/api/github/repos", { headers: { host: "alove.example", origin: "https://alove.example" } }))).status).toBe(200);
    expect((await reposGET(new Request("http://web:3000/api/github/repos", { headers: { host: "alove.example", origin: "https://other.example" } }))).status).toBe(403);
  });
});
