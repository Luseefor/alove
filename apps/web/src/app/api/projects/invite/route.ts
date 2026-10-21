import { auth, clerkClient } from "@clerk/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { authorizeCloudApiOrigin } from "@/lib/cloudApiOrigin";
import { readJsonBody } from "@/lib/requestJson";

export async function POST(req: Request) {
  if (!authorizeCloudApiOrigin(req))
    return Response.json({ error: "Forbidden origin" }, { status: 403 });
  try {
    const session = await auth();
    if (!session.userId)
      return Response.json({ error: "Sign in required." }, { status: 401 });
    const token = await session.getToken({ template: "convex" });
    if (!token)
      return Response.json(
        { error: "Cloud authentication required." },
        { status: 401 },
      );
    const parsed = await readJsonBody(req, 2048);
    if (!parsed.ok) return parsed.response;
    const args = parsed.value as {
      projectId?: unknown;
      email?: unknown;
      role?: unknown;
    };
    if (
      typeof args.projectId !== "string" ||
      typeof args.email !== "string" ||
      args.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(args.email.trim()) ||
      (args.role !== "editor" && args.role !== "viewer")
    )
      return Response.json(
        { error: "Choose an email address and role." },
        { status: 400 },
      );
    const options = { token, url: process.env.NEXT_PUBLIC_CONVEX_URL };
    const project = await fetchQuery(
      api.projects.get,
      { projectId: args.projectId },
      options,
    );
    if (!project || project.ownerId !== session.userId)
      return Response.json(
        { error: "Only the project owner can invite collaborators." },
        { status: 403 },
      );
    const email = args.email.trim().toLowerCase();
    const client = await clerkClient();
    const users = await client.users.getUserList({
      emailAddress: [email],
      limit: 10,
    });
    const target = users.data.find((user) =>
      user.emailAddresses.some(
        (address) =>
          address.emailAddress.toLowerCase() === email &&
          address.verification?.status === "verified",
      ),
    );
    if (!target)
      return Response.json(
        {
          error:
            "No existing account with this verified email. Ask the collaborator to sign up first.",
        },
        { status: 404 },
      );
    await fetchMutation(
      api.members.invite,
      {
        projectId: project._id as Id<"projects">,
        userId: target.id,
        displayName: email,
        role: args.role,
      },
      options,
    );
    return Response.json({ invited: true });
  } catch {
    return Response.json(
      { error: "Could not create invitation. Check access and retry." },
      { status: 400 },
    );
  }
}
