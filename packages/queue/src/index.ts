import { Queue, QueueEvents } from "bullmq";
import type { CompileJobPayload, CompileJobResult } from "@alove/protocol";

export const COMPILE_QUEUE_NAME = "compile";

const connection = () => ({
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
});

export function createCompileQueue() {
  return new Queue<CompileJobPayload, CompileJobResult>(COMPILE_QUEUE_NAME, {
    connection: connection(),
    defaultJobOptions: {
      removeOnComplete: 50,
      removeOnFail: 20,
      attempts: 1,
    },
  });
}

export function createCompileQueueEvents() {
  return new QueueEvents(COMPILE_QUEUE_NAME, { connection: connection() });
}

export { connection as redisConnectionOptions };
