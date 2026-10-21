import { fetchMutation } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { authorizeGitHubRoute, readJsonBody } from "../_auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const parsed = await readJsonBody(req, 4096);
  if (!parsed.ok) return parsed.response;
  const args = parsed.value as { projectId?: unknown };
  const authed = await authorizeGitHubRoute(req, args.projectId, "owner");
  if (!authed.ok) return authed.response;
  await fetchMutation(
    api.github.disconnect,
    { projectId: authed.principal.project._id as Id<"projects"> },
    { token: authed.principal.convexToken, url: authed.principal.convexUrl },
  );
  return Response.json({ disconnected: true });
}
