import { Worker } from "bullmq";
import type { CompileJobPayload, CompileJobResult } from "@alove/protocol";
import { COMPILE_QUEUE_NAME, redisConnectionOptions } from "@alove/queue";
import { runCompileJob } from "./runCompile.js";

const connection = redisConnectionOptions();
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 2);

function logEvent(event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}

const worker = new Worker<CompileJobPayload, CompileJobResult>(
  COMPILE_QUEUE_NAME,
  async (job) => {
    const result = await runCompileJob(job.data);
    return result;
  },
  { connection, concurrency },
);

worker.on("failed", (job, err) => {
  console.error(
    JSON.stringify({
      event: "compile.job.failed",
      jobId: job?.id ?? null,
      error: err.message,
    }),
  );
});

worker.on("completed", (job, result) => {
  const durationMs =
    job.processedOn && job.finishedOn ? job.finishedOn - job.processedOn : null;
  logEvent("compile.job.completed", {
    jobId: job.id,
    phase: result.phase,
    errorCode: result.errorCode ?? null,
    timedOut: result.timedOut ?? false,
    durationMs,
  });
});

logEvent("compile.worker.listening", {
  queue: COMPILE_QUEUE_NAME,
  redisHost: connection.host,
  redisPort: connection.port,
  concurrency,
});
