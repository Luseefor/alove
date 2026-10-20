import { NextResponse } from "next/server";
import {
  validateQueuedCompileJob,
  type CompileJobResult,
} from "@alove/protocol";
import { getCompileQueue } from "@/lib/compileQueue";
import {
  authorizeCompileRequest,
  canAccessCompileProject,
  ownsCompileJob,
} from "@/lib/compileAccess";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ jobId: string }> };

function jobResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(req: Request, context: RouteContext) {
  const access = await authorizeCompileRequest(req);
  if (!access.ok) {
    access.response.headers.set("Cache-Control", "private, no-store");
    return access.response;
  }

  try {
    const { jobId } = await context.params;
    const queue = getCompileQueue();
    const job = await queue.getJob(jobId);
    if (!job) return jobResponse({ error: "not found" }, 404);
    const queued = validateQueuedCompileJob(job.data);
    if (
      !queued.ok ||
      !ownsCompileJob(access.principal, queued.value.owner) ||
      !(await canAccessCompileProject(
        access.principal,
        queued.value.request.projectId,
      ))
    ) {
      return jobResponse({ error: "not found" }, 404);
    }

    const state = await job.getState();
    if (state === "completed") {
      const result = job.returnvalue as CompileJobResult | undefined;
      return jobResponse({ state, result });
    }
    if (state === "failed") {
      return jobResponse({
        state,
        error: job.failedReason ?? "failed",
      });
    }
    return jobResponse({ state });
  } catch {
    return jobResponse(
      {
        error:
          "Compile status unavailable. Check project authorization, Redis and compile-worker.",
      },
      503,
    );
  }
}
