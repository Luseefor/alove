import { fetchMutation } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { validateRepoRef } from "@/lib/githubSync";
import { authorizeGitHubRoute, readJsonBody } from "../_auth";

export const runtime = "nodejs";

/** Owner-only. Records the target repo/branch with NO sync baseline: the
 *  first pull must be previewed and applied before push is allowed. */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req, 8192);
  if (!parsed.ok) return parsed.response;
  const args = parsed.value as {
    projectId?: unknown;
    owner?: unknown;
    repo?: unknown;
    branch?: unknown;
  };
  const invalid = validateRepoRef(args.owner, args.repo, args.branch);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });
  const authed = await authorizeGitHubRoute(req, args.projectId, "owner");
  if (!authed.ok) return authed.response;
  const { principal } = authed;
  const connection = await fetchMutation(
    api.github.connect,
    {
      projectId: principal.project._id as Id<"projects">,
      owner: args.owner as string,
      repo: args.repo as string,
      branch: args.branch as string,
    },
    { token: principal.convexToken, url: principal.convexUrl },
  );
  if (!connection)
    return Response.json({ error: "Could not save the connection." }, { status: 502 });
  return Response.json({
    connection: {
      owner: connection.owner,
      repo: connection.repo,
      branch: connection.branch,
      ...(connection.lastCommitSha ? { lastCommitSha: connection.lastCommitSha } : {}),
      trackedPaths: connection.trackedPaths,
      updatedAt: connection.updatedAt,
    },
    needsInitialPull: !connection.lastCommitSha,
  });
}
