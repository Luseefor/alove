import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { Worker, type RedisClient } from "bullmq";
import { COMPILE_QUEUE_NAME, redisConnectionOptions } from "@alove/queue";
import {
  compileCancellationKey,
  releaseCompileAdmission,
} from "@alove/queue/admission";
import {
  validateQueuedCompileJob,
  type QueuedCompileJob,
  type CompileJobResult,
} from "@alove/protocol";
import { runVercelCompile } from "./vercelCompile";

export function usesVercelCompile() {
  return process.env.COMPILE_RUNTIME === "vercel-sandbox";
}

/** A Function claims one existing BullMQ job. No Redis credentials enter TeX. */
export async function runVercelQueueJob() {
  const worker = new Worker<QueuedCompileJob, CompileJobResult>(
    COMPILE_QUEUE_NAME,
    null,
    {
      connection: {
        ...redisConnectionOptions("producer"),
        maxRetriesPerRequest: null,
      },
      autorun: false,
      lockDuration: 120_000,
      maxStalledCount: 0,
    },
  );
  worker.on("error", () => console.error("compile.vercel.queue_unavailable"));
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      worker.waitUntilReady(),
      new Promise<never>((_, reject) => {
        readyTimer = setTimeout(
          () => reject(new Error("Queue unavailable")),
          5000,
        );
      }),
    ]);
    // Later status requests restart the stalled checker after a Function crash.
    // Failed abandoned jobs are not automatically recompiled or charged again.
    await worker.startStalledCheckTimer();
    const token = randomUUID();
    const job = await worker.getNextJob(token, { block: false });
    if (!job) return;
    const queued = validateQueuedCompileJob(job.data);
    if (!queued.ok) {
      await job.moveToFailed(
        new Error("Invalid owned compile job"),
        token,
        false,
      );
      return;
    }
    const client = await worker.client;
    const controller = new AbortController();
    let checking = false;
    const checkCancellation = async () => {
      if (checking) return;
      checking = true;
      try {
        if (await client.get(compileCancellationKey(job.id!)))
          controller.abort();
      } catch {
        controller.abort();
      } finally {
        checking = false;
      }
    };
    const timer = setInterval(() => void checkCancellation(), 300);
    try {
      await checkCancellation();
      const result = await runVercelCompile(
        queued.value.request,
        controller.signal,
      );
      await job.moveToCompleted(result, token, false);
    } catch {
      await job.moveToFailed(
        new Error("Cloud compiler unavailable. Retry the build."),
        token,
        false,
      );
    } finally {
      clearInterval(timer);
      await releaseCompileAdmission(
        client,
        queued.value.owner,
        job.id!,
        worker.toKey("").replace(/:$/, ""),
      ).catch(() => {});
    }
  } finally {
    if (readyTimer) clearTimeout(readyTimer);
    await worker.close(true);
  }
}

/** Throttle cold starts across submissions and polling, including crash recovery. */
export async function scheduleVercelCompile(client: RedisClient) {
  if (!usesVercelCompile()) return;
  const claim = await client.set(
    "alove:compile:vercel:wake",
    "1",
    "PX",
    5000,
    "NX",
  );
  if (claim !== "OK") return;
  after(async () => {
    try {
      await runVercelQueueJob();
    } catch {
      console.error("compile.vercel.background_failed");
    }
  });
}
