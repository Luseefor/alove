import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { NextResponse } from "next/server";
import type { CompileJobOwner } from "@alove/protocol";
import { api } from "../../convex/_generated/api";
import {
  compileRequestOrigin,
  getCompileAuthPolicy,
  isCompileRequestOriginAllowed,
} from "./compileAuth";

export type CompilePrincipal =
  | { owner: Extract<CompileJobOwner, { kind: "local" }> }
  | { owner: Extract<CompileJobOwner, { kind: "user" }>; token: string };

export async function authorizeCompileRequest(
  req: Request,
): Promise<
  { ok: true; principal: CompilePrincipal } | { ok: false; response: Response }
> {
  const policy = getCompileAuthPolicy();
  if ("error" in policy)
    return {
      ok: false,
      response: NextResponse.json({ error: policy.error }, { status: 500 }),
    };
  const origin = policy.allowAnonymous
    ? policy.origin
    : compileRequestOrigin(req);
  if (!isCompileRequestOriginAllowed(req, origin))
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden origin" },
        { status: 403 },
      ),
    };
  if (policy.allowAnonymous)
    return {
      ok: true,
      principal: { owner: { kind: "local", origin: policy.origin } },
    };
  try {
    const session = await auth();
    if (!session.userId)
      return {
        ok: false,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    const token = await session.getToken({ template: "convex" });
    if (!token)
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Convex authentication required" },
          { status: 401 },
        ),
      };
    return {
      ok: true,
      principal: { owner: { kind: "user", userId: session.userId }, token },
    };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Authentication unavailable" },
        { status: 503 },
      ),
    };
  }
}

export async function canAccessCompileProject(
  principal: CompilePrincipal,
  projectId: string,
): Promise<boolean> {
  if (principal.owner.kind === "local") return true;
  // The query enforces the same owner policy as project/file mutations.
  const project = await fetchQuery(
    api.projects.get,
    { projectId },
    {
      token: "token" in principal ? principal.token : undefined,
      url: process.env.NEXT_PUBLIC_CONVEX_URL,
    },
  );
  return project !== null && project.ownerId === principal.owner.userId;
}

export function ownsCompileJob(
  principal: CompilePrincipal,
  owner: CompileJobOwner,
): boolean {
  return principal.owner.kind === "local"
    ? owner.kind === "local" && owner.origin === principal.owner.origin
    : owner.kind === "user" && owner.userId === principal.owner.userId;
}
