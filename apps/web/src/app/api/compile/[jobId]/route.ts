import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { CompileJobResult } from "@alove/protocol";
import { getCompileQueue } from "@/lib/compileQueue";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ jobId: string }> };

export async function GET(_req: Request, context: RouteContext) {
  if (process.env.CLERK_SECRET_KEY) {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const { jobId } = await context.params;
  const queue = getCompileQueue();
  const job = await queue.getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const state = await job.getState();
  if (state === "completed") {
    const result = job.returnvalue as CompileJobResult | undefined;
    return NextResponse.json({ state, result });
  }
  if (state === "failed") {
    return NextResponse.json({
      state,
      error: job.failedReason ?? "failed",
    });
  }
  return NextResponse.json({ state });
}
