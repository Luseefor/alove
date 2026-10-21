// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const clerkServer = vi.hoisted(() => ({
  clerkClient: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => clerkServer);

import {
  GitHubError,
  createRef,
  createRootTree,
  getGitHubToken,
  listBranches,
} from "@/lib/githubSyncServer";

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers });
}

describe("githubSyncServer response caps", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    clerkServer.clerkClient.mockResolvedValue({
      users: { getUserOauthAccessToken: vi.fn().mockResolvedValue({ data: [], totalCount: 0 }) },
    });
  });

  it("requests the token with the installed SDK provider form", async () => {
    await getGitHubToken("user-1");
    const client = await clerkServer.clerkClient();
    expect(client.users.getUserOauthAccessToken).toHaveBeenCalledWith("user-1", "github");
  });

  it("parses a normal bounded response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ name: "main", commit: { sha: "a".repeat(40) } }]),
    );
    const branches = await listBranches("token", "octo", "docs");
    expect(branches).toEqual([{ name: "main", sha: "a".repeat(40) }]);
  });

  it("rejects a lying content-length before allocating", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ name: "x" }, 200, { "content-length": "99999999" }),
    );
    await expect(listBranches("token", "octo", "docs")).rejects.toMatchObject({
      status: 502,
    });
  });

  it("caps streamed bodies without content-length", async () => {
    const big = new Uint8Array(700_000).fill(65);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(big);
        controller.enqueue(big);
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));
    await expect(listBranches("token", "octo", "docs")).rejects.toMatchObject({
      status: 502,
    });
  });

  it("still surfaces bounded error JSON on conflicts", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Reference already exists" }, 409));
    const error = await listBranches("token", "octo", "docs").catch((e) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).status).toBe(409);
    expect((error as Error).message).toContain("Reference already exists");
  });

  it("creates a root tree without a base for the first commit", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ sha: "t".repeat(40) }));
    const sha = await createRootTree("token", "octo", "docs", [
      { path: "main.tex", mode: "100644", type: "blob", sha: "b".repeat(40) },
    ]);
    expect(sha).toBe("t".repeat(40));
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe("https://api.github.com/repos/octo/docs/git/trees");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      tree: [{ path: "main.tex", mode: "100644", type: "blob", sha: "b".repeat(40) }],
    });
  });

  it("creates a branch ref and maps an existing ref to a conflict", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ref: "refs/heads/main" }, 201));
    await createRef("token", "octo", "docs", "main", "c".repeat(40));
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(url).toBe("https://api.github.com/repos/octo/docs/git/refs");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ ref: "refs/heads/main", sha: "c".repeat(40) });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Reference already exists" }, 422));
    const error = await createRef("token", "octo", "docs", "main", "c".repeat(40)).catch((e) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).status).toBe(409);
  });
});
