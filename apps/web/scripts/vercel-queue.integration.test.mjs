// Run with: bun test apps/web/scripts/vercel-queue.integration.test.mjs
// Starts a dedicated loopback Redis instance; never connects to project Redis.
import { afterAll, beforeAll, beforeEach, expect, it, mock } from "bun:test";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  compileCancellationKey,
  reserveCompileAdmission,
  releaseCompileAdmission,
} from "@alove/queue/admission";

const compile = mock(async (_payload, signal) => ({
  phase: signal.aborted ? "failed" : "ready",
  errorCode: signal.aborted ? "CANCELLED" : undefined,
  log: "",
  diagnostics: [],
  pdfBase64: "JVBERi0=",
}));
mock.module("../src/lib/vercelCompile", () => ({ runVercelCompile: compile }));
const { runVercelQueueJob } = await import("../src/lib/vercelCompileQueue");
let redisProcess, client, queue;
const previous = { ...process.env };
const owner = { kind: "user", userId: "queue-integration-owner" };

beforeAll(async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  redisProcess = spawn(
    "redis-server",
    [
      "--bind",
      "127.0.0.1",
      "--port",
      String(port),
      "--save",
      "",
      "--appendonly",
      "no",
    ],
    { stdio: "ignore" },
  );
  await new Promise((resolve, reject) => {
    redisProcess.once("error", reject);
    setTimeout(resolve, 100);
  });
  process.env.REDIS_HOST = "127.0.0.1";
  process.env.REDIS_PORT = String(port);
  delete process.env.REDIS_URL;
  delete process.env.REDIS_PASSWORD;
  delete process.env.REDIS_USERNAME;
  delete process.env.REDIS_TLS;
  delete process.env.REDIS_TLS_CA;
  process.env.REDIS_DB = "0";
  const connection = { host: "127.0.0.1", port, maxRetriesPerRequest: null };
  client = new Redis(connection);
  await client.ping();
  queue = new Queue("compile", { connection });
  await queue.waitUntilReady();
});

beforeEach(async () => {
  await queue.obliterate({ force: true });
  compile.mockClear();
});
afterAll(async () => {
  await queue?.close();
  await client?.quit();
  if (redisProcess && redisProcess.exitCode === null) {
    redisProcess.kill("SIGTERM");
    await new Promise((resolve) => redisProcess.once("exit", resolve));
  }
  for (const key of Object.keys(process.env))
    if (!(key in previous)) delete process.env[key];
  Object.assign(process.env, previous);
});

async function enqueue() {
  const jobId = randomUUID();
  const admission = await reserveCompileAdmission(
    client,
    owner,
    jobId,
    "bull:compile",
    { perMinute: 30, perOwner: 1, global: 1 },
  );
  expect(admission.allowed).toBe(true);
  return queue.add(
    "build",
    {
      version: 1,
      owner,
      request: {
        projectId: "p",
        mainFile: "main.tex",
        files: { "main.tex": "Hello" },
      },
    },
    { jobId },
  );
}

it("claims a queued job exactly once across concurrent Functions and releases admission", async () => {
  const job = await enqueue();
  await Promise.all([runVercelQueueJob(), runVercelQueueJob()]);
  expect(compile).toHaveBeenCalledTimes(1);
  const completed = await queue.getJob(job.id);
  expect(await completed.getState()).toBe("completed");
  expect(completed.returnvalue.phase).toBe("ready");
  const next = await enqueue();
  await next.remove();
  await releaseCompileAdmission(client, owner, next.id, "bull:compile");
});

it("observes cancellation before running TeX", async () => {
  const job = await enqueue();
  await client.set(compileCancellationKey(job.id), "1", "EX", 60);
  await runVercelQueueJob();
  const completed = await queue.getJob(job.id);
  expect(completed.returnvalue.errorCode).toBe("CANCELLED");
  expect(compile.mock.calls[0][1].aborted).toBe(true);
});

it("records compiler infrastructure failures without exposing internal errors", async () => {
  compile.mockImplementationOnce(async () => {
    throw new Error("private infrastructure detail");
  });
  const job = await enqueue();
  await runVercelQueueJob();
  const failed = await queue.getJob(job.id);
  expect(await failed.getState()).toBe("failed");
  expect(failed.failedReason).toBe(
    "Cloud compiler unavailable. Retry the build.",
  );
});

it("rejects an invalid owner envelope before allocating a VM", async () => {
  const job = await queue.add("build", { request: { mainFile: "main.tex" } });
  await runVercelQueueJob();
  expect(await job.getState()).toBe("failed");
  expect(compile).not.toHaveBeenCalled();
});
