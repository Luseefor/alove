import { authorizeCloudApiOrigin } from "@/lib/cloudApiOrigin";
import { auth } from "@clerk/nextjs/server";
import { validateRepoRef } from "@/lib/githubSync";
import { GitHubError, getGitHubToken, listBranches } from "@/lib/githubSyncServer";

export const runtime = "nodejs";

export async function GET(req: Request) {
  if (!authorizeCloudApiOrigin(req))
    return Response.json({ error: "Forbidden origin" }, { status: 403 });
  const params = new URL(req.url).searchParams;
  const owner = params.get("owner");
  const repo = params.get("repo");
  if (validateRepoRef(owner, repo, "main") !== null)
    return Response.json({ error: "Invalid repository." }, { status: 400 });
  const session = await auth();
  if (!session.userId)
    return Response.json({ error: "Sign in required." }, { status: 401 });
  let token: string | null;
  try {
    token = await getGitHubToken(session.userId);
  } catch {
    return Response.json(
      { error: "GitHub authorization failed. Reconnect the GitHub account." },
      { status: 401 },
    );
  }
  if (!token)
    return Response.json(
      { error: "No GitHub account connected.", code: "github-not-linked" },
      { status: 401 },
    );
  try {
    const branches = await listBranches(token, owner as string, repo as string);
    return Response.json({ branches });
  } catch (error) {
    if (error instanceof GitHubError)
      return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Could not list branches." }, { status: 502 });
  }
}
