import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { CompileJobPayload } from "@alove/protocol";
import { getCompileQueue } from "@/lib/compileQueue";
import { isLocalStandalone } from "@/lib/localStandalone";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (process.env.CLERK_SECRET_KEY && !isLocalStandalone()) {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let body: CompileJobPayload;
  try {
    body = (await req.json()) as CompileJobPayload;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body.projectId || !body.mainFile || !body.files) {
    return NextResponse.json(
      { error: "projectId, mainFile, and files are required" },
      { status: 400 },
    );
  }

  try {
    const queue = getCompileQueue();
    const job = await queue.add("build", body);
    return NextResponse.json({ jobId: job.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error:
          "Compile queue unavailable. Start Redis and compile-worker, then retry.",
        detail: message,
      },
      { status: 503 },
    );
  }
}
