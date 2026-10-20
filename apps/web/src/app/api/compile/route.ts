import { NextResponse } from "next/server";
import {
  COMPILE_REQUEST_LIMITS,
  validateCompileRequest,
} from "@alove/protocol";
import { getCompileQueue } from "@/lib/compileQueue";
import {
  authorizeCompileRequest,
  canAccessCompileProject,
} from "@/lib/compileAccess";

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
  const access = await authorizeCompileRequest(req);
  if (!access.ok) return access.response;
  if (
    req.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !==
    "application/json"
  )
    return NextResponse.json(
      { error: "Expected application/json" },
      { status: 415 },
    );

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
    if (
      !(await canAccessCompileProject(
        access.principal,
        validated.value.projectId,
      ))
    )
      return NextResponse.json({ error: "not found" }, { status: 404 });
    const queue = getCompileQueue();
    const job = await queue.add("build", {
      version: 1,
      owner: access.principal.owner,
      request: validated.value,
    });
    return NextResponse.json({ jobId: job.id });
  } catch {
    return NextResponse.json(
      {
        error:
          "Compile service unavailable. Check project authorization, Redis and compile-worker, then retry.",
      },
      { status: 503 },
    );
  }
}
