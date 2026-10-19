import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import {
  COMPILE_REQUEST_LIMITS,
  validateCompileRequest,
} from "@alove/protocol";
import { getCompileQueue } from "@/lib/compileQueue";
import { getCompileAuthPolicy } from "@/lib/compileAuth";

export const runtime = "nodejs";

async function readBody(req: Request): Promise<unknown> {
  const cap = COMPILE_REQUEST_LIMITS.maxRequestBytes;
  const declared = req.headers.get("content-length");
  if (declared && Number(declared) > cap)
    throw new RangeError("Compile request is too large");
  if (!req.body) throw new SyntaxError("Missing body");
  const reader = req.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > cap) {
        await reader.cancel();
        throw new RangeError("Compile request is too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    reader.releaseLock();
  }
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

  let body: unknown;
  try {
    body = await readBody(req);
  } catch (error) {
    if (error instanceof RangeError)
      return NextResponse.json({ error: error.message }, { status: 413 });
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const validated = validateCompileRequest(body);
  if (!validated.ok) {
    return NextResponse.json(
      { error: validated.error },
      { status: validated.status },
    );
  }

  try {
    const queue = getCompileQueue();
    const job = await queue.add("build", validated.value);
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
