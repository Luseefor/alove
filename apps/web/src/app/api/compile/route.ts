import { randomUUID } from "node:crypto";
import {
  reserveCompileAdmission,
  releaseCompileAdmission,
} from "@alove/queue/admission";
import { NextResponse } from "next/server";
import {
  COMPILE_REQUEST_LIMITS,
  validateCompileRequest,
} from "@alove/protocol";
import { getCompileQueue } from "@/lib/compileQueue";
import {
  scheduleVercelCompile,
  usesVercelCompile,
} from "@/lib/vercelCompileQueue";
import {
  VERCEL_COMPILE_LIMITS,
  vercelCompileSnapshot,
} from "@/lib/vercelCompile";
import {
  authorizeCompileRequest,
  canAccessCompileProject,
} from "@/lib/compileAccess";

export const runtime = "nodejs";
export const maxDuration = 300;

async function readBody(req: Request): Promise<unknown> {
  const cap = usesVercelCompile()
    ? VERCEL_COMPILE_LIMITS.requestBytes
    : COMPILE_REQUEST_LIMITS.maxRequestBytes;
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
    if (usesVercelCompile()) vercelCompileSnapshot();
    const queue = getCompileQueue();
    const client = await queue.client;
    const jobId = randomUUID();
    const prefix = queue.toKey("").replace(/:$/, "");
    const admission = await reserveCompileAdmission(
      client,
      access.principal.owner,
      jobId,
      prefix,
    );
    if (!admission.allowed)
      return NextResponse.json(
        {
          error:
            "Compile limit reached. Wait for a current build or retry shortly.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(admission.retryAfter) },
        },
      );
    let job;
    try {
      job = await queue.add(
        "build",
        {
          version: 1,
          owner: access.principal.owner,
          request: validated.value,
        },
        { jobId },
      );
    } catch (error) {
      // A timed-out add might have reached Redis. Keep its slot if the job exists.
      await releaseCompileAdmission(
        client,
        access.principal.owner,
        jobId,
        prefix,
        true,
      ).catch(() => {});
      throw error;
    }
    if (usesVercelCompile()) {
      // The durable queued job remains available to status polling if scheduling
      // fails after admission. A later request can wake the Function again.
      await scheduleVercelCompile(client).catch(() => {});
    }
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
