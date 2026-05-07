import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { CompileJobPayload } from "@alove/protocol";
import { getCompileQueue } from "@/lib/compileQueue";
import { getCompileAuthPolicy } from "@/lib/compileAuth";

export const runtime = "nodejs";

function isValidCompilePayload(payload: unknown): payload is CompileJobPayload {
  if (typeof payload !== "object" || payload === null) return false;
  const record = payload as Record<string, unknown>;
  if (typeof record.projectId !== "string" || record.projectId.trim() === "") return false;
  if (typeof record.mainFile !== "string" || record.mainFile.trim() === "") return false;
  if (typeof record.files !== "object" || record.files === null) return false;
  return Object.values(record.files).every((value) => typeof value === "string");
}

export async function POST(req: Request) {
  const authPolicy = getCompileAuthPolicy();
  if ("error" in authPolicy) {
    return NextResponse.json({ error: authPolicy.error }, { status: 500 });
  }
  if (!authPolicy.allowAnonymous) {
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

  if (!isValidCompilePayload(body)) {
    return NextResponse.json(
      { error: "projectId, mainFile, and files (string map) are required" },
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
