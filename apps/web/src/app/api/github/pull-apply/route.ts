import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import {
  GITHUB_LIMITS,
  decodeGitHubBlob,
  isValidSha,
  type PullApplyResponse,
} from "@/lib/githubSync";
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

type ExpectedEntry = { path?: unknown; version?: unknown; incarnation?: unknown };

/** Apply a previewed pull. Re-verifies the remote head, fetches blobs
 *  server-side, then checkpoints and applies atomically in Convex. The
 *  mutation rejects any local drift since the preview snapshot. */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req, 65536);
  if (!parsed.ok) return parsed.response;
  const args = parsed.value as {
    projectId?: unknown;
    remoteHead?: unknown;
    expected?: unknown;
    importConfirmed?: unknown;
  };
  if (!isValidSha(args.remoteHead))
    return Response.json({ error: "Missing remote head. Preview first." }, { status: 400 });
  if (!Array.isArray(args.expected))
    return Response.json({ error: "Missing file snapshot." }, { status: 400 });
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
  // An initial import merges into an existing project: require an
  // explicit confirmation so a fresh connect can never silently overwrite.
  if (!connection.lastCommitSha && args.importConfirmed !== true)
    return Response.json(
      { error: "Confirm the initial import to merge the repository tree into local source.", code: "import-confirm-required" },
      { status: 409 },
    );
  try {
    const liveHead = await getBranchHead(token, connection.owner, connection.repo, connection.branch);
    if (liveHead !== args.remoteHead)
      return Response.json(
        { error: "The remote branch moved. Preview again before applying.", code: "remote-moved" },
        { status: 409 },
      );
    const treeSha = await getCommitTreeSha(token, connection.owner, connection.repo, args.remoteHead);
    const { entries, truncated } = await getTreeRecursive(token, connection.owner, connection.repo, treeSha);
    if (truncated)
      return Response.json({ error: "The repository tree is too large to sync safely." }, { status: 409 });
    const files: { path: string; content: string }[] = [];
    let total = 0;
    for (const entry of entries) {
      if (entry.type === "tree") continue;
      if (entry.type !== "blob" || (entry.mode !== "100644" && entry.mode !== "100755")) return Response.json({ error: `Unsupported repository entry: ${entry.path}. Symlinks and submodules cannot be imported.` }, { status: 409 });
      const check = checkProjectPath(entry.path);
      if (!check.ok || !isValidSha(entry.sha)) return Response.json({ error: `Unsafe repository entry: ${entry.path}` }, { status: 409 });
      const blob = await getBlob(token, connection.owner, connection.repo, entry.sha);
      const decoded = decodeGitHubBlob(check.path, blob.content);
      if (!decoded.ok)
        return Response.json(
          { error: `Cannot import ${check.path}: ${decoded.error}` },
          { status: 409 },
        );
      total += Buffer.byteLength(decoded.content, "utf8");
      if (total > GITHUB_LIMITS.maxTotalBytes)
        return Response.json({ error: "The repository content is larger than a project can hold." }, { status: 409 });
      files.push({ path: check.path, content: decoded.content });
    }
    if (files.length > GITHUB_LIMITS.maxFiles)
      return Response.json({ error: "The repository has more files than a project can hold." }, { status: 409 });
    const remotePaths = new Set(files.map((f) => f.path));
    const deletePaths = connection.trackedPaths.filter((p) => !remotePaths.has(p));
    const expected = (args.expected as ExpectedEntry[])
      .filter((e) => typeof e?.path === "string" && typeof e?.version === "number")
      .map((e) => ({
        path: e.path as string,
        version: e.version as number,
        ...(typeof e.incarnation === "string" ? { incarnation: e.incarnation } : {}),
      }));
    try {
      const result = await fetchMutation(
        api.github.applyPull,
        {
          projectId: principal.project._id as Id<"projects">,
          remoteHead: args.remoteHead,
          expectedTarget: { owner: connection.owner, repo: connection.repo, branch: connection.branch, baseline: connection.lastCommitSha },
          files,
          deletePaths,
          expected,
        },
        convexOpts,
      );
      return Response.json({ applied: true, ...result } satisfies PullApplyResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not apply the pull.";
      const stale =
        message.includes("changed") ||
        message.includes("Refresh the preview") ||
        message.includes("Connect a GitHub");
      return Response.json(
        { error: message, ...(stale ? { code: "stale-snapshot" } : {}) },
        { status: stale ? 409 : 502 },
      );
    }
  } catch (error) {
    if (error instanceof GitHubError)
      return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Could not apply the pull." }, { status: 502 });
  }
}
