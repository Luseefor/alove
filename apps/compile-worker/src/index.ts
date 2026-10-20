import { writeFile, rm } from "node:fs/promises";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { Worker } from "bullmq";
import { validateQueuedCompileJob, type QueuedCompileJob, type CompileJobResult } from "@alove/protocol";
import { COMPILE_QUEUE_NAME, redisConnectionOptions } from "@alove/queue";
import { compileCancellationKey, COMPILE_HEARTBEAT_KEY, releaseCompileAdmission } from "@alove/queue/admission";
import { runCompileJob } from "./runCompile.js";
import { probeCompileRuntime } from "./compileRuntime.js";

await rm("/tmp/alove-worker-heartbeat", { force: true });
const connection = redisConnectionOptions();
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 1);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
  throw new Error("WORKER_CONCURRENCY must be 1–4");

function logEvent(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}
const control = new Redis(redisConnectionOptions("producer"));
control.on("error", () => logEvent("compile.worker.control_unavailable"));
control.on("end", () => { if (!shuttingDown) void shutdown().then(() => process.exit(1), () => process.exit(1)); });
const retention = new Queue(COMPILE_QUEUE_NAME, { connection: redisConnectionOptions("producer") });
retention.on("error", () => logEvent("compile.retention.unavailable"));
const active = new Map<string, AbortController>();
let shuttingDown = false;
const worker = new Worker<QueuedCompileJob, CompileJobResult>(COMPILE_QUEUE_NAME, async (job) => {
  const queued = validateQueuedCompileJob(job.data);
  if (!queued.ok) throw new Error(`Invalid owned compile job: ${queued.error}`);
  const controller = new AbortController();
  const client = control;
  const id = job.id!;
  active.set(id, controller);
  let checking = false;
  const checkCancellation = async () => {
    if (checking) return;
    checking = true;
    try {
      if (await client.get(compileCancellationKey(id))) controller.abort();
    } catch {
      // A lost control connection must not leave unbounded work running.
      controller.abort();
    } finally { checking = false; }
  };
  const timer = setInterval(() => void checkCancellation(), 300);
  try {
    await checkCancellation();
    return await runCompileJob(queued.value.request, { signal: controller.signal });
  } finally {
    clearInterval(timer);
    active.delete(id);
    await releaseCompileAdmission(client, queued.value.owner, id, worker.toKey("").replace(/:$/, "")).catch(() => {
      logEvent("compile.admission.release_failed", { jobId: id });
    });
  }
}, { connection, concurrency, maxStalledCount: 1 });

worker.on("error", () => logEvent("compile.worker.connection_error"));
worker.on("failed", (job) => logEvent("compile.job.failed", { jobId: job?.id ?? null }));
worker.on("completed", (job, result) => logEvent("compile.job.completed", {
  jobId: job.id, phase: result.phase, errorCode: result.errorCode ?? null,
  timedOut: result.timedOut ?? false,
  durationMs: job.processedOn && job.finishedOn ? job.finishedOn - job.processedOn : null,
}));

let heartbeatInFlight: Promise<void> | null = null;
let heartbeatAbort: AbortController | null = null;
let runtimeReady: boolean | undefined;
function heartbeat() {
  if (shuttingDown || heartbeatInFlight) return;
  const controller = new AbortController();
  heartbeatAbort = controller;
  heartbeatInFlight = (async () => {
    try {
      if ((await worker.client).status !== "ready" || !worker.isRunning()) return;
      const available = await probeCompileRuntime(controller.signal);
      if (shuttingDown) return;
      if (runtimeReady !== available) {
        logEvent(available ? "compile.worker.runtime_ready" : "compile.worker.runtime_unavailable");
        runtimeReady = available;
      }
      // Let existing readiness signals expire when the configured runtime fails.
      // A fresh queue connection alone does not establish compile availability.
      if (!available) return;
      await control.set(COMPILE_HEARTBEAT_KEY, String(Date.now()), "EX", 15);
      if (!shuttingDown) await writeFile("/tmp/alove-worker-heartbeat", String(Date.now()));
    } catch { logEvent("compile.worker.heartbeat_failed"); }
    finally { heartbeatInFlight = null; heartbeatAbort = null; }
  })();
}
const heartbeatTimer = setInterval(() => void heartbeat(), 5000);
void worker.waitUntilReady().then(heartbeat).catch(() => logEvent("compile.worker.not_ready"));

let cleaning = false;
async function cleanHistory() {
  if (cleaning || shuttingDown) return;
  cleaning = true;
  try {
    await retention.clean(3600_000, 100, "completed");
    await retention.clean(86400_000, 100, "failed");
  } catch { logEvent("compile.retention.failed"); }
  finally { cleaning = false; }
}
const retentionTimer = setInterval(() => void cleanHistory(), 60_000);

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeatTimer);
  clearInterval(retentionTimer);
  heartbeatAbort?.abort();
  await heartbeatInFlight;
  await rm("/tmp/alove-worker-heartbeat", { force: true });
  const deadline = setTimeout(() => { for (const controller of active.values()) controller.abort(); }, 10_000);
  const hardDeadline = setTimeout(() => {
    logEvent("compile.worker.shutdown_deadline");
    control.disconnect();
    process.exit(1);
  }, 35_000);
  try { await worker.close(); await retention.close(); await control.quit(); }
  finally { clearTimeout(deadline); clearTimeout(hardDeadline); }
  logEvent("compile.worker.stopped");
}
process.once("SIGTERM", () => void shutdown().then(() => process.exit(0), () => process.exit(1)));
process.once("SIGINT", () => void shutdown().then(() => process.exit(0), () => process.exit(1)));
logEvent("compile.worker.listening", { queue: COMPILE_QUEUE_NAME, concurrency });
