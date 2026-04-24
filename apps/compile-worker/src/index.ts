import { Worker } from "bullmq";
import type { CompileJobPayload, CompileJobResult } from "@alove/protocol";
import { COMPILE_QUEUE_NAME, redisConnectionOptions } from "@alove/queue";
import { runCompileJob } from "./runCompile.js";

const connection = redisConnectionOptions();

const worker = new Worker<CompileJobPayload, CompileJobResult>(
  COMPILE_QUEUE_NAME,
  async (job) => {
    const result = await runCompileJob(job.data);
    return result;
  },
  { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) },
);

worker.on("failed", (job, err) => {
  console.error("job failed", job?.id, err);
});

worker.on("completed", (job) => {
  console.log("job completed", job.id);
});

console.log("compile-worker listening", COMPILE_QUEUE_NAME, connection);
