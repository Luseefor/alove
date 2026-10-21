import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import {
  GITHUB_LIMITS,
  isValidSha,
  type PullPreviewResponse,
} from "@/lib/githubSync";
import { checkProjectPath } from "@/lib/cloudProjectLimits";
import {
  GitHubError,
  getBranchHead,
  getCommitTreeSha,
  getTreeRecursive,
} from "@/lib/githubSyncServer";
import { authorizeGitHubRoute, readJsonBody } from "../_auth";

export const runtime = "nodejs";

type SnapshotEntry = { path?: unknown; version?: unknown };

/** Preview a pull: remote head plus the per-path diff against the caller's
 *  snapshot. Read-only on both sides; nothing is applied here. */
export async function POST(req: Request) {
  const parsed = await readJsonBody(req, 65536);
  if (!parsed.ok) return parsed.response;
  const args = parsed.value as { projectId?: unknown; snapshot?: unknown };
  if (!Array.isArray(args.snapshot))
    return Response.json({ error: "Missing file snapshot." }, { status: 400 });
  const authed = await authorizeGitHubRoute(req, args.projectId, "edit", {
    needGitHubToken: true,
  });
  if (!authed.ok) return authed.response;
  const { principal } = authed;
  const token = principal.githubToken!;
  const connection = await fetchQuery(
    api.github.getConnection,
    { projectId: principal.project._id as never },
    { token: principal.convexToken, url: principal.convexUrl },
  );
  if (!connection)
    return Response.json({ error: "Connect a GitHub repository first." }, { status: 409 });
  try {
    const remoteHead = await getBranchHead(token, connection.owner, connection.repo, connection.branch);
    if (!remoteHead || !isValidSha(remoteHead))
      return Response.json(
        { error: "The remote branch has no commits yet. Push local source first, or pick a branch with history." },
        { status: 409 },
      );
    const treeSha = await getCommitTreeSha(token, connection.owner, connection.repo, remoteHead);
    const { entries, truncated } = await getTreeRecursive(token, connection.owner, connection.repo, treeSha);
    if (truncated)
      return Response.json(
        { error: "The repository tree is too large to sync safely." },
        { status: 409 },
      );
    const local = new Map<string, number>();
    for (const entry of args.snapshot as SnapshotEntry[]) {
      if (typeof entry?.path === "string" && typeof entry?.version === "number")
        local.set(entry.path, entry.version);
    }
    const paths: PullPreviewResponse["paths"] = [];
    const skipped: PullPreviewResponse["skipped"] = [];
    let total = 0;
    for (const entry of entries) {
      if (entry.type !== "blob") {
        skipped.push({ path: entry.path, reason: "Only files sync; links and submodules are skipped." });
        continue;
      }
      if (entry.mode === "120000") {
        skipped.push({ path: entry.path, reason: "Symbolic links are not synced." });
        continue;
      }
      if (entry.mode !== "100644" && entry.mode !== "100755") {
        skipped.push({ path: entry.path, reason: "Unsupported file mode." });
        continue;
      }
      const check = checkProjectPath(entry.path);
      if (!check.ok) {
        skipped.push({ path: entry.path, reason: "Path is outside the project layout." });
        continue;
      }
      if (!isValidSha(entry.sha)) {
        skipped.push({ path: entry.path, reason: "Invalid remote reference." });
        continue;
      }
      if (typeof entry.size === "number" && entry.size > GITHUB_LIMITS.maxFileBytes) {
        skipped.push({ path: entry.path, reason: "File exceeds the size limit." });
        continue;
      }
      total += entry.size ?? 0;
      paths.push({ path: check.path, size: entry.size ?? null, sha: entry.sha });
    }
    if (paths.length > GITHUB_LIMITS.maxFiles)
      return Response.json(
        { error: "The repository has more files than a project can hold." },
        { status: 409 },
      );
    if (total > GITHUB_LIMITS.maxTotalBytes)
      return Response.json(
        { error: "The repository content is larger than a project can hold." },
        { status: 409 },
      );
    const remotePaths = new Set(paths.map((p) => p.path));
    const tracked = new Set(connection.trackedPaths);
    const added = paths.filter((p) => !local.has(p.path)).map((p) => p.path);
    const updated = paths.filter((p) => local.has(p.path)).map((p) => p.path);
    const removed = [...tracked].filter((p) => !remotePaths.has(p) && local.has(p));
    return Response.json({
      remoteHead,
      paths,
      added,
      updated,
      removed,
      skipped: skipped.slice(0, 50),
      truncated: false,
      needsInitialImport: !connection.lastCommitSha,
    } satisfies PullPreviewResponse);
  } catch (error) {
    if (error instanceof GitHubError)
      return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Could not preview the remote tree." }, { status: 502 });
  }
}
