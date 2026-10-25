import { auth } from "@clerk/nextjs/server";
import { getConvexToken } from "@/lib/convexToken";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import { authorizeCloudApiOrigin } from "@/lib/cloudApiOrigin";
import { readJsonBody } from "@/lib/requestJson";
import { getGitHubToken } from "@/lib/githubSyncServer";

export { readJsonBody };

export type GitHubRoutePrincipal = {
  userId: string;
  convexToken: string;
  convexUrl: string | undefined;
  project: {
    _id: string;
    ownerId: string;
    role: "owner" | "editor" | "viewer";
  };
  githubToken: string | null;
};

/** Cloud projects only: local workspaces have no Convex project to sync. */
export function isCloudProjectId(projectId: string): boolean {
  return !projectId.startsWith("local");
}

export async function authorizeGitHubRoute(
  req: Request,
  projectId: unknown,
  permission: "read" | "edit" | "owner",
  opts: { needGitHubToken?: boolean } = {},
): Promise<
  | { ok: true; principal: GitHubRoutePrincipal }
  | { ok: false; response: Response }
> {
  if (!authorizeCloudApiOrigin(req))
    return {
      ok: false,
      response: Response.json({ error: "Forbidden origin" }, { status: 403 }),
    };
  if (typeof projectId !== "string" || projectId.length === 0)
    return {
      ok: false,
      response: Response.json({ error: "Missing project." }, { status: 400 }),
    };
  if (!isCloudProjectId(projectId))
    return {
      ok: false,
      response: Response.json(
        { error: "GitHub sync is available for cloud projects. Local workspaces stay on this device." },
        { status: 400 },
      ),
    };
  const session = await auth();
  if (!session.userId)
    return {
      ok: false,
      response: Response.json({ error: "Sign in required." }, { status: 401 }),
    };
  const convexToken = await getConvexToken(session);
  if (!convexToken)
    return {
      ok: false,
      response: Response.json(
        { error: "Cloud authentication required." },
        { status: 401 },
      ),
    };
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  const project = await fetchQuery(
    api.projects.get,
    { projectId },
    { token: convexToken, url: convexUrl },
  );
  if (!project)
    return {
      ok: false,
      response: Response.json({ error: "Project not found." }, { status: 404 }),
    };
  const role = project.role as GitHubRoutePrincipal["project"]["role"];
  if (
    permission === "owner"
      ? role !== "owner"
      : permission === "edit"
        ? role !== "owner" && role !== "editor"
        : false
  )
    return {
      ok: false,
      response: Response.json(
        {
          error:
            permission === "owner"
              ? "Only the project owner can manage the GitHub connection."
              : "An editor role is required to sync.",
        },
        { status: 403 },
      ),
    };
  let githubToken: string | null = null;
  if (opts.needGitHubToken) {
    try {
      githubToken = await getGitHubToken(session.userId);
    } catch {
      return {
        ok: false,
        response: Response.json(
          { error: "GitHub authorization failed. Reconnect the GitHub account." },
          { status: 401 },
        ),
      };
    }
    if (!githubToken)
      return {
        ok: false,
        response: Response.json(
          {
            error: "No GitHub account connected.",
            code: "github-not-linked",
          },
          { status: 401 },
        ),
      };
  }
  return {
    ok: true,
    principal: {
      userId: session.userId,
      convexToken,
      convexUrl,
      project: { _id: String(project._id), ownerId: project.ownerId, role },
      githubToken,
    },
  };
}
