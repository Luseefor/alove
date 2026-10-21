import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import type { SyncStatusResponse } from "@/lib/githubSync";
import { getBranchHead, getGitHubToken } from "@/lib/githubSyncServer";
import { authorizeGitHubRoute } from "../_auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const projectId = new URL(req.url).searchParams.get("projectId");
  const authed = await authorizeGitHubRoute(req, projectId, "read");
  if (!authed.ok) return authed.response;
  const { principal } = authed;
  const connection = await fetchQuery(
    api.github.getConnection,
    { projectId: principal.project._id as never },
    { token: principal.convexToken, url: principal.convexUrl },
  );
  let githubToken: string | null = null;
  try {
    githubToken = await getGitHubToken(principal.userId);
  } catch {
    githubToken = null;
  }
  const githubLinked = githubToken !== null;
  if (!connection)
    return Response.json({ connected: false, githubLinked } satisfies SyncStatusResponse);
  let remoteHead: string | null = null;
  if (githubToken) {
    try {
      remoteHead = await getBranchHead(
        githubToken,
        connection.owner,
        connection.repo,
        connection.branch,
      );
    } catch {
      // Status stays truthful without the live head; the UI surfaces the
      // connection and offers reconnect.
      remoteHead = null;
    }
  }
  const last = connection.lastCommitSha ?? null;
  return Response.json({
    connected: true,
    githubLinked,
    connection: {
      owner: connection.owner,
      repo: connection.repo,
      branch: connection.branch,
      ...(last ? { lastCommitSha: last } : {}),
      trackedPaths: connection.trackedPaths,
      updatedAt: connection.updatedAt,
    },
    remoteHead,
    inSync: last !== null && remoteHead !== null && last === remoteHead,
    needsInitialPull: last === null,
  } satisfies SyncStatusResponse);
}
