// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.*s");

declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}

type TestClient = ReturnType<typeof convexTest>;
type IdentityClient = ReturnType<TestClient["withIdentity"]>;

let t: TestClient;
let alice: IdentityClient;

const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

beforeEach(() => {
  t = convexTest(schema, modules);
  alice = t.withIdentity({ subject: "alice" });
});

async function blankProject() {
  return await alice.mutation(api.projects.create, { template: "blank" });
}

async function targetOf(client: IdentityClient, projectId: string) {
  const connection = await client.query(api.github.getConnection, { projectId: projectId as never });
  if (!connection) throw new Error("No connection");
  return { owner: connection.owner, repo: connection.repo, branch: connection.branch, baseline: connection.lastCommitSha };
}

describe("github recordPush baseline initialization", () => {
  it("records the first push without a previous sha (null-normalized)", async () => {
    const pid = await blankProject();
    await alice.mutation(api.github.connect, { projectId: pid, owner: "octo", repo: "docs", branch: "main" });
    // Fresh connection: baseline is unset, so prevSha is omitted entirely.
    const recorded = await alice.mutation(api.github.recordPush, {
      expectedTarget: await targetOf(alice, pid),
      projectId: pid,
      newSha: HEAD_A,
      trackedPaths: ["main.tex"],
    });
    expect(recorded).toMatchObject({ recorded: true, newSha: HEAD_A });
    const connection = await alice.query(api.github.getConnection, { projectId: pid });
    expect(connection?.lastCommitSha).toBe(HEAD_A);
  });

  it("rejects an omitted prevSha once a baseline exists", async () => {
    const pid = await blankProject();
    await alice.mutation(api.github.connect, { projectId: pid, owner: "octo", repo: "docs", branch: "main" });
    await alice.mutation(api.github.recordPush, {
      expectedTarget: await targetOf(alice, pid),
      projectId: pid,
      newSha: HEAD_A,
      trackedPaths: ["main.tex"],
    });
    await expect(
      alice.mutation(api.github.recordPush, {
        expectedTarget: await targetOf(alice, pid),
        projectId: pid,
        newSha: HEAD_B,
        trackedPaths: ["main.tex"],
      }),
    ).rejects.toThrow("changed");
  });

  it("still CAS-matches an explicit previous sha", async () => {
    const pid = await blankProject();
    await alice.mutation(api.github.connect, { projectId: pid, owner: "octo", repo: "docs", branch: "main" });
    await alice.mutation(api.github.recordPush, {
      expectedTarget: await targetOf(alice, pid),
      projectId: pid,
      newSha: HEAD_A,
      trackedPaths: ["main.tex"],
    });
    const recorded = await alice.mutation(api.github.recordPush, {
      expectedTarget: await targetOf(alice, pid),
      projectId: pid,
      prevSha: HEAD_A,
      newSha: HEAD_B,
      trackedPaths: ["main.tex"],
    });
    expect(recorded.recorded).toBe(true);
  });

  it("rejects malformed commit references", async () => {
    const pid = await blankProject();
    await alice.mutation(api.github.connect, { projectId: pid, owner: "octo", repo: "docs", branch: "main" });
    await expect(
      alice.mutation(api.github.recordPush, {
        expectedTarget: await targetOf(alice, pid),
        projectId: pid,
        prevSha: "not-a-sha",
        newSha: HEAD_A,
        trackedPaths: [],
      }),
    ).rejects.toThrow("Invalid commit reference");
  });
});
