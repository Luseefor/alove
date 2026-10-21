import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { decodeGitHubBlob, isValidSha } from "@/lib/githubSync";
import { checkProjectPath } from "@/lib/cloudProjectLimits";
import {
  GitHubError,
  getBlob,
  getBranchHead,
  getCommitTreeSha,
  getTreeRecursive,
} from "@/lib/githubSyncServer";
import { authorizeGitHubRoute, readJsonBody } from "../_auth";

export const runtime = "nodejs";

/** Reconcile after a push whose acknowledgement failed (or any baseline
 *  doubt): fast-forwards the baseline only when the remote tree exactly
 *  matches current source. Otherwise the caller must pull. */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req, 8192);
  if (!parsed.ok) return parsed.response;
  const args = parsed.value as { projectId?: unknown };
  const authed = await authorizeGitHubRoute(req, args.projectId, "edit", {
    needGitHubToken: true,
  });
  if (!authed.ok) return authed.response;
  const { principal } = authed;
  const token = principal.githubToken!;
  const convexOpts = { token: principal.convexToken, url: principal.convexUrl };
  const connection = await fetchQuery(
    api.github.getConnection,
    { projectId: principal.project._id as never },
    convexOpts,
  );
  if (!connection)
    return Response.json({ error: "Connect a GitHub repository first." }, { status: 409 });
  try {
    const liveHead = await getBranchHead(token, connection.owner, connection.repo, connection.branch);
    if (!liveHead || !isValidSha(liveHead))
      return Response.json({ error: "The remote branch has no commits yet." }, { status: 409 });
    if (connection.lastCommitSha === liveHead)
      return Response.json({ refreshed: false, remoteHead: liveHead });
    const treeSha = await getCommitTreeSha(token, connection.owner, connection.repo, liveHead);
    const { entries, truncated } = await getTreeRecursive(token, connection.owner, connection.repo, treeSha);
    if (truncated)
      return Response.json({ error: "The repository tree is too large to sync safely." }, { status: 409 });
    const remoteContents: { path: string; content: string }[] = [];
    const remotePaths: string[] = [];
    for (const entry of entries) {
      if (entry.type !== "blob") continue;
      if (entry.mode !== "100644" && entry.mode !== "100755") continue;
      const check = checkProjectPath(entry.path);
      if (!check.ok || !isValidSha(entry.sha)) continue;
      const blob = await getBlob(token, connection.owner, connection.repo, entry.sha);
      const decoded = decodeGitHubBlob(check.path, blob.content);
      if (!decoded.ok)
        return Response.json(
          { error: "Remote and local source differ. Pull the remote changes instead.", code: "differs" },
          { status: 409 },
        );
      remoteContents.push({ path: check.path, content: decoded.content });
      remotePaths.push(check.path);
    }
    try {
      const result = await fetchMutation(
        api.github.refreshBaseline,
        {
          projectId: principal.project._id as Id<"projects">,
          remoteHead: liveHead,
          expectedTarget: { owner: connection.owner, repo: connection.repo, branch: connection.branch, baseline: connection.lastCommitSha },
          remotePaths,
          remoteContents,
        },
        convexOpts,
      );
      return Response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not refresh.";
      return Response.json({ error: message, code: "differs" }, { status: 409 });
    }
  } catch (error) {
    if (error instanceof GitHubError)
      return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Could not refresh sync status." }, { status: 502 });
  }
}
